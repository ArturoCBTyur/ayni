import type { AlmacenamientoArchivos } from './puertos/almacenamiento.port';

/** Lo que hace falta de una evidencia para decidir que archivo se publica. */
export interface EvidenciaPublicable {
  archivoUrl: string;
  archivoAnonimizadoUrl: string | null;
  anonimizada: boolean;
}

/**
 * URL firmada de la version publicable de una evidencia, o null si no la hay.
 *
 * Es la unica regla para todo lo que ve alguien que no es auditor: la ficha
 * publica de una causa, la notificacion de impacto del donante y el detalle
 * que consulta la ONG. Con personas, solo la version difuminada; sin
 * personas, el original ya es publicable (la evidencia nace `anonimizada`).
 * Mientras una foto con personas no se difumine, no hay URL que entregar.
 */
export function urlPublicable(
  almacen: AlmacenamientoArchivos,
  evidencia: EvidenciaPublicable,
): string | null {
  if (evidencia.archivoAnonimizadoUrl) {
    return almacen.emitirUrlDescarga(evidencia.archivoAnonimizadoUrl).url;
  }
  return evidencia.anonimizada ? almacen.emitirUrlDescarga(evidencia.archivoUrl).url : null;
}
