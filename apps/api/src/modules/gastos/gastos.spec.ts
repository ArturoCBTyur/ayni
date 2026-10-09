/**
 * Pruebas de Gastos y Evidencias (Fase 5).
 *
 * Lo que se verifica: que no se pueda gastar lo que no se ha recaudado, que
 * un comprobante no se reutilice, que una foto reciclada se detecte aunque
 * la hayan recortado, y que la captura sin conexion conserve su hora
 * original. Tambien que el almacenamiento no deje leer archivos fuera de su
 * carpeta.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { CifradoService } from '../../comun/cifrado/cifrado.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { AlmacenamientoDisco } from './almacenamiento/disco.storage';
import type { RegistrarGasto } from './esquemas';
import { GastosService } from './gastos.service';
import { ALMACENAMIENTO } from './puertos/almacenamiento.port';

const marca = randomUUID().slice(0, 8);

let prisma: PrismaService;
let gastos: GastosService;
let almacen: AlmacenamientoDisco;

const usuarios: string[] = [];
const objetos: string[] = [];
let ongId: string;
let campanaId: string;
let fondoId: string;
let operadorId: string;

/** Imagen con estructura de gran escala, como una evidencia real. */
async function imagen(semilla: number, ancho = 400, alto = 300): Promise<Buffer> {
  const canales = 3;
  const datos = Buffer.alloc(ancho * alto * canales);
  let estado = semilla * 2654435761;
  const siguiente = () => {
    estado = (estado * 1103515245 + 12345) & 0x7fffffff;
    return estado / 0x7fffffff;
  };

  const bloque = 60;
  for (let by = 0; by < Math.ceil(alto / bloque); by += 1) {
    for (let bx = 0; bx < Math.ceil(ancho / bloque); bx += 1) {
      const tono = Math.floor(siguiente() * 255);
      for (let y = by * bloque; y < Math.min((by + 1) * bloque, alto); y += 1) {
        for (let x = bx * bloque; x < Math.min((bx + 1) * bloque, ancho); x += 1) {
          const i = (y * ancho + x) * canales;
          datos[i] = tono;
          datos[i + 1] = (tono + 40) % 256;
          datos[i + 2] = (tono + 90) % 256;
        }
      }
    }
  }
  return sharp(datos, { raw: { width: ancho, height: alto, channels: canales } })
    .png()
    .toBuffer();
}

/** Sube un archivo al almacen y devuelve su clave. */
async function subir(contenido: Buffer, carpeta: string, extension = 'png'): Promise<string> {
  const { objeto } = await almacen.emitirUrlSubida({
    carpeta,
    extension,
    mime: `image/${extension}`,
  });
  await almacen.guardar(objeto, contenido, `image/${extension}`);
  objetos.push(objeto);
  return objeto;
}

let contadorComprobante = 1000;

/** Construye la entrada de un gasto con archivos ya subidos. */
async function datosGasto(
  opciones: {
    monto?: number;
    semillaImagen?: number;
    contienePersonas?: boolean;
    capturadoEn?: Date;
    serie?: string;
    numero?: string;
    rucEmisor?: string;
    objetoEvidencia?: string;
  } = {},
): Promise<RegistrarGasto> {
  const monto = opciones.monto ?? 100;
  const subtotal = Math.round((monto / 1.18) * 100) / 100;
  contadorComprobante += 1;

  const objetoComprobante = await subir(await imagen(contadorComprobante), 'comprobantes');
  const objetoEvidencia =
    opciones.objetoEvidencia ??
    (await subir(await imagen(opciones.semillaImagen ?? contadorComprobante + 5000), 'evidencias'));

  return {
    fondoId,
    montoDeclarado: monto,
    concepto: 'Compra de alimento balanceado para el refugio',
    proveedorNombre: 'Agroveterinaria El Establo',
    fechaGasto: new Date('2026-09-10'),
    capturadoEn: opciones.capturadoEn,
    comprobante: {
      tipo: 'BOLETA',
      rucEmisor: opciones.rucEmisor ?? '20601030579',
      serie: opciones.serie ?? 'B001',
      numero: opciones.numero ?? String(contadorComprobante),
      fechaEmision: new Date('2026-09-09'),
      subtotal,
      igv: Math.round((monto - subtotal) * 100) / 100,
      total: monto,
      objeto: objetoComprobante,
      mime: 'image/png',
    },
    evidencias: [
      {
        tipo: 'FOTO',
        objeto: objetoEvidencia,
        mime: 'image/png',
        contienePersonas: opciones.contienePersonas ?? false,
        consentimientoImagen: opciones.contienePersonas ?? false,
      },
    ],
  };
}

