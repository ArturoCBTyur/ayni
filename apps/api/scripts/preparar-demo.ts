/**
 * Deja el entorno local listo para una exposición en vivo.
 *
 *   npm run demo:preparar     enrola el segundo factor y siembra los casos
 *   npm run demo:codigos      imprime los códigos TOTP del momento
 *
 * Resuelve las dos cosas que atascan una demostración:
 *
 * 1. Cuatro de las cinco cuentas exigen segundo factor y ninguna lo tiene
 *    configurado. Enrolarlas en vivo son dos minutos delante del público.
 * 2. Tras el recorrido del seed, el gasto queda aprobado y la bandeja del
 *    auditor queda vacía: el momento en que una persona decide, que es el
 *    corazón del proyecto, no tendría nada que mostrar.
 *
 * Es idempotente: se puede correr las veces que haga falta.
 *
 * Solo para el entorno local. Los secretos TOTP quedan guardados en claro en
 * esta máquina para poder imprimir los códigos, cosa que en un despliegue real
 * no debe ocurrir nunca.
 */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';
import sharp from 'sharp';

import { calcularDHash, calcularNitidez } from '../src/modules/gastos/imagen';

const prisma = new PrismaClient();
const RAIZ_ARCHIVOS = join(process.cwd(), '..', '..', 'storage');

/** La semilla con la que seed-demo genera la evidencia del primer gasto. */
const SEMILLA_EVIDENCIA_BASE = 97;

const CUENTAS = [
  { correo: 'donante@demo.pe', rol: 'Donante', mfa: false },
  { correo: 'ong.admin@demo.pe', rol: 'Administradora de ONG', mfa: true },
  { correo: 'ong.operador@demo.pe', rol: 'Operador de campo', mfa: true },
  { correo: 'auditor@demo.pe', rol: 'Auditor', mfa: true },
  { correo: 'admin@demo.pe', rol: 'Administrador de plataforma', mfa: true },
];

/**
 * Imagen con estructura de gran escala.
 *
 * `variacion` altera los tonos sin cambiar la composición: produce un archivo
 * distinto (otro SHA-256) con una huella perceptual parecida, que es
 * exactamente el caso de la foto reciclada, recortada y recomprimida.
 */
async function imagen(semilla: number, variacion = 0, calidad = 85): Promise<Buffer> {
  const ancho = 800;
  const alto = 600;
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
      const tono = Math.floor(siguiente() * 200) + 30 + variacion;
      for (let y = by * bloque; y < Math.min((by + 1) * bloque, alto); y += 1) {
        for (let x = bx * bloque; x < Math.min((bx + 1) * bloque, ancho); x += 1) {
          const i = (y * ancho + x) * canales;
          datos[i] = tono % 256;
          datos[i + 1] = (tono + 30) % 256;
          datos[i + 2] = (tono + 70) % 256;
        }
      }
    }
  }

  return sharp(datos, { raw: { width: ancho, height: alto, channels: canales } })
    .jpeg({ quality: calidad })
    .toBuffer();
}

async function guardar(objeto: string, contenido: Buffer): Promise<void> {
  const ruta = join(RAIZ_ARCHIVOS, objeto);
  await mkdir(dirname(ruta), { recursive: true });
  await writeFile(ruta, contenido);
}

const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// --------------------------------------------------------------------------
// 1. Segundo factor
// --------------------------------------------------------------------------

async function enrolarSegundoFactor(): Promise<void> {
  console.log('Segundo factor');

  for (const cuenta of CUENTAS.filter((c) => c.mfa)) {
    const usuario = await prisma.usuario.findUnique({ where: { correo: cuenta.correo } });
    if (!usuario) {
      console.log(`  ${cuenta.correo}: no existe. Corra primero el seed.`);
      continue;
    }

    if (usuario.totpHabilitado && usuario.totpSecreto) {
      console.log(`  ${cuenta.correo}: ya enrolado`);
      continue;
    }

    await prisma.usuario.update({
      where: { id: usuario.id },
      data: { totpSecreto: authenticator.generateSecret(), totpHabilitado: true },
    });
    console.log(`  ${cuenta.correo}: enrolado`);
  }
}

