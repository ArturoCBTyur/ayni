import sharp from 'sharp';

/**
 * Procesamiento de imagen sin inteligencia artificial.
 *
 * Todo lo que hay aqui es aritmetica determinista sobre pixeles: ni modelos,
 * ni entrenamiento, ni inferencia. Es lo que permite que RF-IA-05 (detectar
 * evidencias reutilizadas) quede implementado de verdad en esta version, en
 * lugar de diferido junto con el resto de AIni.
 */

/** Ancho del muestreo del dHash: 9 columnas dan 8 comparaciones por fila. */
const DHASH_ANCHO = 9;
const DHASH_ALTO = 8;

export interface MetadatosImagen {
  ancho: number | null;
  alto: number | null;
  /** Fecha de captura leida del EXIF, si el dispositivo la incluyo. */
  capturadaEn: Date | null;
}

/**
 * Hash perceptual por diferencias (dHash) de 64 bits.
 *
 * Reduce la imagen a 9x8 en escala de grises y compara cada pixel con su
 * vecino de la derecha: un bit por comparacion. El resultado describe la
 * estructura de luminancia, no los pixeles exactos, asi que sobrevive a
 * recortes leves, recompresion y cambios de tamaño.
 *
 * Es justamente lo que se necesita para detectar una foto reciclada entre
 * campañas: cambiarle el tamaño o volver a comprimirla altera el SHA-256
 * por completo, pero apenas mueve el dHash.
 */
export async function calcularDHash(imagen: Buffer): Promise<string> {
  const pixeles = await sharp(imagen)
    .greyscale()
    .resize(DHASH_ANCHO, DHASH_ALTO, { fit: 'fill' })
    .raw()
    .toBuffer();

  let bits = '';
  for (let fila = 0; fila < DHASH_ALTO; fila += 1) {
    for (let columna = 0; columna < DHASH_ANCHO - 1; columna += 1) {
      const actual = pixeles[fila * DHASH_ANCHO + columna];
      const siguiente = pixeles[fila * DHASH_ANCHO + columna + 1];
      bits += actual > siguiente ? '1' : '0';
    }
  }

  // 64 bits en 16 caracteres hexadecimales.
  return BigInt(`0b${bits}`).toString(16).padStart(16, '0');
}

/**
 * Distancia de Hamming entre dos dHash: cuantos bits difieren.
 *
 * Referencia practica sobre 64 bits: 0 es la misma imagen, menos de 5 indica
 * casi con seguridad la misma escena reencuadrada o recomprimida, y por
 * encima de 10 se trata de imagenes distintas.
 */
export function distanciaHamming(a: string, b: string): number {
  if (a.length !== b.length) return Number.MAX_SAFE_INTEGER;

  let distancia = 0;
  let diferencia = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);

  while (diferencia > 0n) {
    distancia += Number(diferencia & 1n);
    diferencia >>= 1n;
  }
  return distancia;
}

/** Umbral por debajo del cual dos evidencias se consideran la misma. */
export const UMBRAL_DUPLICADO_PERCEPTUAL = 5;

/**
 * Nitidez por varianza del laplaciano.
 *
 * Convoluciona la imagen con el operador laplaciano, que responde a los
 * bordes, y mide la varianza del resultado. Una foto enfocada tiene bordes
 * marcados y varianza alta; una movida o desenfocada los tiene difusos y la
 * varianza cae.
 *
 * Es vision por computador clasica, de los años sesenta, no aprendizaje
 * automatico: una convolucion 3x3 y una varianza.
 */
export async function calcularNitidez(imagen: Buffer): Promise<number> {
  const { data, info } = await sharp(imagen)
    .greyscale()
    // Se normaliza el tamaño para que la nitidez sea comparable entre fotos
    // tomadas con camaras de distinta resolucion.
    .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const total = info.width * info.height;
  let suma = 0;
  for (let i = 0; i < total; i += 1) suma += data[i];
  const media = suma / total;

  let varianza = 0;
  for (let i = 0; i < total; i += 1) varianza += (data[i] - media) ** 2;

  return Math.round((varianza / total) * 100) / 100;
}

/** Por debajo de esto la foto se considera demasiado borrosa para servir. */
export const NITIDEZ_MINIMA = 40;

