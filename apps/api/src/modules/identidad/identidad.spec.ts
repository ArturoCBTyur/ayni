/**
 * Pruebas del modulo de identidad (Fase 2).
 *
 * Cubren lo que RNF-02 exige y lo que es facil romper sin notarlo: que el
 * login no delate que cuentas existen, que el segundo factor sea inevitable
 * para los roles que mueven dinero, y que un refresh usado quede inservible.
 *
 * Son de integracion: usan la base real, porque la rotacion de sesiones solo
 * tiene sentido contra la tabla que la registra.
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';

import { authenticator } from 'otplib';

import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { IdentidadService } from './identidad.service';
import { HashService } from './servicios/hash.service';
import { TokensService } from './servicios/tokens.service';
import { TotpService } from './servicios/totp.service';

const marca = randomUUID().slice(0, 8);
const CLAVE = 'PruebaSegura2026';

let prisma: PrismaService;
let identidad: IdentidadService;
let tokens: TokensService;
let hash: HashService;

const creados: string[] = [];

/** Crea un usuario de prueba con el rol indicado. */
async function crearUsuario(rolCodigo: string, opciones: { conMfa?: boolean } = {}) {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: rolCodigo } });
  const secreto = authenticator.generateSecret();

  const usuario = await prisma.usuario.create({
    data: {
      correo: `${rolCodigo.toLowerCase()}-${marca}-${creados.length}@prueba.pe`,
      hashPassword: await hash.generar(CLAVE),
      nombres: 'Usuario',
      apellidos: 'De Prueba',
      estado: 'ACTIVO',
      totpSecreto: opciones.conMfa ? secreto : null,
      totpHabilitado: opciones.conMfa ?? false,
      roles: { create: { rolId: rol.id } },
    },
  });

  creados.push(usuario.id);
  return { usuario, secreto };
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] }),
      JwtModule.register({}),
    ],
    providers: [PrismaService, IdentidadService, HashService, TokensService, TotpService],
  }).compile();

  prisma = modulo.get(PrismaService);
  identidad = modulo.get(IdentidadService);
  tokens = modulo.get(TokensService);
  hash = modulo.get(HashService);
  modulo.get(ConfigService);

  await prisma.$connect();
});

afterAll(async () => {
  await prisma.sesion.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.bitacoraAuditoria.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.consentimiento.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.donante.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.usuario.deleteMany({ where: { id: { in: creados } } });
  await prisma.$disconnect();
});

describe('HashService', () => {
  it('verifica la contraseña correcta y rechaza la incorrecta', async () => {
    const h = await hash.generar(CLAVE);
    await expect(hash.verificar(h, CLAVE)).resolves.toBe(true);
    await expect(hash.verificar(h, CLAVE + 'x')).resolves.toBe(false);
  });

  it('genera hashes distintos para la misma clave (salt aleatorio)', async () => {
    const [a, b] = await Promise.all([hash.generar(CLAVE), hash.generar(CLAVE)]);
    expect(a).not.toBe(b);
    expect(a.startsWith('$argon2id$')).toBe(true);
  });

  it('devuelve false ante un hash corrupto en lugar de lanzar', async () => {
    // Un registro dañado no debe convertirse en un 500 que delate la cuenta.
    await expect(hash.verificar('no-es-un-hash', CLAVE)).resolves.toBe(false);
  });
});

describe('TotpService.exigeMfa (RNF-02)', () => {
  it('exige segundo factor a los roles que mueven dinero o aprueban', () => {
    for (const rol of ['ONG_ADMIN', 'ONG_OPERADOR', 'AUDITOR', 'ADMIN']) {
      expect(TotpService.exigeMfa([rol])).toBe(true);
    }
  });

  it('no se lo exige al donante', () => {
    expect(TotpService.exigeMfa(['DONANTE'])).toBe(false);
  });

  it('basta un rol sensible para exigirlo', () => {
    expect(TotpService.exigeMfa(['DONANTE', 'AUDITOR'])).toBe(true);
  });
});