// --------------------------------------------------------------------------
// 2. Casos para que el guion tenga qué mostrar
// --------------------------------------------------------------------------

async function sembrarCasos(): Promise<void> {
  console.log('\nCasos de demostración');

  const fondo = await prisma.fondo.findFirst({
    where: { nombre: 'Atencion veterinaria' },
    include: { campana: true },
  });
  const operador = await prisma.usuario.findUnique({
    where: { correo: 'ong.operador@demo.pe' },
  });

  if (!fondo || !operador) {
    console.log('  Falta el escenario base. Corra `npx tsx prisma/seed-demo.ts` primero.');
    return;
  }

  // Cada caso se comprueba por separado: sembrar los dos o ninguno haría que
  // una corrida a medias dejara el escenario incompleto.
  const enRevision = await prisma.gasto.count({
    where: { ongId: fondo.campana.ongId, estado: 'EN_REVISION' },
  });
  const observados = await prisma.gasto.count({
    where: { ongId: fondo.campana.ongId, estado: 'OBSERVADO' },
  });

  // Caso para el auditor: proveedor nunca visto y monto muy por encima de lo
  // habitual en la categoría. Son señales de anomalía, no bloqueos: el motor
  // debería dejarlo en confianza media y derivarlo a una persona.
  if (enRevision > 0) {
    console.log(`  Ya hay ${enRevision} caso esperando al auditor.`);
  } else {
    await crearGasto({
      fondoId: fondo.id,
      ongId: fondo.campana.ongId,
      operadorId: operador.id,
      monto: 189,
      concepto: 'traslado de emergencia y hospitalizacion de un perro atropellado',
      proveedor: 'Transporte Veterinario El Rapido',
      // RUC con el digito verificador equivocado, a proposito: es el error mas
      // comun al copiar un RUC a mano de un comprobante, y hace que el motor
      // baje la confianza documental y derive el caso a una persona.
      ruc: '20553456575',
      serie: 'F002',
      numero: '000087',
      semilla: 77,
      variacion: 0,
    });
  }

  // Caso de evidencia reciclada: la MISMA escena que otro gasto, recomprimida.
  // Cambia el archivo (otro SHA-256) pero no la composición, así que la huella
  // perceptual se parece. Es lo que hace alguien que presenta dos veces la
  // misma foto, y el motor debe detectarlo aunque los bytes no coincidan.
  //
  // La variación de tono NO sirve para esto: mueve la huella lo suficiente
  // como para que el motor la dé por nueva. Comprobado.
  if (observados > 0) {
    console.log(`  Ya hay ${observados} caso observado por evidencia reciclada.`);
    return;
  }

  const reciclada = await prisma.evidencia.findFirst({
    where: { gasto: { ongId: fondo.campana.ongId } },
    orderBy: { creadoEn: 'asc' },
    include: { gasto: true },
  });

  await crearGasto({
    fondoId: fondo.id,
    ongId: fondo.campana.ongId,
    operadorId: operador.id,
    monto: 72,
    concepto: 'control post operatorio de los perros rescatados',
    proveedor: 'Clinica Veterinaria San Roque',
    ruc: '20601030579',
    serie: 'B001',
    numero: '005013',
    semilla: reciclada ? SEMILLA_EVIDENCIA_BASE : 4242,
    variacion: 0,
    calidad: 60,
  });

  console.log('  Encolados. El worker los analiza en unos segundos.');
}

