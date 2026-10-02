/**
 * Intenta romper la plataforma, delante del público.
 *
 *   npm run demo:romper
 *
 * Demostrar que un sistema funciona convence a medias: el público ve el camino
 * que el expositor eligió recorrer. Demostrar que **se niega a ser roto** es
 * otra cosa, porque los intentos son los que cualquiera haría para estafar a
 * un donante: alterar el libro, presentar dos veces el mismo comprobante,
 * cobrar más de lo que entró, notificar una foto con la cara de un
 * beneficiario sin difuminar.
 *
 * Las nueve reglas de la sección 6.6 del Entregable 2 ya están probadas en
 * `src/comun/prisma/integridad.spec.ts`. Esto no las vuelve a probar: las
 * **muestra**, porque en una exposición nadie lee una suite de pruebas.
 *
 * Que la defensa viva en la base de datos y no en el backend es el punto
 * entero. Un error en el código de la aplicación no abre la puerta, porque la
 * aplicación no es la que la cierra: estos intentos hablan SQL directo, por
 * fuera de toda validación de NestJS y de Zod, y aun así fallan.
 *
 * Seguro de correr minutos antes de exponer: cada intento vive en su propia
 * transacción que **siempre** se deshace, incluso si la base lo permitiera. No
 * puede dejar basura en el escenario de la demostración ni descuadrar el
 * libro.
 */