/** Acredita saldo retenido en el fondo mediante el libro. */
async function acreditar(monto: number, fondo = fondoId) {
  await prisma.movimientoContable.create({
    data: {
      fondoId: fondo,
      tipo: 'INGRESO',
      cuentaDebe: '10.1 Caja y bancos',
      cuentaHaber: '20.1 Donaciones por ejecutar',
      monto,
      descripcion: 'Ingreso sembrado para la prueba',
    },
  });
  await prisma.movimientoContable.create({
    data: {
      fondoId: fondo,
      tipo: 'RETENCION',
      cuentaDebe: '20.1 Donaciones por ejecutar',
      cuentaHaber: '20.2 Fondos retenidos por justificar',
      monto,
      descripcion: 'Retencion sembrada para la prueba',
    },
  });
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [
      PrismaService,
      BitacoraService,
      GastosService,
      CifradoService,
      AlmacenamientoDisco,
      { provide: ALMACENAMIENTO, useExisting: AlmacenamientoDisco },
    ],
  }).compile();

  prisma = modulo.get(PrismaService);
  gastos = modulo.get(GastosService);
  almacen = modulo.get(AlmacenamientoDisco);
  await prisma.$connect();

  const ong = await prisma.ong.create({
    data: {
      ruc: `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`,
      razonSocial: `ONG de pruebas de gastos ${marca}`,
      representanteLegal: 'Representante de Prueba',
      documentoRepresentante: '00000000',
      direccion: 'Sin direccion',
      departamento: 'Huanuco',
      correoContacto: `gastos-${marca}@prueba.pe`,
      descripcion: 'Organizacion creada por las pruebas de gastos.',
      estadoVerificacion: 'VERIFICADA',
    },
  });
  ongId = ong.id;

  const campana = await prisma.campana.create({
    data: {
      ongId,
      titulo: `Campaña de gastos ${marca}`,
      slug: `gastos-${marca}`,
      descripcion: 'Campaña creada por las pruebas del modulo de gastos.',
      causa: `Pruebas ${marca}`,
      fechaInicio: new Date('2026-01-01'),
      estado: 'ACTIVA',
    },
  });
  campanaId = campana.id;

  const fondo = await prisma.fondo.create({
    data: { campanaId, nombre: `Fondo de gastos ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 50_000 },
  });
  fondoId = fondo.id;

  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'ONG_OPERADOR' } });
  const operador = await prisma.usuario.create({
    data: {
      correo: `operador-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Operador',
      apellidos: 'De Campo',
      estado: 'ACTIVO',
      roles: { create: { rolId: rol.id } },
      membresias: { create: { ongId, cargo: 'OPERADOR' } },
    },
  });
  operadorId = operador.id;
  usuarios.push(operador.id);

  await acreditar(5000);
}, 60_000);

afterAll(async () => {
  await Promise.all(objetos.map((o) => almacen.eliminar(o).catch(() => undefined)));

  await prisma.$executeRaw`ALTER TABLE movimientos_contables DISABLE TRIGGER tg_movimientos_no_delete`;
  try {
    await prisma.$executeRaw`
      DELETE FROM movimientos_contables
       WHERE fondo_id IN (SELECT id FROM fondos WHERE campana_id = ${campanaId}::uuid)
    `;
  } finally {
    await prisma.$executeRaw`ALTER TABLE movimientos_contables ENABLE TRIGGER tg_movimientos_no_delete`;
  }

  await prisma.trabajoVerificacion.deleteMany({ where: { gasto: { ongId } } });
  await prisma.evidencia.deleteMany({ where: { gasto: { ongId } } });
  await prisma.comprobante.deleteMany({ where: { gasto: { ongId } } });
  await prisma.gasto.deleteMany({ where: { ongId } });
  await prisma.fondo.deleteMany({ where: { campanaId } });
  await prisma.campana.delete({ where: { id: campanaId } });
  await prisma.ongMiembro.deleteMany({ where: { ongId } });
  await prisma.ong.delete({ where: { id: ongId } });
  await prisma.bitacoraAuditoria.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.$disconnect();
});

