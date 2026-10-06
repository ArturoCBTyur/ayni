import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Sobre de cifrado autenticado para datos en reposo (RNF-01).
 *
 * AES-256-GCM: cifra y además autentica. Un archivo alterado en disco no se
 * descifra a basura, falla. Para una evidencia que respalda un gasto eso es
 * lo que importa: lo peor no es que alguien lea el comprobante, es que lo
 * cambie sin que nadie lo note.
 *
 * Cada sobre lleva un **contexto** como dato autenticado (AAD) que no viaja
 * en el sobre: la clave del objeto para un archivo, el usuario para un
 * secreto TOTP. Copiar el sobre de una fila a otra, o la evidencia de un
 * gasto sobre la de otro, produce un sobre que no abre. Con acceso de
 * escritura a la base, sin esto bastaria copiar el secreto TOTP propio sobre
 * la cuenta de un administrador.
 *
 * Funciones puras y sin NestJS a proposito: los scripts de semilla, de
 * demostracion y de migracion necesitan abrir y cerrar sobres sin levantar la
 * aplicacion.
 */

/** "AYNI" + version. Ningun formato de imagen o PDF empieza asi. */
const MAGIA = Buffer.from('AYNI', 'ascii');
const VERSION = 1;
const LARGO_ID = 4;
const LARGO_IV = 12;
const LARGO_TAG = 16;
const LARGO_CABECERA = MAGIA.length + 1 + LARGO_ID + LARGO_IV + LARGO_TAG;

/** Prefijo de los sobres de texto. Un secreto TOTP en base32 nunca empieza asi. */
const PREFIJO_TEXTO = 'ayni:v1:';

export interface Clave {
  /** Primeros 4 bytes del SHA-256 de la clave, en hex. No revela la clave. */
  id: string;
  bytes: Buffer;
}

export interface Llavero {
  /** Con la que se cifra. Null si el cifrado no esta configurado. */
  actual: Clave | null;
  /** Todas con las que se puede descifrar, por id: la actual y las retiradas. */
  todas: Map<string, Clave>;
}

export type MotivoError = 'clave-desconocida' | 'alterado' | 'sin-clave';

export class ErrorCifrado extends Error {
  constructor(
    readonly motivo: MotivoError,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorCifrado';
  }
}

/**
 * Decodifica una clave en base64 y exige que tenga 32 bytes.
 *
 * Se rechaza cualquier otro largo en vez de derivar una clave de un texto:
 * una frase como clave da la falsa impresion de un cifrado de 256 bits con la
 * entropia de una contrasena.
 */
export function leerClave(base64: string): Clave {
  const bytes = Buffer.from(base64.trim(), 'base64');
  if (bytes.length !== 32) {
    throw new Error(
      `La clave de cifrado debe tener 32 bytes en base64 y tiene ${bytes.length}. ` +
        'Generela con: openssl rand -base64 32',
    );
  }
  return {
    id: createHash('sha256')
      .update(bytes)
      .digest('hex')
      .slice(0, LARGO_ID * 2),
    bytes,
  };
}

/**
 * Arma el llavero a partir de la clave actual y, opcionalmente, de las
 * retiradas separadas por coma.
 *
 * Las retiradas solo descifran. Es lo que permite rotar la clave sin dejar
 * ilegible lo que se cifro antes: se agrega la nueva, se pasa la vieja a
 * retiradas y `npm run cifrado:migrar` vuelve a sellar todo con la nueva.
 */
export function crearLlavero(actual?: string | null, retiradas?: string | null): Llavero {
  const todas = new Map<string, Clave>();
  const claveActual = actual?.trim() ? leerClave(actual) : null;
  if (claveActual) todas.set(claveActual.id, claveActual);

  for (const texto of (retiradas ?? '').split(',')) {
    if (!texto.trim()) continue;
    const clave = leerClave(texto);
    if (!todas.has(clave.id)) todas.set(clave.id, clave);
  }

  return { actual: claveActual, todas };
}

/** Indica si un contenido ya es un sobre, y con que clave se cerro. */
export function idDeSobre(datos: Buffer): string | null {
  if (datos.length < LARGO_CABECERA) return null;
  if (!datos.subarray(0, MAGIA.length).equals(MAGIA)) return null;
  if (datos[MAGIA.length] !== VERSION) return null;
  return datos.subarray(MAGIA.length + 1, MAGIA.length + 1 + LARGO_ID).toString('hex');
}

