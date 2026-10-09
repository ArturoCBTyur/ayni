/**
 * Instrumentos de SOC-1 y PSI-1, y como se puntuan. RF-SO-05, RF-SO-06, RF-PS-06.
 *
 * ESTAS SON LAS PROPUESTAS DE D3 Y D6 (ADR-0007), TODAVIA SIN FIRMA DE
 * SOCIOLOGIA, PSICOLOGIA NI DERECHO. Viven aqui, y solo aqui, para que lo que
 * se firme cambie este archivo y no los servicios:
 *
 * - la escala de confianza es una adaptacion propia, no una escala validada:
 *   Sociologia tiene que reemplazarla por la que elija y validarla en español;
 * - el SUS es el estandar de Brooke, en una traduccion de uso comun que
 *   Psicologia tiene que confirmar o cambiar por una validada;
 * - el plazo del seguimiento y el umbral de publicacion son los propuestos.
 *
 * Un instrumento publicado no cambia (la base lo impide): corregir un item es
 * publicar una version nueva, y las respuestas de la anterior no se mezclan.
 */

export type Calculo = 'INDICE_0_100' | 'SUS';

export interface Instrumento {
  codigo: string;
  version: number;
  indicador: 'SOC-1' | 'PSI-1';
  nombre: string;
  instrucciones: string;
  escala: { minimo: number; maximo: number; etiquetaMinimo: string; etiquetaMaximo: string };
  items: Array<{ numero: number; texto: string }>;
  calculo: Calculo;
  /** De donde sale y quien tiene que firmarlo. */
  origen: string;
}

/** D3 · Dias entre la primera notificacion de impacto y el seguimiento de SOC-1. */
export const DIAS_SEGUIMIENTO = 30;

/**
 * D6 · Respuestas minimas para publicar un agregado. Por debajo, un promedio
 * de tres personas casi dice lo que respondio cada una.
 */
export const UMBRAL_PUBLICACION = 5;

export const CONFIANZA_DONANTE: Instrumento = {
  codigo: 'CONFIANZA_DONANTE',
  version: 1,
  indicador: 'SOC-1',
  nombre: 'Confianza en el destino de las donaciones',
  instrucciones:
    'Indique cuánto está de acuerdo con cada frase. No hay respuestas correctas: nos ' +
    'interesa lo que usted piensa hoy.',
  escala: {
    minimo: 1,
    maximo: 7,
    etiquetaMinimo: 'Totalmente en desacuerdo',
    etiquetaMaximo: 'Totalmente de acuerdo',
  },
  items: [
    'Confío en que las organizaciones de esta plataforma usan las donaciones para lo que dicen.',
    'Confío en que mi donación llega a la causa que elegí.',
    'Podría saber en qué se gastó cada sol que doné.',
    'Si hubiera un mal uso de mi donación, me enteraría.',
    'Las organizaciones que apoyo actúan con honestidad.',
    'La información que recibo sobre el uso de mi dinero es verdadera.',
  ].map((texto, i) => ({ numero: i + 1, texto })),
  calculo: 'INDICE_0_100',
  origen:
    'Propuesta D3 del ADR-0007: adaptación propia, pendiente de que Sociología la reemplace ' +
    'por una escala validada en español.',
};

export const SUS: Instrumento = {
  codigo: 'SUS',
  version: 1,
  indicador: 'PSI-1',
  nombre: 'Facilidad de uso (System Usability Scale)',
  instrucciones:
    'Piense en lo que acaba de hacer en la aplicación e indique cuánto está de acuerdo con ' +
    'cada frase.',
  escala: {
    minimo: 1,
    maximo: 5,
    etiquetaMinimo: 'Totalmente en desacuerdo',
    etiquetaMaximo: 'Totalmente de acuerdo',
  },
  items: [
    'Creo que me gustaría usar esta aplicación con frecuencia.',
    'Encontré la aplicación innecesariamente compleja.',
    'Pensé que la aplicación era fácil de usar.',
    'Creo que necesitaría ayuda de una persona con conocimientos técnicos para usarla.',
    'Encontré que las funciones de la aplicación estaban bien integradas.',
    'Pensé que había demasiadas inconsistencias en la aplicación.',
    'Imagino que la mayoría de las personas aprendería a usarla muy rápido.',
    'Encontré la aplicación muy difícil de usar.',
    'Me sentí muy seguro usando la aplicación.',
    'Necesité aprender muchas cosas antes de poder usarla.',
  ].map((texto, i) => ({ numero: i + 1, texto })),
  calculo: 'SUS',
  origen:
    'SUS de Brooke (1996), diez ítems y cinco puntos, sin adaptar. Traducción de uso ' +
    'común, pendiente de que Psicología confirme una versión validada (D3).',
};

export const INSTRUMENTOS = [CONFIANZA_DONANTE, SUS];

/**
 * Puntaje de una respuesta, de 0 a 100.
 *
 * SUS: 2.5 × (Σ(impares − 1) + Σ(5 − pares)), la formula estandar. Los items
 * pares estan redactados en negativo; sumarlos sin invertir mediria lo
 * contrario.
 *
 * Indice de confianza: la media de los items llevada a 0-100, para que la
 * variacion de SOC-1 se lea igual con cualquier escala que firme Sociologia.
 */
export function puntaje(instrumento: Instrumento, valores: number[]): number {
  validarValores(instrumento, valores);

  if (instrumento.calculo === 'SUS') {
    const suma = valores.reduce((t, v, i) => t + (i % 2 === 0 ? v - 1 : 5 - v), 0);
    return suma * 2.5;
  }

  const { minimo, maximo } = instrumento.escala;
  const media = valores.reduce((t, v) => t + v, 0) / valores.length;
  return Math.round(((media - minimo) / (maximo - minimo)) * 100 * 100) / 100;
}

export function validarValores(instrumento: Instrumento, valores: number[]): void {
  if (valores.length !== instrumento.items.length) {
    throw new Error(
      `Responda los ${instrumento.items.length} ítems; llegaron ${valores.length} respuestas.`,
    );
  }
  const { minimo, maximo } = instrumento.escala;
  const fuera = valores.findIndex((v) => !Number.isInteger(v) || v < minimo || v > maximo);
  if (fuera >= 0) {
    throw new Error(
      `La respuesta al ítem ${fuera + 1} tiene que estar entre ${minimo} y ${maximo}.`,
    );
  }
}

/**
 * SOC-1 · Variacion del indice entre la linea base y el seguimiento.
 *
 * Sobre pares de la misma persona, no sobre dos muestras: si el seguimiento
 * lo respondieran solo los mas satisfechos, comparar promedios de grupos
 * distintos inventaria una mejora.
 */
export function variacionSoc1(pares: Array<{ base: number; seguimiento: number }>): number | null {
  if (pares.length === 0) return null;
  const base = pares.reduce((t, p) => t + p.base, 0) / pares.length;
  const seguimiento = pares.reduce((t, p) => t + p.seguimiento, 0) / pares.length;
  if (base === 0) return null;
  return Math.round(((seguimiento - base) / base) * 1000) / 10;
}