describe('Inicio de sesion', () => {
  it('el donante entra sin segundo factor', async () => {
    const { usuario } = await crearUsuario('DONANTE');
    const r = await identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {});

    expect(r.mfaPendiente).toBe(false);
    expect(r.usuario.roles).toEqual(['DONANTE']);
    expect(r.tokenAcceso).toBeTruthy();
  });

  it('no revela si el correo existe: mismo mensaje en ambos casos', async () => {
    const { usuario } = await crearUsuario('DONANTE');

    const existente = await identidad
      .iniciarSesion({ correo: usuario.correo, clave: 'ClaveEquivocada1' }, {})
      .catch((e: Error) => e.message);
    const inexistente = await identidad
      .iniciarSesion({ correo: `nadie-${marca}@prueba.pe`, clave: 'ClaveEquivocada1' }, {})
      .catch((e: Error) => e.message);

    expect(existente).toBe(inexistente);
    expect(existente).toMatch(/incorrectos/i);
  });

  it('rechaza a una cuenta bloqueada con un mensaje distinto y accionable', async () => {
    const { usuario } = await crearUsuario('DONANTE');
    await prisma.usuario.update({ where: { id: usuario.id }, data: { estado: 'BLOQUEADO' } });

    await expect(
      identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {}),
    ).rejects.toThrow(/bloqueada/i);
  });
});

describe('Segundo factor obligatorio (RNF-02)', () => {
  it('un auditor sin MFA recibe un token marcado como pendiente, no un rechazo', async () => {
    // Rechazarlo lo dejaria sin forma de configurar el segundo factor: para
    // enrolarse necesita sesion, y sin enrolarse no deberia tenerla.
    const { usuario } = await crearUsuario('AUDITOR');
    const r = await identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {});

    expect(r.mfaPendiente).toBe(true);

    const carga = await tokens.verificarAcceso(r.tokenAcceso);
    expect(carga.mfaPendiente).toBe(true);
    expect(carga.roles).toEqual(['AUDITOR']);
  });

  it('un token de MFA pendiente no marca acceso efectivo', async () => {
    const { usuario } = await crearUsuario('ADMIN');
    await identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {});

    const actualizado = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(actualizado.ultimoAccesoEn).toBeNull();
  });

  it('un auditor con MFA activo debe enviar el codigo', async () => {
    const { usuario } = await crearUsuario('AUDITOR', { conMfa: true });

    await expect(
      identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {}),
    ).rejects.toThrow(/codigo de su app/i);
  });

  it('rechaza un codigo TOTP invalido', async () => {
    const { usuario } = await crearUsuario('AUDITOR', { conMfa: true });

    await expect(
      identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE, codigoTotp: '000000' }, {}),
    ).rejects.toThrow(/no es valido o ya expiro/i);
  });

  it('acepta el codigo TOTP correcto y entrega una sesion plena', async () => {
    const { usuario, secreto } = await crearUsuario('AUDITOR', { conMfa: true });
    const codigo = authenticator.generate(secreto);

    const r = await identidad.iniciarSesion(
      { correo: usuario.correo, clave: CLAVE, codigoTotp: codigo },
      {},
    );

    expect(r.mfaPendiente).toBe(false);
    const carga = await tokens.verificarAcceso(r.tokenAcceso);
    expect(carga.mfaPendiente).toBeUndefined();
  });

  it('el enrolamiento solo activa el MFA tras un codigo valido', async () => {
    const { usuario } = await crearUsuario('ADMIN');

    const { secreto } = await identidad.iniciarEnrolamientoTotp(usuario.id);
    // Aun no esta activo: el usuario todavia no demostro que puede generarlo.
    let estado = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(estado.totpHabilitado).toBe(false);

    await expect(
      identidad.confirmarEnrolamientoTotp(usuario.id, { codigoTotp: '000000' }),
    ).rejects.toThrow(/no coincide/i);

    await identidad.confirmarEnrolamientoTotp(usuario.id, {
      codigoTotp: authenticator.generate(secreto),
    });

    estado = await prisma.usuario.findUniqueOrThrow({ where: { id: usuario.id } });
    expect(estado.totpHabilitado).toBe(true);

    // Y queda registrado en la bitacora (RNF-08).
    const rastro = await prisma.bitacoraAuditoria.findFirst({
      where: { usuarioId: usuario.id, accion: 'MFA_ACTIVADO' },
    });
    expect(rastro).not.toBeNull();
  });
});

