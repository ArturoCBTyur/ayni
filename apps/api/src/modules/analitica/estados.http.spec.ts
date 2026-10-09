/**
 * Quien ve los estados mensuales, comprobado por HTTP (RF-CF-08).
 *
 * Las rutas no llevan @Roles: el miembro de la ONG dueña las ve por su
 * membresia, y un operador de otra ONG tiene el mismo rol. Por eso la prueba
 * pasa por el guard global y por el servicio, como en la aplicacion.
 *
 * El cierre forzado se reemplaza por un doble: el de verdad cerraria todos
 * los fondos de la base, incluidos los de la demostracion, y un cierre no se
 * borra.
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
import { ContableModule } from '../contable/contable.module';
import { IdentidadModule } from '../identidad/identidad.module';
import { TokensService } from '../identidad/servicios/tokens.service';
import { AnaliticaModule } from './analitica.module';
import { CierresService } from './cierres.service';

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokensService;
let e: EscenarioContable;
let otra: EscenarioContable;

const cierreForzado = jest.fn().mockResolvedValue({ hasta: '2026-09', cierres: 0 });

function api() {
  return request(app.getHttpServer() as Server);
}

async function token(usuarioId: string, roles: string[], ongId?: string): Promise<string> {
  const par = await tokens.emitir({
    sub: usuarioId,
    correo: `${usuarioId}@prueba.pe`,
    roles,
    ongs: ongId ? [{ ongId, cargo: 'OPERADOR' }] : [],
    mfaPendiente: false,
  });
  return par.tokenAcceso;
}

/** Recibe el cuerpo binario como Buffer, sin que supertest lo interprete. */
function binario(res: request.Response, fin: (err: Error | null, cuerpo: Buffer) => void) {
  const partes: Buffer[] = [];
  res.on('data', (p: Buffer) => partes.push(p));
  res.on('end', () => fin(null, Buffer.concat(partes)));
}

let admin: string;
let auditor: string;
let miembro: string;
let ajeno: string;
let donante: string;

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] }),
      PrismaModule,
      BitacoraModule,
      ContableModule,
      IdentidadModule,
      AnaliticaModule,
    ],
  })
    .overrideProvider(CierresService)
    .useValue({ cerrarPendientes: cierreForzado })
    .compile();

  app = modulo.createNestApplication();
  await app.init();

  prisma = modulo.get(PrismaService);
  tokens = modulo.get(TokensService);

  e = await crearEscenarioContable(prisma, 'estados-http');
  otra = await crearEscenarioContable(prisma, 'estados-http-otra');
  await e.donar(100, 4.44, new Date('2026-07-10T15:00:00Z'));

  admin = await token(e.donanteUsuarioId, ['ADMIN']);
  auditor = await token(e.donanteUsuarioId, ['AUDITOR']);
  miembro = await token(e.operadorId, ['ONG_OPERADOR'], e.ongId);
  // Mismo rol, otra organizacion.
  ajeno = await token(otra.operadorId, ['ONG_OPERADOR'], otra.ongId);
  donante = await token(e.donanteUsuarioId, ['DONANTE']);
}, 60_000);

afterAll(async () => {
  await e.limpiar();
  await otra.limpiar();
  await app.close();
});

const ruta = () => `/analitica/estados/fondos/${e.fondoId}`;

