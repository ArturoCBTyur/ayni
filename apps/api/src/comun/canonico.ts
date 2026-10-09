import { createHash } from 'node:crypto';

/**
 * JSON canonico: las claves de cada objeto en orden, sin espacios.
 *
 * Dos objetos con los mismos datos tienen que dar exactamente el mismo texto,
 * o su hash no prueba nada: `{a, b}` y `{b, a}` son el mismo estado y con
 * JSON.stringify darian dos hashes. Con el texto canonico, cualquiera puede
 * recalcular el hash de un cierre con una sola linea en su lenguaje.
 *
 * Los Date y los Decimal de Prisma pasan por su toJSON, igual que en
 * JSON.stringify. Las claves con undefined se omiten, tambien igual.
 */
export function jsonCanonico(valor: unknown): string {
  return JSON.stringify(ordenar(valor));
}

function ordenar(valor: unknown): unknown {
  if (valor !== null && typeof valor === 'object') {
    const conToJson = valor as { toJSON?: () => unknown };
    if (typeof conToJson.toJSON === 'function') return ordenar(conToJson.toJSON());

    if (Array.isArray(valor)) return valor.map(ordenar);

    const objeto = valor as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(objeto)
        .sort()
        .filter((k) => objeto[k] !== undefined)
        .map((k) => [k, ordenar(objeto[k])]),
    );
  }
  return valor;
}

/** SHA-256 en hexadecimal del texto en UTF-8, igual que digest() de pgcrypto. */
export function sha256(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}