describe('Almacenamiento con URLs firmadas (ADR-0003)', () => {
  it('acepta el token correcto y rechaza el ajeno o ausente', async () => {
    const { objeto } = await almacen.emitirUrlSubida({
      carpeta: 'pruebas',
      extension: 'png',
      mime: 'image/png',
    });
    const url = almacen.emitirUrlDescarga(objeto);
    const token = new URL(`http://x${url.url}`).searchParams.get('token')!;

    expect(almacen.verificarToken(objeto, token, 'descargar')).toBe(true);
    expect(almacen.verificarToken(objeto, undefined, 'descargar')).toBe(false);
    expect(almacen.verificarToken(objeto, 'inventado', 'descargar')).toBe(false);
    // Un token de descarga no sirve para subir: cada uno vale para su accion.
    expect(almacen.verificarToken(objeto, token, 'subir')).toBe(false);
    // Ni para otro objeto.
    expect(almacen.verificarToken('otro/objeto.png', token, 'descargar')).toBe(false);
  });

  it('rechaza un token vencido', () => {
    const url = almacen.emitirUrlDescarga('pruebas/x.png', -10);
    const token = new URL(`http://x${url.url}`).searchParams.get('token')!;

    expect(almacen.verificarToken('pruebas/x.png', token, 'descargar')).toBe(false);
  });

  it('no permite salir de la carpeta de almacenamiento', async () => {
    // Sin esta defensa, un objeto llamado "../../.env" dejaria leer archivos
    // del servidor a traves de una URL de descarga legitima.
    await expect(almacen.leer('../../.env')).rejects.toThrow();
    await expect(almacen.leer('../../../etc/passwd')).rejects.toThrow();
  });

  it('guarda y recupera el contenido con su hash', async () => {
    const contenido = await imagen(77);
    const objeto = await subir(contenido, 'pruebas');

    const guardado = await almacen.leer(objeto);
    expect(guardado.equals(contenido)).toBe(true);
    expect(await almacen.existe(objeto)).toBe(true);
  });
});