export async function leerMetadatos(imagen: Buffer): Promise<MetadatosImagen> {
  const meta = await sharp(imagen).metadata();

  return {
    ancho: meta.width ?? null,
    alto: meta.height ?? null,
    capturadaEn: extraerFechaExif(meta.exif),
  };
}

/** Region rectangular a difuminar, en pixeles de la imagen original. */
export interface RegionDifuminada {
  x: number;
  y: number;
  ancho: number;
  alto: number;
}

/**
 * Difumina regiones marcadas a mano sobre la imagen (RF-DE-04, RNF-06).
 *
 * Sustituye a la deteccion automatica de rostros de AIni, que es lo unico
 * que aqui requeriria un modelo. El operador marca donde aparecen personas y
 * el servidor aplica el difuminado; la restriccion de la base de datos que
 * impide notificar una evidencia sin anonimizar sigue siendo igual de
 * estricta, asi que la proteccion del beneficiario no depende de que la
 * deteccion sea automatica.
 *
 * El difuminado se aplica en el servidor y no en el cliente a proposito: una
 * version difuminada en el navegador podria omitirse manipulando la peticion,
 * y entonces la imagen original llegaria a los donantes.
 */
export async function difuminarRegiones(
  imagen: Buffer,
  regiones: RegionDifuminada[],
): Promise<Buffer> {
  if (regiones.length === 0) return imagen;

  const base = sharp(imagen);
  const meta = await base.metadata();
  const ancho = meta.width ?? 0;
  const alto = meta.height ?? 0;

  const parches = await Promise.all(
    regiones.map(async (region) => {
      // Se recorta a los limites de la imagen: una region fuera de rango
      // haria fallar la extraccion y dejaria la evidencia sin anonimizar.
      const left = Math.max(0, Math.min(Math.round(region.x), ancho - 1));
      const top = Math.max(0, Math.min(Math.round(region.y), alto - 1));
      const width = Math.max(1, Math.min(Math.round(region.ancho), ancho - left));
      const height = Math.max(1, Math.min(Math.round(region.alto), alto - top));

      const recorte = await sharp(imagen)
        .extract({ left, top, width, height })
        // Un sigma proporcional al tamaño de la region asegura que el rostro
        // quede irreconocible tambien en fotos de alta resolucion.
        .blur(Math.max(8, Math.round(Math.min(width, height) / 4)))
        .toBuffer();

      return { input: recorte, left, top };
    }),
  );

  return sharp(imagen).composite(parches).toBuffer();
}

/**
 * Comprime la evidencia antes de almacenarla (RNF-16).
 *
 * Las ONG del piloto suben desde el celular, a veces con conectividad
 * limitada. Guardar una foto de 12 megapixeles no aporta nada a la
 * verificacion y encarece el almacenamiento y cada descarga posterior.
 */
export async function comprimirEvidencia(imagen: Buffer): Promise<Buffer> {
  return (
    sharp(imagen)
      // Endereza segun la orientacion EXIF antes de descartarla. El JPEG de
      // salida no conserva metadatos, asi que sin esto la foto vertical de un
      // celular quedaba guardada acostada, y asi la veian el auditor y el
      // donante.
      .rotate()
      .resize(1920, 1920, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer()
  );
}

/**
 * Lee DateTimeOriginal del bloque EXIF.
 *
 * Se hace con una busqueda de texto sobre el binario en lugar de con un
 * analizador EXIF completo: es el unico campo que el motor de verificacion
 * necesita, y agregar una dependencia mas para leerlo no se justifica. Si no
 * aparece, se devuelve null y la señal simplemente no se usa.
 */
function extraerFechaExif(exif: Buffer | undefined): Date | null {
  if (!exif) return null;

  // Formato EXIF: "2026:09:15 14:32:07"
  const coincidencia = /(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/.exec(
    exif.toString('latin1'),
  );
  if (!coincidencia) return null;

  const [, anio, mes, dia, hora, minuto, segundo] = coincidencia;
  const fecha = new Date(`${anio}-${mes}-${dia}T${hora}:${minuto}:${segundo}`);

  return Number.isNaN(fecha.getTime()) ? null : fecha;
}
