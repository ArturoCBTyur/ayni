/**
 * Identidad a traves de HTTP: limites de intentos, no enumeracion de cuentas
 * y alcance del token de MFA pendiente (RNF-02, RNF-03 / ASVS V2 y V3).
 *
 * Son controles que solo existen en el borde. El servicio de identidad puede
 * estar impecable y aun asi permitir siete mil intentos de contrasena por
 * hora si nadie limita la ruta, y eso no se ve probando el servicio a solas.
 */
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { BitacoraModule } from '../../comun/bitacora/bitacora.module';
import { PrismaModule } from '../../comun/prisma/prisma.module';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { IdentidadModule } from './identidad.module';
import { HashService } from './servicios/hash.service';
import { TokensService } from './servicios/tokens.service';

const marca = randomUUID().slice(0, 8);
const CLAVE = 'Clave.De.Prueba.2026';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokensService;

const usuarios: string[] = [];
let correoDonante: string;
let auditorId: string;

function api() {
  return request(app.getHttpServer() as Server);
}

function mensaje(r: request.Response): string {
  return (r.body as { message?: string }).message ?? '';
}

async function crearUsuario(rolCodigo: string, etiqueta: string): Promise<{ id: string; correo: string }> {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: rolCodigo } });
  const hash = await app.get(HashService).generar(CLAVE);
  const usuario = await prisma.usuario.create({
    data: {
      correo: `${etiqueta}-${marca}@prueba.pe`,
      hashPassword: hash,
      nombres: etiqueta,
      apellidos: 'De Prueba',
      estado: 'ACTIVO',
      correoVerificadoEn: new Date(),
      roles: { create: { rolId: rol.id } },
      ...(rolCodigo === 'DONANTE' ? { donante: { create: {} } } : {}),
    },
  });
  usuarios.push(usuario.id);
  return { id: usuario.id, correo: usuario.correo };
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] }),
      PrismaModule,
      BitacoraModule,
      // Las mismas dos ventanas que declara app.module.ts. Probar con otros
      // numeros seria probar otra politica.
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

  correoDonante = (await crearUsuario('DONANTE', 'idhttp')).correo;
  auditorId = (await crearUsuario('AUDITOR', 'audhttp')).id;
}, 60_000);

afterAll(async () => {
  await prisma.sesion.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.bitacoraAuditoria.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.consentimiento.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.donante.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
  await app.close();
});

describe('El login no dice si la cuenta existe (ASVS V2.2)', () => {
  it('una contraseña equivocada y un correo inexistente responden igual', async () => {
    const claveMala = await api()
      .post('/identidad/sesion')
      .send({ correo: correoDonante, clave: 'Esta.No.Es.La.Clave.2026' });

    const correoInexistente = await api()
      .post('/identidad/sesion')
      .send({ correo: `nadie-${marca}@prueba.pe`, clave: CLAVE });

    expect(claveMala.status).toBe(401);
    expect(correoInexistente.status).toBe(401);
    // Mismo codigo y mismo texto: distinguirlos le confirmaria a quien prueba
    // credenciales cuales correos estan registrados.
    expect(mensaje(claveMala)).toBe(mensaje(correoInexistente));
  });
});

describe('La sesion se entrega como corresponde (RNF-02)', () => {
  it('el refresh viaja en cookie httpOnly y no en el cuerpo', async () => {
    const r = await api().post('/identidad/sesion').send({ correo: correoDonante, clave: CLAVE });

    expect(r.status).toBe(200);
    expect(r.body).toHaveProperty('tokenAcceso');
    // Si el refresh apareciera en el JSON, cualquier script de la pagina
    // podria leerlo, que es exactamente lo que la cookie httpOnly evita.
    expect(r.body).not.toHaveProperty('tokenRefresh');

    const cookies = r.headers['set-cookie'] as unknown as string[];
    const refresh = cookies.find((c) => c.startsWith('tr_refresh='));
    expect(refresh).toBeDefined();
    expect(refresh).toMatch(/HttpOnly/i);
  });
});

describe('El token de MFA pendiente solo sirve para enrolarse', () => {
  it('no abre el resto de la cuenta', async () => {
    // Un auditor sin TOTP configurado: el login le da un token marcado.
    const par = await tokens.emitir({
      sub: auditorId,
      correo: `audhttp-${marca}@prueba.pe`,
      roles: ['AUDITOR'],
      ongs: [],
      mfaPendiente: true,
    });

    const perfil = await api()
      .get('/identidad/perfil')
      .set('Authorization', `Bearer ${par.tokenAcceso}`);
    expect(perfil.status).toBe(403);
    expect(mensaje(perfil)).toMatch(/verificacion en dos pasos/i);

    const enrolar = await api()
      .post('/identidad/mfa/iniciar')
      .set('Authorization', `Bearer ${par.tokenAcceso}`);
    expect(enrolar.status).toBe(201);
    expect(enrolar.body).toHaveProperty('secreto');
  });
});

describe('Limite de intentos en las rutas que prueban credenciales (ASVS V2.2.1)', () => {
  // Instancia propia: el contador del limitador es por IP y vive mientras vive
  // la aplicacion, asi que los inicios de sesion de las pruebas anteriores ya
  // lo habrian gastado. Aislarlo es lo que hace que el numero exacto signifique
  // algo.
  let appLimite: INestApplication;

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

    appLimite = modulo.createNestApplication();
    appLimite.use(cookieParser('secreto-de-prueba-para-cookies-firmadas'));
    await appLimite.init();
  }, 30_000);

  afterAll(async () => {
    await appLimite.close();
  });

  it('corta el sexto intento de inicio de sesion en un minuto', async () => {
    const estados: number[] = [];

    // Correo inexistente, para no tocar ninguna cuenta real.
    for (let i = 0; i < 6; i++) {
      const r = await request(appLimite.getHttpServer() as Server)
        .post('/identidad/sesion')
        .send({ correo: `fuerza-bruta-${marca}@prueba.pe`, clave: `Intento.Numero.${i}2026` });
      estados.push(r.status);
    }

    // Cinco pasan al servicio y fallan por credenciales; el sexto ni llega.
    expect(estados.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(estados[5]).toBe(429);
  }, 30_000);

  it('el limite no alcanza a las rutas de consulta', async () => {
    // El limitador estricto es de la ruta, no del cliente: despues de haberla
    // agotado, el resto de la API sigue respondiendo. Si no fuera asi, un
    // atacante dejaria la plataforma inutilizable con seis peticiones.
    const r = await request(appLimite.getHttpServer() as Server).get('/identidad/perfil');

    expect(r.status).toBe(401);
  });
});