export function sellar(llavero: Llavero, contenido: Buffer, contexto: string): Buffer {
  const clave = llavero.actual;
  if (!clave) {
    throw new ErrorCifrado('sin-clave', 'No hay clave de cifrado configurada (CIFRADO_CLAVE).');
  }

  // IV aleatorio de 96 bits por sobre. Con GCM, repetir un IV con la misma
  // clave rompe la confidencialidad y la autenticacion a la vez.
  const iv = randomBytes(LARGO_IV);
  const cifrador = createCipheriv('aes-256-gcm', clave.bytes, iv);
  cifrador.setAAD(Buffer.from(contexto, 'utf8'));
  const cifrado = Buffer.concat([cifrador.update(contenido), cifrador.final()]);

  return Buffer.concat([
    MAGIA,
    Buffer.from([VERSION]),
    Buffer.from(clave.id, 'hex'),
    iv,
    cifrador.getAuthTag(),
    cifrado,
  ]);
}

/**
 * Abre un sobre. Lo que no es un sobre se devuelve tal cual.
 *
 * Esa tolerancia es deliberada y acotada: es lo que deja leer los archivos y
 * secretos guardados antes de activar el cifrado, mientras la migracion los
 * vuelve a sellar. Lo que si es un sobre y no abre nunca se devuelve: falla.
 */
export function abrir(llavero: Llavero, datos: Buffer, contexto: string): Buffer {
  const id = idDeSobre(datos);
  if (id === null) return datos;

  const clave = llavero.todas.get(id);
  if (!clave) {
    throw new ErrorCifrado(
      'clave-desconocida',
      `El contenido se cifro con la clave ${id}, que no esta en el llavero. ` +
        'Si se roto la clave, agregue la anterior a CIFRADO_CLAVES_ANTERIORES.',
    );
  }

  let pos = MAGIA.length + 1 + LARGO_ID;
  const iv = datos.subarray(pos, (pos += LARGO_IV));
  const tag = datos.subarray(pos, (pos += LARGO_TAG));
  const cifrado = datos.subarray(pos);

  try {
    const descifrador = createDecipheriv('aes-256-gcm', clave.bytes, iv);
    descifrador.setAAD(Buffer.from(contexto, 'utf8'));
    descifrador.setAuthTag(tag);
    return Buffer.concat([descifrador.update(cifrado), descifrador.final()]);
  } catch {
    throw new ErrorCifrado(
      'alterado',
      'El contenido cifrado no supera la verificacion de integridad: fue alterado ' +
        'o no corresponde a este registro.',
    );
  }
}

export function esTextoSellado(valor: string): boolean {
  return valor.startsWith(PREFIJO_TEXTO);
}

/** Id de la clave con que se sello un texto, o null si esta en claro. */
export function idDeTexto(valor: string): string | null {
  if (!esTextoSellado(valor)) return null;
  return idDeSobre(Buffer.from(valor.slice(PREFIJO_TEXTO.length), 'base64url'));
}

export function sellarTexto(llavero: Llavero, texto: string, contexto: string): string {
  const sobre = sellar(llavero, Buffer.from(texto, 'utf8'), contexto);
  return PREFIJO_TEXTO + sobre.toString('base64url');
}

/** Igual que `abrir`: un texto sin prefijo se considera guardado en claro. */
export function abrirTexto(llavero: Llavero, valor: string, contexto: string): string {
  if (!esTextoSellado(valor)) return valor;
  const sobre = Buffer.from(valor.slice(PREFIJO_TEXTO.length), 'base64url');
  if (idDeSobre(sobre) === null) {
    throw new ErrorCifrado('alterado', 'El texto cifrado esta truncado o dañado.');
  }
  return abrir(llavero, sobre, contexto).toString('utf8');
}

/** Contexto del secreto TOTP: lo ata a la cuenta a la que pertenece. */
export const contextoTotp = (usuarioId: string) => `usuarios.totp_secreto:${usuarioId}`;

/** Contexto de un archivo: lo ata a su clave de objeto. */
export const contextoArchivo = (objeto: string) => `almacenamiento:${objeto}`;