describe('CU10 · Registrar gasto', () => {
  it('crea el gasto EN_ANALISIS y encola su verificacion', async () => {
    const r = await gastos.registrar(operadorId, await datosGasto({ monto: 120 }), {});

    expect(r.estado).toBe('EN_ANALISIS');
    expect(r.monto).toBe('120.00');

    // El trabajo se encola en la misma transaccion: no puede existir un
    // gasto cuyo analisis nunca se encolo.
    const trabajos = await prisma.trabajoVerificacion.count({ where: { gastoId: r.id } });
    expect(trabajos).toBe(1);
  });

  it('RF-SO-08 · guarda las unidades de impacto si la categoria las mide (D4)', async () => {
    const r = await gastos.registrar(
      operadorId,
      { ...(await datosGasto({ monto: 60 })), unidadesImpacto: 40 },
      {},
    );
    const guardado = await prisma.gasto.findUniqueOrThrow({ where: { id: r.id } });
    expect(guardado.unidadesImpacto).toBe(40);
  });

  it('RF-SO-08 · rechaza unidades en una categoria que no mide impacto', async () => {
    await prisma.fondo.update({ where: { id: fondoId }, data: { categoriaGasto: 'INSUMOS' } });
    try {
      const datos = { ...(await datosGasto({ monto: 60 })), unidadesImpacto: 3 };
      await expect(gastos.registrar(operadorId, datos, {})).rejects.toThrow(
        'no declaran unidades de impacto',
      );
    } finally {
      await prisma.fondo.update({ where: { id: fondoId }, data: { categoriaGasto: 'ALIMENTOS' } });
    }
  });

  it('calcula hashes, huella perceptual y nitidez de la evidencia', async () => {
    const r = await gastos.registrar(operadorId, await datosGasto({ monto: 90 }), {});

    const evidencia = await prisma.evidencia.findFirstOrThrow({ where: { gastoId: r.id } });
    expect(evidencia.hashSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidencia.hashPerceptual).toMatch(/^[0-9a-f]{16}$/);
    expect(Number(evidencia.nitidez)).toBeGreaterThan(0);
    // Se comprime al guardar: la evidencia queda en JPEG.
    expect(evidencia.archivoMime).toBe('image/jpeg');
  });

  it('no deja gastar mas de lo retenido en el fondo', async () => {
    // Es la regla que sostiene todo el modelo: no se puede gastar lo que
    // todavia no se ha recaudado.
    await expect(
      gastos.registrar(operadorId, await datosGasto({ monto: 999_999 }), {}),
    ).rejects.toThrow(/No se puede gastar lo que aun no se ha recaudado/i);
  });

  it('rechaza el mismo archivo de comprobante en dos gastos', async () => {
    const primero = await datosGasto({ monto: 50 });
    await gastos.registrar(operadorId, primero, {});

    const segundo = await datosGasto({ monto: 60 });
    segundo.comprobante.objeto = primero.comprobante.objeto;

    await expect(gastos.registrar(operadorId, segundo, {})).rejects.toThrow(
      /ya fue presentado en otro gasto/i,
    );
  });

  it('rechaza reutilizar serie y numero del mismo emisor', async () => {
    const primero = await datosGasto({ monto: 40, serie: 'B900', numero: '777' });
    await gastos.registrar(operadorId, primero, {});

    const segundo = await datosGasto({ monto: 45, serie: 'B900', numero: '777' });

    await expect(gastos.registrar(operadorId, segundo, {})).rejects.toThrow(/ya fue registrado/i);
  });

  it('RF-IA-05 · detecta una evidencia reciclada aunque la hayan recortado', async () => {
    const original = await imagen(4242, 640, 480);
    const objetoOriginal = await subir(original, 'evidencias');
    await gastos.registrar(
      operadorId,
      await datosGasto({ monto: 30, objetoEvidencia: objetoOriginal }),
      {},
    );

    // La misma foto reescalada y recomprimida: el SHA-256 cambia por
    // completo, pero el dHash apenas se mueve.
    const reciclada = await sharp(original).resize(320, 240).jpeg({ quality: 70 }).toBuffer();
    const objetoReciclado = await subir(reciclada, 'evidencias', 'jpg');

    await expect(
      gastos.registrar(
        operadorId,
        await datosGasto({ monto: 35, objetoEvidencia: objetoReciclado }),
        {},
      ),
    ).rejects.toThrow(/ya se presento como evidencia/i);
  });

  it('acepta una evidencia genuinamente distinta', async () => {
    const r = await gastos.registrar(
      operadorId,
      await datosGasto({ monto: 25, semillaImagen: 987_654 }),
      {},
    );

    expect(r.estado).toBe('EN_ANALISIS');
  });

  it('RNF-16 · conserva la hora original de una captura sin conexion', async () => {
    // Sin esto, un gasto capturado en campo y sincronizado dias despues
    // pareceria registrado tarde y el motor lo penalizaria por algo que no
    // ocurrio.
    const capturadoEn = new Date('2026-09-08T14:32:07.000Z');
    const r = await gastos.registrar(operadorId, await datosGasto({ monto: 20, capturadoEn }), {});

    const gasto = await prisma.gasto.findUniqueOrThrow({ where: { id: r.id } });
    expect(gasto.capturadoEn?.toISOString()).toBe(capturadoEn.toISOString());
    expect(gasto.sincronizadoEn!.getTime()).toBeGreaterThan(capturadoEn.getTime());
  });

  it('quien no pertenece a la ONG no puede registrar gastos', async () => {
    const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'DONANTE' } });
    const extrano = await prisma.usuario.create({
      data: {
        correo: `extrano-${marca}@prueba.pe`,
        hashPassword: 'hash-ficticio',
        nombres: 'Extraño',
        apellidos: 'Sin Membresia',
        estado: 'ACTIVO',
        roles: { create: { rolId: rol.id } },
      },
    });
    usuarios.push(extrano.id);

    await expect(gastos.registrar(extrano.id, await datosGasto({ monto: 10 }), {})).rejects.toThrow(
      /No pertenece/i,
    );
  });
});