async function crearGasto(datos: {
  fondoId: string;
  ongId: string;
  operadorId: string;
  monto: number;
  concepto: string;
  proveedor: string;
  ruc: string;
  serie: string;
  numero: string;
  semilla: number;
  variacion: number;
  /** Calidad JPEG. Bajarla cambia el archivo sin cambiar la escena. */
  calidad?: number;
}): Promise<void> {
  const comprobante = await imagen(datos.semilla + 1);
  const evidencia = await imagen(datos.semilla, datos.variacion, datos.calidad ?? 85);

  const objetoComprobante = `comprobantes/demo-${randomUUID()}.jpg`;
  const objetoEvidencia = `evidencias/demo-${randomUUID()}.jpg`;
  await guardar(objetoComprobante, comprobante);
  await guardar(objetoEvidencia, evidencia);

  const subtotal = Number((datos.monto / 1.18).toFixed(2));
  const igv = Number((datos.monto - subtotal).toFixed(2));
  const hace = (dias: number) => new Date(Date.now() - dias * 86_400_000);

  const gasto = await prisma.gasto.create({
    data: {
      fondoId: datos.fondoId,
      ongId: datos.ongId,
      registradoPor: datos.operadorId,
      montoDeclarado: datos.monto,
      concepto: datos.concepto,
      proveedorNombre: datos.proveedor,
      fechaGasto: hace(1),
      capturadoEn: hace(1),
      estado: 'EN_ANALISIS',
      comprobante: {
        create: {
          tipo: datos.serie.startsWith('F') ? 'FACTURA' : 'BOLETA',
          rucEmisor: datos.ruc,
          razonSocialEmisor: datos.proveedor,
          serie: datos.serie,
          numero: datos.numero,
          fechaEmision: hace(1),
          subtotal,
          igv,
          total: datos.monto,
          archivoUrl: objetoComprobante,
          archivoMime: 'image/jpeg',
          archivoBytes: comprobante.byteLength,
          hashSha256: sha(comprobante),
        },
      },
      evidencias: {
        create: {
          tipo: 'FOTO',
          archivoUrl: objetoEvidencia,
          archivoMime: 'image/jpeg',
          archivoBytes: evidencia.byteLength,
          ancho: 800,
          alto: 600,
          hashSha256: sha(evidencia),
          hashPerceptual: await calcularDHash(evidencia),
          nitidez: await calcularNitidez(evidencia),
          exifCapturadoEn: hace(1),
          contienePersonas: false,
          anonimizada: true,
        },
      },
    },
  });

  await prisma.trabajoVerificacion.create({ data: { gastoId: gasto.id } });
  console.log(`  + S/ ${datos.monto} · ${datos.concepto.slice(0, 44)}`);
}

// --------------------------------------------------------------------------
// 3. Chuleta
// --------------------------------------------------------------------------

export async function imprimirCuentas(): Promise<void> {
  console.log('\nCuentas · clave común: Demo.2026!tr');
  console.log('-'.repeat(74));

  for (const cuenta of CUENTAS) {
    const usuario = await prisma.usuario.findUnique({ where: { correo: cuenta.correo } });
    if (!usuario) continue;

    const codigo =
      usuario.totpHabilitado && usuario.totpSecreto
        ? authenticator.generate(usuario.totpSecreto)
        : '—';

    console.log(`${cuenta.correo.padEnd(24)} ${cuenta.rol.padEnd(30)} ${codigo}`);
  }

  // El código cambia cada 30 segundos: decir cuánto queda evita teclear uno
  // que caduca a mitad de camino.
  const restante = 30 - Math.floor((Date.now() / 1000) % 30);
  console.log('-'.repeat(74));
  console.log(`Los códigos cambian en ${restante} s. Vuelva a correr el comando si caducan.`);
}

async function principal(): Promise<void> {
  const soloCodigos = process.argv.includes('--codigos');

  if (!soloCodigos) {
    await enrolarSegundoFactor();
    await sembrarCasos();
  }

  await imprimirCuentas();
  await prisma.$disconnect();
}

void principal();
