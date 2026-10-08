/**
 * Quien puede donar, comprobado por HTTP.
 *
 * Las pruebas del servicio llaman a `donar` directo y por eso no ven el
 * decorador de roles. Aqui la peticion pasa por el guard global, que es donde
 * se decide que un operador de ONG o un auditor no aportan: antes la ruta no
 * tenia @Roles y la app mostraba el boton de donar a cualquier sesion.
 */
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import request from 'supertest';

import { BitacoraModule } from '../../comun/bitacora/bitacora.module';
import { PrismaModule } from '../../comun/prisma/prisma.module';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { ContableModule } from '../contable/contable.module';
import { IdentidadModule } from '../identidad/identidad.module';
import { TokensService } from '../identidad/servicios/tokens.service';
import { DonacionesModule } from './donaciones.module';

const marca = randomUUID().slice(0, 8);

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokensService;

const usuarios: string[] = [];
let ongId: string;
let campanaId: string;
let fondoId: string;

function api() {
  return request(app.getHttpServer() as Server);
}

function mensaje(r: request.Response): string {
  return (r.body as { message?: string }).message ?? '';
}

/** Cuenta con sus roles y, si se indica, miembro de la ONG de la suite. */
async function crearCuenta(
  roles: string[],
  etiqueta: string,
  opciones: { miembro?: boolean } = {},
): Promise<string> {
  const catalogo = await prisma.rol.findMany({ where: { codigo: { in: roles } } });
  const usuario = await prisma.usuario.create({
    data: {
      correo: `${etiqueta}-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: etiqueta,
      apellidos: 'De Prueba',
      estado: 'ACTIVO',
      roles: { create: catalogo.map((r) => ({ rolId: r.id })) },
      ...(roles.includes('DONANTE') ? { donante: { create: {} } } : {}),
      ...(opciones.miembro ? { membresias: { create: { ongId, cargo: 'OPERADOR' } } } : {}),
    },
  });
  usuarios.push(usuario.id);

  const par = await tokens.emitir({
    sub: usuario.id,
    correo: usuario.correo,
    roles,
    ongs: opciones.miembro ? [{ ongId, cargo: 'OPERADOR' }] : [],
    mfaPendiente: false,
  });
  return par.tokenAcceso;
}

const donacion = () => ({ fondoId, monto: 30, tokenTarjeta: 'tok_ok_4242' });
const suscripcion = () => ({ fondoId, monto: 20, diaCobro: 5, tokenTarjeta: 'tok_ok_4242' });

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] }),
      PrismaModule,
      BitacoraModule,
      ContableModule,
      // Trae el AccesoGuard global, igual que en la aplicacion real.
      IdentidadModule,
      DonacionesModule,
    ],
  }).compile();

  app = modulo.createNestApplication();
  await app.init();

  prisma = modulo.get(PrismaService);
  tokens = modulo.get(TokensService);

  const ong = await prisma.ong.create({
    data: {
      ruc: `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`,
      razonSocial: `ONG de permisos de donacion ${marca}`,
      representanteLegal: 'Representante de Prueba',
      documentoRepresentante: '00000000',
      direccion: 'Sin direccion',
      departamento: 'Huanuco',
      correoContacto: `permisos-${marca}@prueba.pe`,
      descripcion: 'Organizacion creada por las pruebas HTTP de donaciones.',
      estadoVerificacion: 'VERIFICADA',
    },
  });
  ongId = ong.id;

  const campana = await prisma.campana.create({
    data: {
      ongId,
      titulo: `Campaña de permisos ${marca}`,
      slug: `permisos-donacion-${marca}`,
      descripcion: 'Campaña creada por las pruebas HTTP de donaciones.',
      causa: `Pruebas ${marca}`,
      fechaInicio: new Date('2026-01-01'),
      estado: 'ACTIVA',
    },
  });
  campanaId = campana.id;

  const fondo = await prisma.fondo.create({
    data: { campanaId, nombre: `Fondo ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 10_000 },
  });
  fondoId = fondo.id;
}, 30_000);

afterAll(async () => {
  // Ninguna donacion de esta suite se confirma, asi que el libro no se toca.
  await prisma.pago.deleteMany({ where: { donacion: { fondo: { campanaId } } } });
  await prisma.suscripcion.deleteMany({ where: { ongId } });
  await prisma.donacion.deleteMany({ where: { fondo: { campanaId } } });
  await prisma.fondo.deleteMany({ where: { campanaId } });
  await prisma.campana.delete({ where: { id: campanaId } });
  await prisma.ongMiembro.deleteMany({ where: { ongId } });
  await prisma.ong.delete({ where: { id: ongId } });
  await prisma.bitacoraAuditoria.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.donante.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
  await app.close();
});

describe('Quien puede donar', () => {
  it('un donante dona', async () => {
    const token = await crearCuenta(['DONANTE'], 'donante');
    const r = await api().post('/donaciones').auth(token, { type: 'bearer' }).send(donacion());
    expect(r.status).toBe(201);
  });

  it.each([['ONG_OPERADOR'], ['ONG_ADMIN'], ['AUDITOR'], ['ADMIN']])(
    '%s sin rol de donante no dona ni se suscribe',
    async (rol) => {
      const token = await crearCuenta([rol], `sin-donante-${rol.toLowerCase()}`);

      const d = await api().post('/donaciones').auth(token, { type: 'bearer' }).send(donacion());
      expect(d.status).toBe(403);
      expect(mensaje(d)).toMatch(/rol no tiene permiso/i);

      const s = await api()
        .post('/suscripciones')
        .auth(token, { type: 'bearer' })
        .send(suscripcion());
      expect(s.status).toBe(403);
    },
  );

  it('quien es donante y miembro de la ONG no dona a su propia organizacion', async () => {
    const token = await crearCuenta(['DONANTE', 'ONG_ADMIN'], 'donante-miembro', { miembro: true });

    const r = await api().post('/donaciones').auth(token, { type: 'bearer' }).send(donacion());
    expect(r.status).toBe(403);
    expect(mensaje(r)).toMatch(/miembro/i);
  });

  it('sin sesion no se dona', async () => {
    const r = await api().post('/donaciones').send(donacion());
    expect(r.status).toBe(401);
  });
});