describe('RF-CF-08 · Quien ve los estados de un fondo', () => {
  it.each([
    ['el administrador', () => admin],
    ['el auditor', () => auditor],
    ['un miembro de la ONG dueña', () => miembro],
  ])('%s los ve', async (_, quien) => {
    const r = await api()
      .get(ruta())
      .query({ periodo: '2026-07' })
      .set('Authorization', `Bearer ${quien()}`);

    expect(r.status).toBe(200);
    expect(
      (r.body as { estado: { actividades: { donacionesBrutas: string } } }).estado.actividades
        .donacionesBrutas,
    ).toBe('100.00');
  });

  it.each([
    ['un miembro de otra ONG, con el mismo rol', () => ajeno],
    ['un donante', () => donante],
  ])('%s recibe 403', async (_, quien) => {
    const r = await api()
      .get(ruta())
      .query({ periodo: '2026-07' })
      .set('Authorization', `Bearer ${quien()}`);

    expect(r.status).toBe(403);
  });

  it('sin sesion, 401', async () => {
    expect((await api().get(ruta()).query({ periodo: '2026-07' })).status).toBe(401);
  });

  it('la lista de meses y el PLE siguen la misma regla', async () => {
    const periodos = `${ruta()}/periodos`;
    const plePath = `/analitica/ple/ongs/${e.ongId}`;

    expect((await api().get(periodos).set('Authorization', `Bearer ${miembro}`)).status).toBe(200);
    expect((await api().get(periodos).set('Authorization', `Bearer ${ajeno}`)).status).toBe(403);
    expect(
      (
        await api()
          .get(plePath)
          .query({ periodo: '2026-07' })
          .set('Authorization', `Bearer ${ajeno}`)
      ).status,
    ).toBe(403);
  });

  it('solo el administrador fuerza el cierre mensual', async () => {
    const forzar = '/analitica/estados/cierres/ejecutar';

    expect((await api().post(forzar).set('Authorization', `Bearer ${miembro}`)).status).toBe(403);
    expect((await api().post(forzar).set('Authorization', `Bearer ${auditor}`)).status).toBe(403);
    expect(cierreForzado).not.toHaveBeenCalled();

    expect((await api().post(forzar).set('Authorization', `Bearer ${admin}`)).status).toBe(201);
    expect(cierreForzado).toHaveBeenCalledTimes(1);
  });
});

describe('RF-CF-08 · Formatos', () => {
  it('entrega Excel con su tipo y su nombre de archivo', async () => {
    const r = await api()
      .get(ruta())
      .query({ periodo: '2026-07', formato: 'xlsx' })
      .set('Authorization', `Bearer ${miembro}`)
      .buffer(true)
      .parse(binario);

    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('spreadsheetml.sheet');
    expect(r.headers['content-disposition']).toContain(`-2026-07.xlsx"`);
    expect((r.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('entrega PDF', async () => {
    const r = await api()
      .get(ruta())
      .query({ periodo: '2026-07', formato: 'pdf' })
      .set('Authorization', `Bearer ${miembro}`)
      .buffer(true)
      .parse(binario);

    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toContain('application/pdf');
    expect((r.body as Buffer).subarray(0, 8).toString()).toBe('%PDF-1.4');
  });

  it('entrega el borrador PLE como texto, con BORRADOR en el nombre', async () => {
    const r = await api()
      .get(`/analitica/ple/ongs/${e.ongId}`)
      .query({ periodo: '2026-07', libro: 'mayor' })
      .set('Authorization', `Bearer ${miembro}`)
      .buffer(true)
      .parse(binario);

    expect(r.status).toBe(200);
    expect(r.headers['content-disposition']).toContain('BORRADOR-LE');
    expect((r.body as Buffer).toString('utf8').split('\r\n')[0]).toMatch(/^20260700\|/);
  });

  it('valida el periodo y el formato antes de tocar el libro', async () => {
    const r = await api()
      .get(ruta())
      .query({ periodo: '2026-7', formato: 'docx' })
      .set('Authorization', `Bearer ${miembro}`);

    expect(r.status).toBe(400);
    const campos = (r.body as { errores: Array<{ campo: string }> }).errores.map((x) => x.campo);
    expect(campos).toEqual(expect.arrayContaining(['periodo', 'formato']));
  });

  it('un fondo que no existe da 404 y un id que no es UUID, 400', async () => {
    const noExiste = await api()
      .get('/analitica/estados/fondos/00000000-0000-0000-0000-000000000000')
      .query({ periodo: '2026-07' })
      .set('Authorization', `Bearer ${admin}`);
    const malo = await api()
      .get('/analitica/estados/fondos/no-es-uuid')
      .query({ periodo: '2026-07' })
      .set('Authorization', `Bearer ${admin}`);

    expect(noExiste.status).toBe(404);
    expect(malo.status).toBe(400);
  });
});
