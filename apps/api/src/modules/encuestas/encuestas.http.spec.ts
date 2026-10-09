/**
 * Las rutas de encuestas por HTTP: con sesion, el cuerpo validado antes de
 * tocar nada y el consentimiento exigido aunque el cuerpo sea correcto.
 */
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';

import { BitacoraModule } from '../../comun/bitacora/bitacora.module';
import { PrismaModule } from '../../comun/prisma/prisma.module';
import { PrismaService } from '../../comun/prisma/prisma.service';
import {
  crearEscenarioContable,
  type EscenarioContable,
} from '../../comun/pruebas/escenario-contable';
import { cargarConfiguracion } from '../../config/configuracion';
import { IdentidadModule } from '../identidad/identidad.module';
import { TokensService } from '../identidad/servicios/tokens.service';
import { EncuestasModule } from './encuestas.module';
import { SUS } from './instrumentos';
import { publicarInstrumentos } from './publicacion';

let app: INestApplication;
let prisma: PrismaService;
let e: EscenarioContable;
let token: string;

const api = () => request(app.getHttpServer() as Server);

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] }),
      PrismaModule,
      BitacoraModule,
      IdentidadModule,
      EncuestasModule,
    ],
  }).compile();

  app = modulo.createNestApplication();
  await app.init();
  prisma = modulo.get(PrismaService);
  await publicarInstrumentos(prisma);

  e = await crearEscenarioContable(prisma, 'encuestas-http');
  await e.donar(20, 1.69);
  token = (
    await modulo.get(TokensService).emitir({
      sub: e.donanteUsuarioId,
      correo: 'donante@prueba.pe',
      roles: ['DONANTE'],
      ongs: [],
      mfaPendiente: false,
    })
  ).tokenAcceso;
}, 60_000);

afterAll(async () => {
  await e.limpiar();
  await app.close();
});

describe('Encuestas por HTTP', () => {
  it('sin sesion, 401', async () => {
    expect((await api().get('/encuestas/pendientes')).status).toBe(401);
  });

  it('con sesion lista lo pendiente y dice si falta el consentimiento', async () => {
    const r = await api().get('/encuestas/pendientes').auth(token, { type: 'bearer' });

    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ consentimiento: false });
    expect((r.body as { pendientes: unknown[] }).pendientes.length).toBeGreaterThan(0);
  });

  it('entrega el instrumento activo', async () => {
    const r = await api().get(`/encuestas/instrumentos/${SUS.codigo}`).auth(token, {
      type: 'bearer',
    });
    expect(r.status).toBe(200);
    expect((r.body as { items: unknown[] }).items).toHaveLength(10);
  });

  it('valida el cuerpo antes de mirar nada mas', async () => {
    const r = await api()
      .post('/encuestas/respuestas')
      .auth(token, { type: 'bearer' })
      .send({ codigo: 'SUS', version: 1, momento: 'CUALQUIERA', valores: 'tres' });

    expect(r.status).toBe(400);
    const campos = (r.body as { errores: Array<{ campo: string }> }).errores.map((x) => x.campo);
    expect(campos).toEqual(expect.arrayContaining(['momento', 'valores']));
  });

  it('un cuerpo correcto sin consentimiento recibe 403', async () => {
    const r = await api()
      .post('/encuestas/respuestas')
      .auth(token, { type: 'bearer' })
      .send({
        codigo: 'SUS',
        version: 1,
        momento: 'UNICA',
        valores: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      });

    expect(r.status).toBe(403);
  });
});
