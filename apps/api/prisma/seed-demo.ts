/**
 * Seed de demostracion.
 *
 * Deja la base en el estado exacto que recorre el guion de la seccion 8.1
 * del Entregable 2, para que la demo empiece con historia y no con pantallas
 * vacias. Genera datos coherentes de punta a punta: la donacion pasa por el
 * libro, el gasto pasa por el motor de verificacion y la narrativa se redacta
 * con la plantilla real.
 *
 * Es idempotente: detecta si ya corrio y no duplica nada.
 */
import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import sharp from 'sharp';

import { calcularDHash, calcularNitidez } from '../src/modules/gastos/imagen';

const prisma = new PrismaClient();
const RAIZ_ARCHIVOS = resolve(process.cwd(), process.env.STORAGE_DIR ?? '../../storage');

/** Imagen sintetica con estructura, para que el dHash tenga que describir. */
async function imagenDemo(semilla: number, ancho = 800, alto = 600): Promise<Buffer> {
  const canales = 3;
  const datos = Buffer.alloc(ancho * alto * canales);
  let estado = semilla * 2654435761;
  const siguiente = () => {
    estado = (estado * 1103515245 + 12345) & 0x7fffffff;
    return estado / 0x7fffffff;
  };

  const bloque = 80;
  for (let by = 0; by < Math.ceil(alto / bloque); by += 1) {
    for (let bx = 0; bx < Math.ceil(ancho / bloque); bx += 1) {
      const tono = Math.floor(siguiente() * 200) + 30;
      for (let y = by * bloque; y < Math.min((by + 1) * bloque, alto); y += 1) {
        for (let x = bx * bloque; x < Math.min((bx + 1) * bloque, ancho); x += 1) {
          const i = (y * ancho + x) * canales;
          datos[i] = tono;
          datos[i + 1] = (tono + 30) % 256;
          datos[i + 2] = (tono + 70) % 256;
        }
      }
    }
  }

  return sharp(datos, { raw: { width: ancho, height: alto, channels: canales } })
    .jpeg({ quality: 85 })
    .toBuffer();
}

async function guardarArchivo(objeto: string, contenido: Buffer): Promise<void> {
  const ruta = join(RAIZ_ARCHIVOS, objeto);
  await mkdir(dirname(ruta), { recursive: true });
  await writeFile(ruta, contenido);
}

