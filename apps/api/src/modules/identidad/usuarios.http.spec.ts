/**
 * RF-16 · Administracion de usuarios, de punta a punta por HTTP.
 *
 * Lo que importa probar no es que se pueda cambiar un rol, que es un UPDATE:
 * es que cada cambio deje rastro con su motivo, que cierre las sesiones que
 * tenian los permisos viejos, que nadie se saque a si mismo del sistema, y
 * que la ruta no la pueda usar nadie mas que el administrador.
 */
import { ConflictException, INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { authenticator } from 'otplib';
import request from 'supertest';

import { BitacoraModule } from '../../comun/bitacora/bitacora.module';
import { PrismaModule } from '../../comun/prisma/prisma.module';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { IdentidadModule } from './identidad.module';
import { HashService } from './servicios/hash.service';
import { TokensService } from './servicios/tokens.service';
import { TotpService } from './servicios/totp.service';
import { UsuariosService } from './usuarios.service';

const marca = randomUUID().slice(0, 8);
const CLAVE = 'Clave.De.Prueba.2026';
const MOTIVO = 'Prueba automatizada de la administracion de usuarios.';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokensService;

const creados: string[] = [];

interface Cuenta {
  id: string;
  correo: string;
  token: string;
}

function api() {
  return request(app.getHttpServer() as Server);
}

function mensaje(r: request.Response): string {
  return (r.body as { message?: string }).message ?? '';
}

interface FichaRespuesta {
  id: string;
  correo: string;
  estado: string;
  roles: string[];
  totpHabilitado: boolean;
  exigeMfa: boolean;
  mfaPendiente: boolean;
  sinCambios?: boolean;
  sesionesCerradas?: number;
  advertencias?: string[];
  historial?: Array<{ accion: string; actor: { id: string } | null; valorNuevo: unknown }>;
}

const ficha = (r: request.Response) => r.body as FichaRespuesta;
const lista = (r: request.Response) => r.body as { total: number; usuarios: FichaRespuesta[] };
const errores = (r: request.Response) => (r.body as { errores: Array<{ campo: string }> }).errores;

async function crearCuenta(
  roles: string[],
  etiqueta: string,
  opciones: { secretoTotp?: string } = {},
): Promise<Cuenta> {
  const catalogo = await prisma.rol.findMany({ where: { codigo: { in: roles } } });
  const usuario = await prisma.usuario.create({
    data: {
      correo: `${etiqueta}-${marca}@prueba.pe`,
      hashPassword: await app.get(HashService).generar(CLAVE),
      nombres: etiqueta,
      apellidos: `Prueba ${marca}`,
      estado: 'ACTIVO',
      correoVerificadoEn: new Date(),
      totpHabilitado: Boolean(opciones.secretoTotp),
      roles: { create: catalogo.map((r) => ({ rolId: r.id })) },
      ...(roles.includes('DONANTE') ? { donante: { create: {} } } : {}),
    },
  });
  creados.push(usuario.id);

  // El sobre del secreto se ata al id, que no existe hasta crear la fila.
  if (opciones.secretoTotp) {
    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { totpSecreto: app.get(TotpService).sellarSecreto(usuario.id, opciones.secretoTotp) },
    });
  }

  const { tokenAcceso } = await tokens.emitir({
    sub: usuario.id,
    correo: usuario.correo,
    roles,
    ongs: [],
  });
  return { id: usuario.id, correo: usuario.correo, token: tokenAcceso };
}

async function rolesEnBase(id: string): Promise<string[]> {
  const filas = await prisma.usuarioRol.findMany({
    where: { usuarioId: id },
    include: { rol: true },
  });
  return filas.map((f) => f.rol.codigo).sort();
}

/** Abre una sesion de refresh, para comprobar despues que se cerro. */
async function abrirSesion(cuenta: Cuenta, roles: string[]): Promise<string> {
  const par = await tokens.emitir({ sub: cuenta.id, correo: cuenta.correo, roles, ongs: [] });
  return par.tokenRefresh;
}

