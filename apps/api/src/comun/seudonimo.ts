import { createHmac } from 'node:crypto';

/**
 * Clave de desarrollo: solo cuando ENCUESTAS_CLAVE falta, que en produccion
 * no puede pasar (la configuracion no deja arrancar). Es publica a proposito,
 * y por eso no sirve para nada que importe.
 */
const CLAVE_DE_DESARROLLO = 'solo-desarrollo-seudonimo-de-encuestas';

/**
 * Seudonimo de una persona en las encuestas (D6, ADR-0007).
 *
 * HMAC y no un hash simple: con SHA-256 del id, cualquiera con la lista de
 * usuarios podria recalcularlo y saber quien respondio. Con la clave, solo el
 * servidor puede, y solo para emparejar las dos respuestas de la misma
 * persona.
 */
export function seudonimoDe(usuarioId: string, clave: string | undefined): string {
  return createHmac('sha256', clave || CLAVE_DE_DESARROLLO).update(usuarioId).digest('hex');
}