async function main() {
  const yaCorrio = await prisma.gasto.count();
  if (yaCorrio > 0) {
    console.info('El seed de demostracion ya se aplico. Nada que hacer.');
    return;
  }

  const donante = await prisma.donante.findFirstOrThrow({
    where: { usuario: { correo: 'donante@demo.pe' } },
    include: { usuario: true },
  });
  const operador = await prisma.usuario.findUniqueOrThrow({
    where: { correo: 'ong.operador@demo.pe' },
  });
  const ong = await prisma.ong.findFirstOrThrow();

  const fondoVeterinaria = await prisma.fondo.findFirstOrThrow({
    where: { nombre: 'Atencion veterinaria' },
  });
  const fondoAlimentos = await prisma.fondo.findFirstOrThrow({
    where: { nombre: 'Alimentos para rescate animal' },
  });

  console.info('Sembrando el escenario de demostracion...');

  // ---- 1. Donaciones confirmadas ----------------------------------------
  // Se asientan por el libro, no con UPDATE: los saldos los mantiene el
  // trigger y asi la cadena de hashes queda coherente desde el inicio.
  const donaciones: Array<{ id: string; monto: number }> = [];

  for (const [fondo, monto, comision] of [
    [fondoVeterinaria, 200, 7.88],
    [fondoVeterinaria, 150, 6.16],
    [fondoAlimentos, 300, 11.32],
  ] as const) {
    const neto = Number((monto - comision).toFixed(2));

    const donacion = await prisma.donacion.create({
      data: {
        donanteId: donante.id,
        fondoId: fondo.id,
        monto,
        montoNeto: neto,
        estado: 'CONFIRMADA',
        confirmadaEn: new Date(Date.now() - 6 * 86_400_000),
        pago: {
          create: {
            pasarela: 'fake',
            referenciaExterna: `fk_demo_${randomUUID().replace(/-/g, '').slice(0, 16)}`,
            tokenTarjeta: 'tok_ok_4242',
            monto,
            comision,
            montoNeto: neto,
            estado: 'APROBADO',
            metodo: 'tarjeta',
            ultimos4: '4242',
            marca: 'Visa',
            procesadoEn: new Date(Date.now() - 6 * 86_400_000),
          },
        },
      },
    });

    for (const [tipo, importe, debe, haber, descripcion] of [
      ['INGRESO', monto, '10.1 Caja y bancos', '20.1 Donaciones por ejecutar', 'Ingreso de donacion'],
      ['COMISION', comision, '63.1 Comisiones de pasarela', '10.1 Caja y bancos', 'Comision de la pasarela de pago'],
      ['RETENCION', neto, '20.1 Donaciones por ejecutar', '20.2 Fondos retenidos por justificar', 'Retencion condicionada a evidencia de gasto'],
    ] as const) {
      await prisma.movimientoContable.create({
        data: {
          fondoId: fondo.id,
          donacionId: donacion.id,
          tipo,
          cuentaDebe: debe,
          cuentaHaber: haber,
          monto: importe,
          descripcion,
        },
      });
    }

    donaciones.push({ id: donacion.id, monto });
  }
  console.info(`  donaciones: ${donaciones.length} confirmadas y retenidas`);

  // ---- 2. Un gasto listo para que el motor lo analice --------------------
  const comprobanteObjeto = `comprobantes/demo-${randomUUID()}.jpg`;
  const evidenciaObjeto = `evidencias/demo-${randomUUID()}.jpg`;

  const imagenComprobante = await imagenDemo(11);
  const imagenEvidencia = await imagenDemo(97);
  await guardarArchivo(comprobanteObjeto, imagenComprobante);
  await guardarArchivo(evidenciaObjeto, imagenEvidencia);

  const gasto = await prisma.gasto.create({
    data: {
      fondoId: fondoVeterinaria.id,
      ongId: ong.id,
      registradoPor: operador.id,
      montoDeclarado: 118,
      concepto: 'atencion veterinaria de urgencia de tres perros rescatados',
      proveedorNombre: 'Clinica Veterinaria San Roque',
      fechaGasto: new Date(Date.now() - 2 * 86_400_000),
      capturadoEn: new Date(Date.now() - 2 * 86_400_000),
      estado: 'EN_ANALISIS',
      comprobante: {
        create: {
          tipo: 'BOLETA',
          rucEmisor: '20601030579',
          razonSocialEmisor: 'Clinica Veterinaria San Roque S.A.C.',
          serie: 'B001',
          numero: '004521',
          fechaEmision: new Date(Date.now() - 2 * 86_400_000),
          subtotal: 100,
          igv: 18,
          total: 118,
          archivoUrl: comprobanteObjeto,
          archivoMime: 'image/jpeg',
          archivoBytes: imagenComprobante.byteLength,
          hashSha256: (await import('node:crypto'))
            .createHash('sha256')
            .update(imagenComprobante)
            .digest('hex'),
        },
      },
      evidencias: {
        create: {
          tipo: 'FOTO',
          archivoUrl: evidenciaObjeto,
          archivoMime: 'image/jpeg',
          archivoBytes: imagenEvidencia.byteLength,
          ancho: 800,
          alto: 600,
          hashSha256: (await import('node:crypto'))
            .createHash('sha256')
            .update(imagenEvidencia)
            .digest('hex'),
          hashPerceptual: await calcularDHash(imagenEvidencia),
          nitidez: await calcularNitidez(imagenEvidencia),
          exifCapturadoEn: new Date(Date.now() - 2 * 86_400_000),
          // Sin personas: la evidencia nace publicable y la demo no se traba
          // en el paso de anonimizacion.
          contienePersonas: false,
          anonimizada: true,
        },
      },
    },
  });

  // Se encola para que el worker lo analice al arrancar la API. Asi la demo
  // muestra el motor funcionando de verdad, no un resultado precocinado.
  await prisma.trabajoVerificacion.create({ data: { gastoId: gasto.id } });

  console.info('  gasto: 1 en analisis, encolado para el motor de reglas');
  console.info('');
  console.info('Listo. Arranque la API y el worker resolvera el gasto en segundos.');
  console.info('Cuentas de demostracion: ver prisma/seed.ts (clave comun Demo.2026!tr).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