let admin: Cuenta;
let otroAdmin: Cuenta;
let donante: Cuenta;
let auditor: Cuenta;

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] }),
      PrismaModule,
      BitacoraModule,
      ThrottlerModule.forRoot([
        { name: 'corto', ttl: 60_000, limit: 120 },
        { name: 'largo', ttl: 3_600_000, limit: 2_000 },
      ]),
      IdentidadModule,
    ],
    providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
  }).compile();

  app = modulo.createNestApplication();
  app.use(cookieParser('secreto-de-prueba-para-cookies-firmadas'));
  await app.init();

  prisma = modulo.get(PrismaService);
  tokens = modulo.get(TokensService);

  admin = await crearCuenta(['ADMIN'], 'adm');
  otroAdmin = await crearCuenta(['ADMIN'], 'adm2');
  donante = await crearCuenta(['DONANTE'], 'don');
  auditor = await crearCuenta(['AUDITOR'], 'aud');
}, 60_000);

afterAll(async () => {
  await prisma.sesion.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.bitacoraAuditoria.deleteMany({
    where: { OR: [{ usuarioId: { in: creados } }, { entidadId: { in: creados } }] },
  });
  await prisma.donante.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.usuario.deleteMany({ where: { id: { in: creados } } });
  await app.close();
});

describe('Solo el administrador entra (RNF-02)', () => {
  it.each([
    ['donante', () => donante],
    ['auditor', () => auditor],
  ])('un %s recibe 403', async (_rol, cuenta) => {
    const r = await api()
      .get('/identidad/usuarios')
      .set('Authorization', `Bearer ${cuenta().token}`);
    expect(r.status).toBe(403);
  });

  it('sin sesion, 401', async () => {
    expect((await api().get('/identidad/usuarios')).status).toBe(401);
  });
});

describe('Busqueda', () => {
  it('encuentra por correo y no expone el hash ni el secreto', async () => {
    const r = await api()
      .get('/identidad/usuarios')
      .query({ q: marca, porPagina: 50 })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(r.status).toBe(200);
    const correos = lista(r).usuarios.map((u) => u.correo);
    expect(correos).toEqual(
      expect.arrayContaining([admin.correo, otroAdmin.correo, donante.correo, auditor.correo]),
    );

    const crudo = JSON.stringify(r.body);
    expect(crudo).not.toMatch(/hashPassword|totpSecreto|\$argon2/);
  });

  it('filtra por rol', async () => {
    const r = await api()
      .get('/identidad/usuarios')
      .query({ q: marca, rol: 'AUDITOR' })
      .set('Authorization', `Bearer ${admin.token}`);

    expect(lista(r).usuarios.map((u) => u.id)).toEqual([auditor.id]);
  });

  it('busca % y _ como texto, no como comodines', async () => {
    const conGuion = await crearCuenta(['DONANTE'], 'sub_rayado');
    const buscar = async (q: string) =>
      lista(
        await api()
          .get('/identidad/usuarios')
          .query({ q, porPagina: 100 })
          .set('Authorization', `Bearer ${admin.token}`),
      ).usuarios.map((u) => u.id);

    // Sin escapar, "_" es "cualquier caracter" y "%" es "cualquier cosa": las
    // dos devolvian todas las cuentas de la base.
    expect(await buscar(`_rayado-${marca}`)).toEqual([conGuion.id]);
    expect(await buscar(`b_rayado-${marca}`)).toEqual([conGuion.id]);
    expect(await buscar(`${marca}%`)).toEqual([]);
    expect(await buscar(`d_n-${marca}`)).toEqual([]);
  });

  it('dice que cuentas tienen el segundo factor pendiente', async () => {
    const r = await api()
      .get('/identidad/usuarios')
      .query({ q: marca, rol: 'AUDITOR' })
      .set('Authorization', `Bearer ${admin.token}`);
    expect(lista(r).usuarios[0]).toMatchObject({ exigeMfa: true, mfaPendiente: true });
  });

  it('el catalogo de roles no queda tapado por la ruta de la ficha', async () => {
    const r = await api()
      .get('/identidad/usuarios/roles')
      .set('Authorization', `Bearer ${admin.token}`);

    expect(r.status).toBe(200);
    const porCodigo = Object.fromEntries(
      (r.body as Array<{ codigo: string; exigeMfa: boolean }>).map((x) => [x.codigo, x.exigeMfa]),
    );
    expect(porCodigo).toMatchObject({ DONANTE: false, AUDITOR: true, ADMIN: true });
  });

  it('una ficha que no existe es 404 y un id mal formado es 400', async () => {
    const auth = `Bearer ${admin.token}`;
    expect(
      (await api().get(`/identidad/usuarios/${randomUUID()}`).set('Authorization', auth)).status,
    ).toBe(404);
    expect(
      (await api().get('/identidad/usuarios/no-es-uuid').set('Authorization', auth)).status,
    ).toBe(400);
  });
});