import { Prisma, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const AMBAR = '\x1b[33m';
const GRIS = '\x1b[90m';
const FIN = '\x1b[0m';

type Tx = Prisma.TransactionClient;

/** Se lanza para abortar la transacción después de que el intento corrió. */
class Deshacer extends Error {}

/**
 * Lo que dijo Postgres, sin el envoltorio de Prisma.
 *
 * El mensaje de la base es el valor de esta demostración —está escrito en
 * español y orienta a quién lo lee hacia la salida correcta— y viene sepultado
 * bajo varias líneas de contexto del cliente.
 */
function mensajeDeLaBase(error: unknown): string {
  const texto = error instanceof Error ? error.message : String(error);

  // $executeRaw / $queryRaw: Prisma cita el mensaje de Postgres entre acentos.
  const crudo = /Message: `(?:ERROR:\s*)?([^`]+)`/.exec(texto);
  if (crudo) return crudo[1].trim();

  // Los metodos del cliente (create, update) lo entierran dentro de un
  // ConnectorError con la estructura de Rust volcada en texto. El mensaje de
  // los triggers --el que esta escrito en español y cita la regla-- es
  // justamente el que llega por aqui, asi que vale la pena sacarlo.
  const conector = /\bmessage: "([^"]+)"/.exec(texto);
  if (conector) return conector[1].trim();

  const lineas = texto
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const unica = lineas.find((l) => /Unique constraint failed/i.test(l));
  if (unica) return unica;

  return lineas[lineas.length - 1] ?? 'sin mensaje';
}

/**
 * Corre el intento y deshace lo que haya hecho.
 *
 * Devuelve si la base lo **permitió**, que en todos los casos de aquí es la
 * mala noticia. El `Deshacer` no cuenta como rechazo: es la marca de que el
 * intento llegó hasta el final sin que nada lo detuviera.
 */
async function sinDejarRastro(
  accion: (tx: Tx) => Promise<void>,
): Promise<{ permitido: boolean; mensaje?: string }> {
  try {
    await prisma.$transaction(async (tx) => {
      await accion(tx);
      throw new Deshacer();
    });
  } catch (error) {
    if (!(error instanceof Deshacer)) {
      return { permitido: false, mensaje: mensajeDeLaBase(error) };
    }
  }
  return { permitido: true };
}

let intentos = 0;
let rechazados = 0;

/** Un intento que la base DEBE rechazar. */
async function debeRechazar(
  titulo: string,
  regla: string,
  loQueSeIntenta: string,
  accion: (tx: Tx) => Promise<void>,
): Promise<void> {
  intentos += 1;
  console.log(`\n  ${String(intentos).padStart(2)}  ${titulo}`);
  console.log(`      ${GRIS}${regla}${FIN}`);
  console.log(`      ${GRIS}intento:${FIN}  ${loQueSeIntenta}`);

  const { permitido, mensaje } = await sinDejarRastro(accion);

  if (permitido) {
    console.log(`      ${GRIS}la base:${FIN}  ${ROJO}LO PERMITIO${FIN}`);
    console.log(`      ${ROJO}Esto es un agujero. Deshecho, pero la regla no esta puesta.${FIN}`);
    return;
  }

  rechazados += 1;
  console.log(`      ${GRIS}la base:${FIN}  ${VERDE}RECHAZADO${FIN}`);
  for (const linea of partir(mensaje ?? '', 66)) {
    console.log(`                ${GRIS}${linea}${FIN}`);
  }
}

function partir(texto: string, ancho: number): string[] {
  const palabras = texto.split(/\s+/);
  const lineas: string[] = [];
  let actual = '';
  for (const palabra of palabras) {
    if ((actual + ' ' + palabra).trim().length > ancho) {
      if (actual) lineas.push(actual);
      actual = palabra;
    } else {
      actual = (actual + ' ' + palabra).trim();
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

function titulo(texto: string): void {
  console.log(`\n${'='.repeat(74)}`);
  console.log(`  ${texto}`);
  console.log('='.repeat(74));
}

async function principal(): Promise<void> {
  titulo('Ayni · intentando romper la trazabilidad');
  console.log('  Todo lo que sigue habla SQL directo contra PostgreSQL, por fuera de');
  console.log('  la API, de los guards de NestJS y de la validacion de Zod.');
  console.log(`\n  ${GRIS}Cada intento corre en una transaccion que se deshace: nada de esto`);
  console.log(`  queda en la base, ni siquiera si la base lo permitiera.${FIN}`);

  // --- Los datos reales del escenario, para atacarlos de verdad -----------
  const movimiento = await prisma.movimientoContable.findFirst({
    orderBy: { creadoEn: 'desc' },
  });
  const comprobante = await prisma.comprobante.findFirst({
    include: { gasto: true },
  });
  const donacion = await prisma.donacion.findFirst({
    where: { estado: 'CONFIRMADA' },
  });

  if (!movimiento || !comprobante || !donacion) {
    console.log(`\n  ${AMBAR}Falta el escenario base. Corra primero:${FIN}`);
    console.log('    npx tsx prisma/seed-demo.ts');
    await prisma.$disconnect();
    process.exitCode = 1;
    return;
  }

  const gasto = comprobante.gasto;

  // --- 1 y 2: el libro no se toca ----------------------------------------
  await debeRechazar(
    'Alterar un monto del libro contable',
    'RN-03 · RNF-07 · trigger tg_movimientos_no_update',
    `UPDATE movimientos_contables SET monto = 999999 (hoy: S/ ${movimiento.monto.toString()})`,
    async (tx) => {
      await tx.$executeRaw`
        UPDATE movimientos_contables SET monto = 999999 WHERE id = ${movimiento.id}::uuid`;
    },
  );

  await debeRechazar(
    'Borrar un movimiento del libro contable',
    'RN-03 · RNF-07 · trigger tg_movimientos_no_delete',
    'DELETE FROM movimientos_contables',
    async (tx) => {
      await tx.$executeRaw`
        DELETE FROM movimientos_contables WHERE id = ${movimiento.id}::uuid`;
    },
  );

  // --- 3: el mismo comprobante, dos veces --------------------------------
  // Se crea un gasto nuevo dentro de la transaccion a proposito. Si se colgara
  // el comprobante duplicado del gasto que ya lo tiene, fallaria por la unicidad
  // de gasto_id --otra regla-- y la demostracion probaria lo que no quiere.
  await debeRechazar(
    'Presentar el mismo comprobante en otro gasto',
    'Seccion 6.6 · UNIQUE (ruc_emisor, tipo, serie, numero)',
    `${comprobante.serie}-${comprobante.numero} del RUC ${comprobante.rucEmisor}, en un gasto nuevo`,
    async (tx) => {
      const otro = await tx.gasto.create({
        data: {
          fondoId: gasto.fondoId,
          ongId: gasto.ongId,
          registradoPor: gasto.registradoPor,
          montoDeclarado: gasto.montoDeclarado,
          concepto: 'intento de duplicar un comprobante',
          proveedorNombre: gasto.proveedorNombre,
          fechaGasto: gasto.fechaGasto,
          estado: 'BORRADOR',
        },
      });

      await tx.comprobante.create({
        data: {
          gastoId: otro.id,
          tipo: comprobante.tipo,
          rucEmisor: comprobante.rucEmisor,
          razonSocialEmisor: comprobante.razonSocialEmisor,
          serie: comprobante.serie,
          numero: comprobante.numero,
          fechaEmision: comprobante.fechaEmision,
          subtotal: comprobante.subtotal,
          igv: comprobante.igv,
          total: comprobante.total,
          archivoUrl: 'comprobantes/intento.jpg',
          archivoMime: 'image/jpeg',
          archivoBytes: 1024,
          // Hash distinto a proposito: se quiere probar la unicidad del
          // DOCUMENTO, no la del archivo. Son dos reglas separadas y la
          // siguiente prueba la otra.
          hashSha256: 'f'.repeat(64),
        },
      });
    },
  );

  // --- 4: el mismo archivo, otra vez -------------------------------------
  await debeRechazar(
    'Volver a subir el mismo archivo de comprobante',
    'Seccion 6.6 · UNIQUE (hash_sha256)',
    `un comprobante con el SHA-256 de ${comprobante.serie}-${comprobante.numero}`,
    async (tx) => {
      const otro = await tx.gasto.create({
        data: {
          fondoId: gasto.fondoId,
          ongId: gasto.ongId,
          registradoPor: gasto.registradoPor,
          montoDeclarado: gasto.montoDeclarado,
          concepto: 'intento de reutilizar un archivo',
          proveedorNombre: gasto.proveedorNombre,
          fechaGasto: gasto.fechaGasto,
          estado: 'BORRADOR',
        },
      });

      await tx.comprobante.create({
        data: {
          gastoId: otro.id,
          tipo: comprobante.tipo,
          rucEmisor: '20100070970',
          razonSocialEmisor: 'Otro emisor',
          serie: 'B999',
          numero: '999999',
          fechaEmision: comprobante.fechaEmision,
          subtotal: comprobante.subtotal,
          igv: comprobante.igv,
          total: comprobante.total,
          archivoUrl: 'comprobantes/intento-2.jpg',
          archivoMime: 'image/jpeg',
          archivoBytes: 1024,
          hashSha256: comprobante.hashSha256,
        },
      });
    },
  );

  // --- 5: cobrar mas de lo que entro -------------------------------------
  const disponible = donacion.montoNeto.sub(donacion.montoAplicado);
  await debeRechazar(
    'Aplicar a una donacion mas de lo que tiene',
    'RN-04 · trigger tg_aplicacion_validar',
    `S/ ${disponible.add(1000).toString()} sobre una donacion con S/ ${disponible.toString()} disponibles`,
    async (tx) => {
      await tx.aplicacionDonacion.create({
        data: {
          gastoId: gasto.id,
          donacionId: donacion.id,
          monto: disponible.add(1000),
        },
      });
    },
  );

  // --- 6: notificar una foto sin difuminar -------------------------------
  await debeRechazar(
    'Notificar al donante una evidencia sin anonimizar',
    'RNF-06 · RF-DE-04 · trigger tg_notificacion_privacidad',
    'una notificacion que apunta a una evidencia con anonimizada = false',
    async (tx) => {
      const sinAnonimizar = await tx.evidencia.create({
        data: {
          gastoId: gasto.id,
          tipo: 'FOTO',
          archivoUrl: 'evidencias/intento.jpg',
          archivoMime: 'image/jpeg',
          archivoBytes: 2048,
          hashSha256: 'e'.repeat(64),
          contienePersonas: true,
          anonimizada: false,
        },
      });

      await tx.notificacion.create({
        data: {
          usuarioId: gasto.registradoPor,
          tipo: 'GASTO_EJECUTADO',
          canal: 'IN_APP',
          asunto: 'Tu donacion hizo esto posible',
          cuerpo: 'Con la foto de un beneficiario sin difuminar.',
          gastoId: gasto.id,
          evidenciaId: sinAnonimizar.id,
          transaccional: true,
        },
      });
    },
  );

  // --- 7: falsificar la cadena de hashes ---------------------------------
  // Este no se rechaza: se CORRIGE, y en silencio. El trigger sobrescribe la
  // secuencia y el hash que la aplicacion intenta imponer, asi que el codigo
  // de la aplicacion no puede mentirle al libro ni equivocandose ni a
  // proposito. Se trata aparte porque "permitido" aqui no es un agujero.
  intentos += 1;
  console.log(`\n  ${String(intentos).padStart(2)}  Falsificar la posicion y el hash de un movimiento`);
  console.log(`      ${GRIS}RNF-07 · trigger tg_movimiento_encadenar${FIN}`);
  console.log(`      ${GRIS}intento:${FIN}  INSERT con secuencia = 99 y hash_actual = 000...0`);

  let falsificado: { secuencia: bigint; hash: string } | null = null;
  await sinDejarRastro(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO movimientos_contables
        (id, fondo_id, tipo, cuenta_debe, cuenta_haber, monto, descripcion, secuencia, hash_actual)
      VALUES
        (gen_random_uuid(), ${movimiento.fondoId}::uuid, 'INGRESO', 'caja', 'donantes',
         1, 'intento de falsificacion', 99, repeat('0', 64))`;

    const [fila] = await tx.$queryRaw<{ secuencia: bigint; hash_actual: string }[]>`
      SELECT secuencia, hash_actual FROM movimientos_contables
       WHERE descripcion = 'intento de falsificacion'`;

    if (fila) falsificado = { secuencia: fila.secuencia, hash: fila.hash_actual };
  });

  const impuesto = falsificado as { secuencia: bigint; hash: string } | null;
  if (impuesto && (impuesto.secuencia !== 99n || !/^0{64}$/.test(impuesto.hash))) {
    rechazados += 1;
    console.log(`      ${GRIS}la base:${FIN}  ${VERDE}SOBRESCRITO${FIN}`);
    console.log(
      `                ${GRIS}La fila entro, pero con secuencia ${impuesto.secuencia} y el hash` +
        ` recalculado${FIN}`,
    );
    console.log(
      `                ${GRIS}(${impuesto.hash.slice(0, 24)}...). La aplicacion no puede` +
        ` imponer ninguno${FIN}`,
    );
    console.log(`                ${GRIS}de los dos, ni por error ni a proposito.${FIN}`);
  } else {
    console.log(`      ${GRIS}la base:${FIN}  ${ROJO}LA FALSIFICACION QUEDO${FIN}`);
  }

  // --- Y la cadena, intacta ----------------------------------------------
  titulo('La cadena de hashes, fondo por fondo');
  console.log(`  ${GRIS}Se recalcula cada SHA-256 desde el primer movimiento. Si un solo`);
  console.log(`  byte hubiera cambiado por fuera del trigger, se veria aqui.${FIN}\n`);

  const fondos = await prisma.fondo.findMany({ orderBy: { nombre: 'asc' } });
  let rotas = 0;

  for (const fondo of fondos) {
    const [r] = await prisma.$queryRaw<
      { movimientos: bigint; rota: boolean; secuencia_rota: bigint | null }[]
    >`SELECT movimientos, rota, secuencia_rota FROM fn_verificar_cadena(${fondo.id}::uuid)`;

    const total = Number(r?.movimientos ?? 0);
    if (total === 0) continue;

    if (r?.rota) {
      rotas += 1;
      console.log(
        `  ${ROJO}ROTA${FIN}     ${fondo.nombre.padEnd(34)} ${total} movimientos, ` +
          `falla en la secuencia ${r.secuencia_rota}`,
      );
    } else {
      console.log(
        `  ${VERDE}intacta${FIN}  ${fondo.nombre.padEnd(34)} ${String(total).padStart(3)} movimientos`,
      );
    }
  }

  // --- Veredicto ---------------------------------------------------------
  titulo('Resultado');
  const todoBien = rechazados === intentos && rotas === 0;
  const marca = todoBien ? VERDE : ROJO;
  console.log(`  ${marca}${rechazados} de ${intentos} intentos detenidos por la base de datos.${FIN}`);
  console.log(
    `  ${rotas === 0 ? VERDE : ROJO}${rotas === 0 ? 'Ninguna cadena de hashes alterada.' : `${rotas} cadena(s) rota(s).`}${FIN}`,
  );

  if (todoBien) {
    console.log(`\n  ${GRIS}Ninguna de estas defensas esta en el codigo de la aplicacion.`);
    console.log(`  Viven en la base, asi que un error en el backend --o alguien con`);
    console.log(`  acceso a la base y malas intenciones-- no las puede sortear.${FIN}`);
  } else {
    process.exitCode = 1;
  }

  console.log();
  await prisma.$disconnect();
}

void principal();