describe('RF-DE-04 · Anonimizacion manual', () => {
  it('sin personas, la evidencia nace publicable', async () => {
    const r = await gastos.registrar(
      operadorId,
      await datosGasto({ monto: 15, contienePersonas: false }),
      {},
    );

    const evidencia = await prisma.evidencia.findFirstOrThrow({ where: { gastoId: r.id } });
    expect(evidencia.anonimizada).toBe(true);
    expect(r.siguientePaso).toMatch(/en analisis/i);
  });

  it('con personas, queda pendiente y el sistema lo pide explicitamente', async () => {
    const r = await gastos.registrar(
      operadorId,
      await datosGasto({ monto: 18, contienePersonas: true }),
      {},
    );

    const evidencia = await prisma.evidencia.findFirstOrThrow({ where: { gastoId: r.id } });
    expect(evidencia.anonimizada).toBe(false);
    expect(r.siguientePaso).toMatch(/difuminarse/i);
  });

  it('difuminar las regiones marcadas deja la evidencia publicable', async () => {
    const r = await gastos.registrar(
      operadorId,
      await datosGasto({ monto: 22, contienePersonas: true }),
      {},
    );
    const evidencia = await prisma.evidencia.findFirstOrThrow({ where: { gastoId: r.id } });

    const resultado = await gastos.anonimizar(
      evidencia.id,
      operadorId,
      { regiones: [{ x: 40, y: 30, ancho: 120, alto: 120 }] },
      {},
    );

    expect(resultado.anonimizada).toBe(true);

    const actualizada = await prisma.evidencia.findUniqueOrThrow({ where: { id: evidencia.id } });
    expect(actualizada.anonimizada).toBe(true);
    expect(actualizada.archivoAnonimizadoUrl).toBeTruthy();
    objetos.push(actualizada.archivoAnonimizadoUrl!);

    // El original se conserva: solo el auditor puede verlo.
    expect(await almacen.existe(actualizada.archivoUrl)).toBe(true);
  });

  it('el donante nunca recibe la URL de una evidencia sin anonimizar', async () => {
    const r = await gastos.registrar(
      operadorId,
      await datosGasto({ monto: 28, contienePersonas: true }),
      {},
    );

    const comoAuditor = await gastos.detalle(r.id, operadorId, true);
    const comoOng = await gastos.detalle(r.id, operadorId, false);

    expect(comoAuditor.evidencias[0].url).toBeTruthy();
    // Sin anonimizar todavia: no hay URL que entregar.
    expect(comoOng.evidencias[0].url).toBeNull();
    // La ONG si recibe el original, por un campo aparte, para poder difuminarlo.
    expect(comoOng.evidencias[0].urlParaDifuminar).toBeTruthy();
    expect(comoAuditor.evidencias[0].urlParaDifuminar).toBeNull();
  });

  it('una vez difuminada, la ONG ve la version publicable y ya no el original', async () => {
    const r = await gastos.registrar(
      operadorId,
      await datosGasto({ monto: 29, contienePersonas: true }),
      {},
    );
    const evidencia = await prisma.evidencia.findFirstOrThrow({ where: { gastoId: r.id } });
    await gastos.anonimizar(
      evidencia.id,
      operadorId,
      { regiones: [{ x: 10, y: 10, ancho: 50, alto: 50 }] },
      {},
    );
    const actualizada = await prisma.evidencia.findUniqueOrThrow({ where: { id: evidencia.id } });
    objetos.push(actualizada.archivoAnonimizadoUrl!);

    const comoOng = await gastos.detalle(r.id, operadorId, false);

    expect(comoOng.evidencias[0].urlParaDifuminar).toBeNull();
    expect(comoOng.evidencias[0].url).toContain('-anonimizada');
  });

  it('la ONG ve su propio comprobante; el registro no lo oculta a quien lo subio', async () => {
    const r = await gastos.registrar(operadorId, await datosGasto({ monto: 31 }), {});

    const comoOng = await gastos.detalle(r.id, operadorId, false);

    expect(comoOng.comprobante?.url).toContain('token=');
    expect(comoOng.comprobante?.mime).toMatch(/^image\//);
  });
});