describe('Rotacion de sesiones', () => {
  it('rota el refresh y deja el anterior inservible', async () => {
    const { usuario } = await crearUsuario('DONANTE');
    const primera = await identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {});

    const segunda = await tokens.rotar(primera.tokenRefresh);
    expect(segunda.tokenRefresh).not.toBe(primera.tokenRefresh);

    // Reutilizar el viejo falla: es lo que limita el daño de un robo.
    await expect(tokens.rotar(primera.tokenRefresh)).rejects.toThrow(/sesion expiro/i);
    // El nuevo sigue sirviendo.
    await expect(tokens.rotar(segunda.tokenRefresh)).resolves.toBeDefined();
  });

  it('solo guarda el hash del refresh, nunca el token', async () => {
    const { usuario } = await crearUsuario('DONANTE');
    const sesion = await identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {});

    const filas = await prisma.sesion.findMany({ where: { usuarioId: usuario.id } });
    expect(filas).toHaveLength(1);
    expect(filas[0].refreshHash).not.toBe(sesion.tokenRefresh);
    expect(filas[0].refreshHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('revocar cierra la sesion', async () => {
    const { usuario } = await crearUsuario('DONANTE');
    const sesion = await identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {});

    await tokens.revocar(sesion.tokenRefresh);
    await expect(tokens.rotar(sesion.tokenRefresh)).rejects.toThrow(/sesion expiro/i);
  });

  it('revocarTodas cierra cada sesion abierta del usuario', async () => {
    const { usuario } = await crearUsuario('DONANTE');
    const a = await identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {});
    const b = await identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {});

    expect(await tokens.revocarTodas(usuario.id)).toBe(2);
    await expect(tokens.rotar(a.tokenRefresh)).rejects.toThrow();
    await expect(tokens.rotar(b.tokenRefresh)).rejects.toThrow();
  });

  it('un usuario bloqueado no puede refrescar aunque su token siga vigente', async () => {
    const { usuario } = await crearUsuario('DONANTE');
    const sesion = await identidad.iniciarSesion({ correo: usuario.correo, clave: CLAVE }, {});

    await prisma.usuario.update({ where: { id: usuario.id }, data: { estado: 'BLOQUEADO' } });

    await expect(tokens.rotar(sesion.tokenRefresh)).rejects.toThrow(/sesion expiro/i);
  });

  it('rechaza un refresh inexistente', async () => {
    await expect(tokens.rotar('token-que-nunca-existio')).rejects.toThrow(/sesion expiro/i);
    await expect(tokens.rotar(undefined)).rejects.toThrow(/sesion expiro/i);
  });
});

describe('Registro con consentimiento (CU01, RF-DE-01)', () => {
  it('crea usuario, perfil de donante, consentimientos y rastro en bitacora', async () => {
    const correo = `registro-${marca}@prueba.pe`;

    const r = await identidad.registrar(
      {
        correo,
        clave: CLAVE,
        nombres: 'Nueva',
        apellidos: 'Donante',
        consentimientos: { tratamientoDatos: true, comunicaciones: true, usoImagen: false },
        versionPolitica: '1.0',
      },
      { ip: '127.0.0.1', userAgent: 'jest' },
    );
    creados.push(r.id);

    const usuario = await prisma.usuario.findUniqueOrThrow({
      where: { id: r.id },
      include: { consentimientos: true, donante: true, roles: { include: { rol: true } } },
    });

    expect(usuario.donante).not.toBeNull();
    expect(usuario.roles.map((x) => x.rol.codigo)).toEqual(['DONANTE']);
    expect(usuario.consentimientos).toHaveLength(3);

    const porFinalidad = Object.fromEntries(
      usuario.consentimientos.map((c) => [c.finalidad, c.otorgado]),
    );
    expect(porFinalidad).toEqual({
      TRATAMIENTO_DATOS: true,
      COMUNICACIONES: true,
      // Lo no otorgado se guarda como negativa explicita, no se omite: hay
      // que poder demostrar que se pregunto y que la respuesta fue no.
      USO_IMAGEN: false,
    });

    const rastro = await prisma.bitacoraAuditoria.findFirst({
      where: { usuarioId: r.id, accion: 'REGISTRO_USUARIO' },
    });
    expect(rastro?.ip).toBe('127.0.0.1');
  });

  it('rechaza un correo ya registrado', async () => {
    const { usuario } = await crearUsuario('DONANTE');

    await expect(
      identidad.registrar(
        {
          correo: usuario.correo,
          clave: CLAVE,
          nombres: 'Otra',
          apellidos: 'Persona',
          consentimientos: { tratamientoDatos: true, comunicaciones: false, usoImagen: false },
          versionPolitica: '1.0',
        },
        {},
      ),
    ).rejects.toThrow(/Ya existe una cuenta/i);
  });
});