describe('Cambio de roles', () => {
  it('asigna el rol, deja rastro con motivo y cierra las sesiones viejas', async () => {
    const refresh = await abrirSesion(donante, ['DONANTE']);

    const r = await api()
      .patch(`/identidad/usuarios/${donante.id}/roles`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ roles: ['DONANTE', 'AUDITOR'], motivo: MOTIVO });

    expect(r.status).toBe(200);
    expect([...ficha(r).roles].sort()).toEqual(['AUDITOR', 'DONANTE']);
    // El auditor necesita segundo factor y esta cuenta no lo tiene.
    expect(ficha(r).mfaPendiente).toBe(true);
    expect((ficha(r).advertencias ?? []).join(' ')).toMatch(/dos pasos/);
    expect(ficha(r).sesionesCerradas).toBeGreaterThanOrEqual(1);

    expect(await rolesEnBase(donante.id)).toEqual(['AUDITOR', 'DONANTE']);

    const asignacion = await prisma.usuarioRol.findFirstOrThrow({
      where: { usuarioId: donante.id, rol: { codigo: 'AUDITOR' } },
    });
    expect(asignacion.asignadoPor).toBe(admin.id);

    const rastro = await prisma.bitacoraAuditoria.findFirstOrThrow({
      where: { entidadId: donante.id, accion: 'ROLES_ACTUALIZADOS' },
    });
    expect(rastro.usuarioId).toBe(admin.id);
    expect(rastro.valorAnterior).toEqual({ roles: ['DONANTE'] });
    expect(rastro.valorNuevo).toMatchObject({ roles: ['DONANTE', 'AUDITOR'], motivo: MOTIVO });

    // El refresh con los roles viejos ya no sirve: hay que volver a entrar.
    await expect(tokens.rotar(refresh)).rejects.toThrow();
  });

  it('pedir los mismos roles no escribe nada', async () => {
    const antes = await prisma.bitacoraAuditoria.count({ where: { entidadId: auditor.id } });

    const r = await api()
      .patch(`/identidad/usuarios/${auditor.id}/roles`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ roles: ['AUDITOR'], motivo: MOTIVO });

    expect(ficha(r).sinCambios).toBe(true);
    expect(await prisma.bitacoraAuditoria.count({ where: { entidadId: auditor.id } })).toBe(antes);
  });

  it('avisa que un rol de ONG sin membresia no abre ninguna organizacion', async () => {
    const r = await api()
      .patch(`/identidad/usuarios/${auditor.id}/roles`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ roles: ['AUDITOR', 'ONG_OPERADOR'], motivo: MOTIVO });

    expect(r.status).toBe(200);
    expect((ficha(r).advertencias ?? []).join(' ')).toMatch(/miembro/);
  });

  it('sin motivo suficiente no hace nada y dice que campo falta', async () => {
    const antes = await rolesEnBase(auditor.id);
    const r = await api()
      .patch(`/identidad/usuarios/${auditor.id}/roles`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ roles: ['DONANTE'], motivo: 'porque' });

    expect(r.status).toBe(400);
    expect(errores(r).map((e) => e.campo)).toContain('motivo');
    expect(await rolesEnBase(auditor.id)).toEqual(antes);
  });

  it('una cuenta sin roles no se admite', async () => {
    const r = await api()
      .patch(`/identidad/usuarios/${auditor.id}/roles`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ roles: [], motivo: MOTIVO });
    expect(r.status).toBe(400);
  });

  it('el administrador no puede quitarse su propio rol', async () => {
    const r = await api()
      .patch(`/identidad/usuarios/${admin.id}/roles`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ roles: ['DONANTE'], motivo: MOTIVO });

    expect(r.status).toBe(400);
    expect(mensaje(r)).toMatch(/otra persona administradora/);
    expect(await rolesEnBase(admin.id)).toEqual(['ADMIN']);
  });

  it('si puede quitarselo a otro administrador mientras quede uno activo', async () => {
    const r = await api()
      .patch(`/identidad/usuarios/${otroAdmin.id}/roles`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ roles: ['DONANTE'], motivo: MOTIVO });

    expect(r.status).toBe(200);
    expect(await rolesEnBase(otroAdmin.id)).toEqual(['DONANTE']);
  });
});

