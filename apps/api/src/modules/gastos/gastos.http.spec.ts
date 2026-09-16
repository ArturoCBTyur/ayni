/**
 * Gastos a traves de HTTP: autorizacion, aislamiento entre organizaciones y
 * validacion de entrada (RNF-03, OWASP ASVS L2).
 *
 * Las demas pruebas del modulo construyen el servicio a mano, que es lo
 * correcto para probar reglas de negocio pero deja sin ejercitar todo lo que
 * ocurre antes de llegar al servicio: el guard que niega por defecto, el
 * decorador de roles y la validacion del cuerpo. Justamente donde vive el
 * control de acceso.
 *
 * El caso que mas importa es el IDOR: las rutas de gastos no llevan @Roles,
 * porque no alcanza con el rol —un operador de ONG si puede registrar
 * gastos, pero solo los de su organizacion—. Quien autoriza es la membresia,
 * comprobada dentro del servicio, y eso hay que demostrarlo pidiendolo de
 * verdad por la red.
 */
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import express from 'express';
import type { Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import request from 'supertest';

import { BitacoraModule } from '../../comun/bitacora/bitacora.module';
import { PrismaModule } from '../../comun/prisma/prisma.module';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { IdentidadModule } from '../identidad/identidad.module';
import { TokensService } from '../identidad/servicios/tokens.service';
import { AlmacenamientoDisco } from './almacenamiento/disco.storage';
import { GastosModule } from './gastos.module';

const marca = randomUUID().slice(0, 8);

let app: INestApplication;
let prisma: PrismaService;
let tokens: TokensService;
let almacen: AlmacenamientoDisco;

const usuarios: string[] = [];
const ongs: string[] = [];
const objetos: string[] = [];

/** Token de acceso de un usuario, como el que emite el login. */
let tokenOperadorA: string;
let tokenOperadorB: string;
let tokenDonante: string;
let tokenAdmin: string;

let ongA: string;
let ongB: string;
let fondoA: string;

/**
 * El servidor HTTP, tipado.
 *
 * getHttpServer() declara `any`, y dejarlo suelto convierte cada peticion de
 * esta suite en codigo sin tipos.
 */
function api() {
  return request(app.getHttpServer() as Server);
}

/** Mensaje de error del cuerpo de una respuesta. */
function mensaje(r: request.Response): string {
  return (r.body as { message?: string }).message ?? '';
}

/** Errores por campo que devuelve ZodPipe. */
function errores(r: request.Response): { campo: string; mensaje: string }[] {
  return (r.body as { errores?: { campo: string; mensaje: string }[] }).errores ?? [];
}

async function crearOng(nombre: string): Promise<{ ongId: string; fondoId: string }> {
  const ong = await prisma.ong.create({
    data: {
      ruc: `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`,
      razonSocial: `${nombre} ${marca}`,
      representanteLegal: 'Representante de Prueba',
      documentoRepresentante: '00000000',
      direccion: 'Sin direccion',
      departamento: 'Huanuco',
      correoContacto: `${nombre.toLowerCase().replace(/\W+/g, '')}-${marca}@prueba.pe`,
      descripcion: 'Organizacion creada por las pruebas HTTP de gastos.',
      estadoVerificacion: 'VERIFICADA',
    },
  });
  ongs.push(ong.id);

  const campana = await prisma.campana.create({
    data: {
      ongId: ong.id,
      titulo: `Campaña ${nombre} ${marca}`,
      slug: `${nombre.toLowerCase().replace(/\W+/g, '')}-${marca}`,
      descripcion: 'Campaña creada por las pruebas HTTP de gastos.',
      causa: `Pruebas ${marca}`,
      fechaInicio: new Date('2026-01-01'),
      estado: 'ACTIVA',
    },
  });

  const fondo = await prisma.fondo.create({
    data: {
      campanaId: campana.id,
      nombre: `Fondo ${nombre} ${marca}`,
      categoriaGasto: 'ALIMENTOS',
      meta: 50_000,
    },
  });

  return { ongId: ong.id, fondoId: fondo.id };
}

/** Usuario con un rol y, opcionalmente, membresia en una ONG. */
async function crearUsuario(
  rolCodigo: string,
  etiqueta: string,
  ongId?: string,
): Promise<string> {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: rolCodigo } });
  const usuario = await prisma.usuario.create({
    data: {
      correo: `${etiqueta}-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: etiqueta,
      apellidos: 'De Prueba',
      estado: 'ACTIVO',
      roles: { create: { rolId: rol.id } },
      ...(ongId ? { membresias: { create: { ongId, cargo: 'OPERADOR' } } } : {}),
      ...(rolCodigo === 'DONANTE' ? { donante: { create: {} } } : {}),
    },
  });
  usuarios.push(usuario.id);

  const par = await tokens.emitir({
    sub: usuario.id,
    correo: usuario.correo,
    roles: [rolCodigo],
    ongs: ongId ? [{ ongId, cargo: 'OPERADOR' }] : [],
    mfaPendiente: false,
  });
  return par.tokenAcceso;
}

/**
 * Quita el prefijo de despliegue de una URL firmada.
 *
 * La URL se emite con el API_PREFIX configurado ("/api/v1"), porque es la que
 * el cliente usa contra el servidor real. La aplicacion de prueba se monta en
 * la raiz, sin setGlobalPrefix, asi que hay que quitarlo: es la misma
 * operacion que hace ClienteApi.subirArchivo en el frontend.
 */
function sinPrefijo(url: string): string {
  return url.replace(/^\/api\/v\d+/, '');
}

/** Cuerpo valido para registrar un gasto. */
function cuerpoGasto(fondoId: string) {
  return {
    fondoId,
    montoDeclarado: 50,
    concepto: 'Alimento balanceado para el albergue',
    proveedorNombre: 'Veterinaria Amarilis',
    fechaGasto: '2026-03-10',
    comprobante: {
      tipo: 'BOLETA',
      // RUC valido por modulo 11; el esquema lo comprueba antes de llegar
      // al servicio.
      rucEmisor: '20100070970',
      serie: 'B001',
      numero: '000123',
      fechaEmision: '2026-03-10',
      subtotal: 42.37,
      igv: 7.63,
      total: 50,
      objeto: `comprobantes/${marca}-c.jpg`,
      mime: 'image/jpeg',
    },
    evidencias: [
      {
        tipo: 'FOTO',
        objeto: `evidencias/${marca}-e.jpg`,
        mime: 'image/jpeg',
        contienePersonas: false,
      },
    ],
  };
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] }),
      PrismaModule,
      BitacoraModule,
      // Trae consigo el AccesoGuard global: es donde lo registra la aplicacion
      // real, asi que montarlo a mano seria probar otra configuracion.
      IdentidadModule,
      GastosModule,
    ],
  }).compile();

  // rawBody, igual que main.ts: la subida por URL firmada lee el cuerpo crudo.
  app = modulo.createNestApplication({ rawBody: true });

  // El mismo middleware que monta main.ts. Sin el, el PUT binario llega con
  // el cuerpo vacio: express no parsea image/* por defecto. Que esto haga
  // falta aqui es la senal de que la subida depende de como se arma la
  // aplicacion, no solo del modulo.
  app.use(
    express.raw({
      type: ['image/*', 'application/pdf', 'video/*', 'application/octet-stream'],
      limit: '25mb',
    }),
  );

  await app.init();

  prisma = modulo.get(PrismaService);
  tokens = modulo.get(TokensService);
  almacen = modulo.get(AlmacenamientoDisco);

  const a = await crearOng('OngHttpA');
  const b = await crearOng('OngHttpB');
  ongA = a.ongId;
  fondoA = a.fondoId;
  ongB = b.ongId;

  tokenOperadorA = await crearUsuario('ONG_OPERADOR', 'opa', ongA);
  tokenOperadorB = await crearUsuario('ONG_OPERADOR', 'opb', ongB);
  tokenDonante = await crearUsuario('DONANTE', 'donhttp');
  tokenAdmin = await crearUsuario('ADMIN', 'adminhttp');
}, 60_000);

afterAll(async () => {
  await Promise.all(objetos.map((o) => almacen.eliminar(o).catch(() => undefined)));
  await prisma.sesion.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.bitacoraAuditoria.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.donante.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.ongMiembro.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.fondo.deleteMany({ where: { campana: { ongId: { in: ongs } } } });
  await prisma.campana.deleteMany({ where: { ongId: { in: ongs } } });
  await prisma.ong.deleteMany({ where: { id: { in: ongs } } });
  await app.close();
});

describe('El guard niega por defecto (RNF-02)', () => {
  it('sin token no se llega a ninguna ruta de gastos', async () => {
    const r = await api().get(`/ongs/${ongA}/gastos`);

    expect(r.status).toBe(401);
    // El mensaje dice que hacer, no solo que fallo (RF-PS-05).
    expect(mensaje(r)).toMatch(/iniciar sesion/i);
  });

  it('con un token inventado tampoco', async () => {
    const r = await api()
      .get(`/ongs/${ongA}/gastos`)
      .set('Authorization', 'Bearer no-es-un-token');

    expect(r.status).toBe(401);
  });

  it('una ruta marcada con @Roles rechaza al que no lo tiene', async () => {
    const sinPermiso = await api()
      .get('/almacenamiento-estado')
      .set('Authorization', `Bearer ${tokenOperadorA}`);
    expect(sinPermiso.status).toBe(403);

    const conPermiso = await api()
      .get('/almacenamiento-estado')
      .set('Authorization', `Bearer ${tokenAdmin}`);
    expect(conPermiso.status).toBe(200);
  });
});

describe('Aislamiento entre organizaciones (IDOR)', () => {
  it('un operador no puede listar los gastos de otra ONG', async () => {
    const propia = await api()
      .get(`/ongs/${ongA}/gastos`)
      .set('Authorization', `Bearer ${tokenOperadorA}`);
    expect(propia.status).toBe(200);

    // Mismo rol, misma ruta, solo cambia el identificador del recurso: es
    // exactamente la forma de un IDOR.
    const ajena = await api()
      .get(`/ongs/${ongB}/gastos`)
      .set('Authorization', `Bearer ${tokenOperadorA}`);
    expect(ajena.status).toBe(403);
    expect(mensaje(ajena)).toMatch(/no pertenece a esa organizacion/i);
  });

  it('un operador no puede registrar un gasto contra el fondo de otra ONG', async () => {
    const r = await api()
      .post('/gastos')
      .set('Authorization', `Bearer ${tokenOperadorB}`)
      .send(cuerpoGasto(fondoA));

    expect(r.status).toBe(403);
    expect(mensaje(r)).toMatch(/no pertenece a esa organizacion/i);
  });

  it('un donante no puede registrar gastos aunque tenga sesion valida', async () => {
    const r = await api()
      .post('/gastos')
      .set('Authorization', `Bearer ${tokenDonante}`)
      .send(cuerpoGasto(fondoA));

    expect(r.status).toBe(403);
  });

  it('un fondo inexistente responde 404, no filtra si existe o no se puede ver', async () => {
    const r = await api()
      .post('/gastos')
      .set('Authorization', `Bearer ${tokenOperadorA}`)
      .send(cuerpoGasto(randomUUID()));

    expect(r.status).toBe(404);
  });
});

describe('Validacion del cuerpo antes de tocar el dominio (RF-PS-05)', () => {
  it('senala el campo y el motivo, no un mensaje generico', async () => {
    const cuerpo = cuerpoGasto(fondoA);
    cuerpo.montoDeclarado = -10;
    cuerpo.concepto = 'no';

    const r = await api()
      .post('/gastos')
      .set('Authorization', `Bearer ${tokenOperadorA}`)
      .send(cuerpo);

    expect(r.status).toBe(400);
    const campos = errores(r).map((e) => e.campo);
    expect(campos).toContain('montoDeclarado');
    expect(campos).toContain('concepto');
  });

  it('rechaza un RUC que no pasa el digito verificador', async () => {
    const cuerpo = cuerpoGasto(fondoA);
    cuerpo.comprobante.rucEmisor = '20100070971';

    const r = await api()
      .post('/gastos')
      .set('Authorization', `Bearer ${tokenOperadorA}`)
      .send(cuerpo);

    expect(r.status).toBe(400);
    expect(JSON.stringify(errores(r))).toMatch(/ruc/i);
  });

  it('exige el consentimiento de imagen si la evidencia muestra personas', async () => {
    const cuerpo = cuerpoGasto(fondoA);
    cuerpo.evidencias[0].contienePersonas = true;

    const r = await api()
      .post('/gastos')
      .set('Authorization', `Bearer ${tokenOperadorA}`)
      .send(cuerpo);

    // RF-DE-04: la proteccion del beneficiario empieza en el borde de la API,
    // antes de que el archivo llegue a tocar el disco.
    expect(r.status).toBe(400);
    expect(JSON.stringify(errores(r))).toMatch(/consentimiento/i);
  });

  it('rechaza un comprobante emitido despues de la fecha del gasto', async () => {
    const cuerpo = cuerpoGasto(fondoA);
    cuerpo.comprobante.fechaEmision = '2026-03-20';

    const r = await api()
      .post('/gastos')
      .set('Authorization', `Bearer ${tokenOperadorA}`)
      .send(cuerpo);

    expect(r.status).toBe(400);
    const campos = errores(r).map((e) => e.campo);
    expect(campos).toContain('comprobante.fechaEmision');
  });

  it('un identificador que no es UUID no llega al servicio', async () => {
    const r = await api()
      .get('/gastos/no-es-uuid')
      .set('Authorization', `Bearer ${tokenOperadorA}`);

    expect(r.status).toBe(400);
  });
});

describe('URL firmada: el enlace es la autorizacion (ADR-0003)', () => {
  it('solo un miembro de una ONG puede pedir un enlace de subida', async () => {
    const donante = await api()
      .post('/gastos/url-subida')
      .set('Authorization', `Bearer ${tokenDonante}`)
      .send({ tipo: 'evidencia', extension: 'jpg' });

    expect(donante.status).toBe(403);
    expect(mensaje(donante)).toMatch(/miembros de una ONG/i);
  });

  it('sube y descarga el mismo archivo con los enlaces emitidos', async () => {
    const emision = await api()
      .post('/gastos/url-subida')
      .set('Authorization', `Bearer ${tokenOperadorA}`)
      .send({ tipo: 'evidencia', extension: 'jpg' });

    expect(emision.status).toBe(201);
    const { url, objeto } = emision.body as { url: string; objeto: string };
    objetos.push(objeto);

    const contenido = Buffer.from('contenido de prueba de una evidencia');
    const subida = await api()
      .put(sinPrefijo(url))
      .set('Content-Type', 'image/jpeg')
      .send(contenido);

    expect(subida.status).toBe(200);
    expect((subida.body as { bytes: number }).bytes).toBe(contenido.byteLength);

    const descarga = await api().get(sinPrefijo(almacen.emitirUrlDescarga(objeto).url));

    expect(descarga.status).toBe(200);
    expect(descarga.body).toEqual(contenido);
  });

  it('un enlace con la firma alterada no sirve', async () => {
    const { url, objeto } = almacen.emitirUrlDescarga(`evidencias/${marca}-inexistente.jpg`);
    objetos.push(objeto);

    // Se cambia un caracter de la firma: si la verificacion fuera por
    // comparacion laxa, esto seguiria pasando.
    const alterado = url.replace(/.$/, (c) => (c === 'a' ? 'b' : 'a'));
    const r = await api().get(sinPrefijo(alterado));

    expect(r.status).toBe(401);
  });

  it('un enlace vencido no sirve, aunque la firma sea la correcta', async () => {
    const { url } = almacen.emitirUrlDescarga(`evidencias/${marca}-vencido.jpg`, -60);
    const r = await api().get(sinPrefijo(url));

    expect(r.status).toBe(401);
  });

  it('sin token no entrega nada', async () => {
    const r = await api().get(`/almacenamiento/evidencias/${marca}-e.jpg`);

    expect(r.status).toBe(401);
  });

  it('un enlace valido de un objeto que no existe responde 404', async () => {
    const { url } = almacen.emitirUrlDescarga(`evidencias/${marca}-fantasma.jpg`);
    const r = await api().get(sinPrefijo(url));

    expect(r.status).toBe(404);
  });

  it('una subida sin cuerpo se rechaza', async () => {
    const emision = await api()
      .post('/gastos/url-subida')
      .set('Authorization', `Bearer ${tokenOperadorA}`)
      .send({ tipo: 'comprobante', extension: 'pdf' });

    const { url, objeto } = emision.body as { url: string; objeto: string };
    objetos.push(objeto);

    const r = await api().put(sinPrefijo(url)).set('Content-Type', 'application/pdf');

    expect(r.status).toBe(400);
    expect(mensaje(r)).toMatch(/no se recibio ningun archivo/i);
  });
});