describe('Bloqueo y reactivacion', () => {
  it('bloquear corta el acceso: cierra las sesiones y el login lo rechaza', async () => {
    const refresh = await abrirSesion(auditor, ['AUDITOR']);

    const r = await api()
      .patch(`/identidad/usuarios/${auditor.id}/estado`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ estado: 'BLOQUEADO', motivo: MOTIVO });

    expect(r.status).toBe(200);
    expect(ficha(r).estado).toBe('BLOQUEADO');
    await expect(tokens.rotar(refresh)).rejects.toThrow();

    const login = await api()
      .post('/identidad/sesion')
      .send({ correo: auditor.correo, clave: CLAVE });
    expect(login.status).toBe(401);
    expect(mensaje(login)).toMatch(/bloqueada/);

    const rastro = await prisma.bitacoraAuditoria.findFirstOrThrow({
      where: { entidadId: auditor.id, accion: 'USUARIO_BLOQUEADO' },
    });
    expect(rastro.valorNuevo).toMatchObject({ estado: 'BLOQUEADO', motivo: MOTIVO });
  });

  it('reactivar devuelve el acceso', async () => {
    const r = await api()
      .patch(`/identidad/usuarios/${auditor.id}/estado`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ estado: 'ACTIVO', motivo: MOTIVO });
    expect(ficha(r).estado).toBe('ACTIVO');

    const login = await api()
      .post('/identidad/sesion')
      .send({ correo: auditor.correo, clave: CLAVE });
    expect(login.status).toBe(200);
  });

  it('el administrador no puede bloquearse a si mismo', async () => {
    const r = await api()
      .patch(`/identidad/usuarios/${admin.id}/estado`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ estado: 'BLOQUEADO', motivo: MOTIVO });

    expect(r.status).toBe(400);
    expect((await prisma.usuario.findUniqueOrThrow({ where: { id: admin.id } })).estado).toBe(
      'ACTIVO',
    );
  });
});

describe('Restablecer el segundo factor (soporte)', () => {
  let operador: Cuenta;
  const secreto = authenticator.generateSecret();

  beforeAll(async () => {
    operador = await crearCuenta(['ONG_OPERADOR'], 'ope', { secretoTotp: secreto });
  });

  it('antes del restablecimiento, la cuenta entra con su codigo', async () => {
    const login = await api()
      .post('/identidad/sesion')
      .send({ correo: operador.correo, clave: CLAVE, codigoTotp: authenticator.generate(secreto) });
    expect(login.status).toBe(200);
    expect(ficha(login).mfaPendiente).toBe(false);
  });

  it('borra el secreto, cierra sesiones y obliga a enrolar de nuevo', async () => {
    const refresh = await abrirSesion(operador, ['ONG_OPERADOR']);

    const r = await api()
      .post(`/identidad/usuarios/${operador.id}/mfa/restablecer`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ motivo: 'Perdio el celular en campo, lo confirmo por telefono.' });

    expect(r.status).toBe(200);
    expect(ficha(r)).toMatchObject({ totpHabilitado: false, mfaPendiente: true });
    await expect(tokens.rotar(refresh)).rejects.toThrow();

    const fila = await prisma.usuario.findUniqueOrThrow({ where: { id: operador.id } });
    expect(fila.totpSecreto).toBeNull();

    // No entrega acceso: la contrasena sigue haciendo falta, y lo unico que
    // abre es el enrolamiento de un dispositivo nuevo.
    const login = await api()
      .post('/identidad/sesion')
      .send({ correo: operador.correo, clave: CLAVE });
    expect(login.status).toBe(200);
    expect(ficha(login).mfaPendiente).toBe(true);

    expect(
      await prisma.bitacoraAuditoria.count({
        where: { entidadId: operador.id, accion: 'MFA_RESTABLECIDO', usuarioId: admin.id },
      }),
    ).toBe(1);
  });

  it('sin segundo factor configurado no hay nada que restablecer', async () => {
    const r = await api()
      .post(`/identidad/usuarios/${operador.id}/mfa/restablecer`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ motivo: MOTIVO });
    expect(r.status).toBe(409);
  });

  it('el administrador no puede restablecer el suyo', async () => {
    const r = await api()
      .post(`/identidad/usuarios/${admin.id}/mfa/restablecer`)
      .set('Authorization', `Bearer ${admin.token}`)
      .send({ motivo: MOTIVO });
    expect(r.status).toBe(400);
  });

  it('la ficha muestra quien hizo que y por que', async () => {
    const r = await api()
      .get(`/identidad/usuarios/${operador.id}`)
      .set('Authorization', `Bearer ${admin.token}`);

    expect(r.status).toBe(200);
    expect(ficha(r).historial?.[0]).toMatchObject({
      accion: 'MFA_RESTABLECIDO',
      actor: { id: admin.id },
      valorNuevo: { motivo: 'Perdio el celular en campo, lo confirmo por telefono.' },
    });
  });
});

describe('Siempre queda un administrador activo', () => {
  // La regla depende de cuantos administradores hay en toda la base, y la
  // base de pruebas es compartida: no se puede garantizar que haya uno solo
  // sin tocar cuentas ajenas. Se prueba el servicio con una transaccion falsa
  // que responde que no hay otro.
  function servicioSinOtrosAdministradores() {
    const escrituras: string[] = [];
    const fila = {
      id: 'ultimo',
      correo: 'ultimo@prueba.pe',
      nombres: 'Ultimo',
      apellidos: 'Administrador',
      estado: 'ACTIVO',
      totpHabilitado: true,
      ultimoAccesoEn: null,
      creadoEn: new Date(),
      roles: [{ rol: { codigo: 'ADMIN' } }],
      membresias: [],
    };
    const tx = {
      $executeRaw: () => Promise.resolve(0),
      usuario: {
        findUnique: () => Promise.resolve(fila),
        count: () => Promise.resolve(0),
        update: () => Promise.resolve(escrituras.push('usuario.update')),
      },
      usuarioRol: {
        deleteMany: () => Promise.resolve(escrituras.push('usuarioRol.deleteMany')),
        createMany: () => Promise.resolve(escrituras.push('usuarioRol.createMany')),
      },
      sesion: { updateMany: () => Promise.resolve({ count: 0 }) },
      bitacoraAuditoria: { create: () => Promise.resolve(escrituras.push('bitacora')) },
    };
    const prismaFalso = {
      rol: { findMany: () => Promise.resolve([{ id: 'r', codigo: 'DONANTE' }]) },
      $transaction: (fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    };
    return {
      servicio: new UsuariosService(prismaFalso as unknown as PrismaService),
      escrituras,
    };
  }

  it('no deja quitarle el rol al ultimo', async () => {
    const { servicio, escrituras } = servicioSinOtrosAdministradores();
    await expect(
      servicio.cambiarRoles('ultimo', 'otro', { roles: ['DONANTE'], motivo: MOTIVO }, {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(escrituras).toEqual([]);
  });

  it('no deja bloquear al ultimo', async () => {
    const { servicio, escrituras } = servicioSinOtrosAdministradores();
    await expect(
      servicio.cambiarEstado('ultimo', 'otro', { estado: 'BLOQUEADO', motivo: MOTIVO }, {}),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(escrituras).toEqual([]);
  });
});
