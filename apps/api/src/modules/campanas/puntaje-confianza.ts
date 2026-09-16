/**
 * Puntaje de confianza publico de una ONG (RF-SO-01).
 *
 * La sociologia del proyecto sostiene que la confianza institucional se
 * reconstruye con señales visibles, comprensibles y basadas en conducta
 * verificable, no en reputacion mediatica. De ahi tres decisiones que este
 * calculo hace explicitas:
 *
 * 1. **Es explicable.** Devuelve el desglose, no solo el numero. Una ONG que
 *    baja de puntaje tiene derecho a saber por que y que corregir.
 *
 * 2. **No castiga la falta de historial.** Una organizacion recien
 *    verificada no tiene gastos que evaluar. Darle un puntaje bajo la
 *    hundiria antes de empezar, y darle uno alto engañaria al donante. Por
 *    eso arranca en un valor neutro y cada componente solo pesa cuando hay
 *    datos suficientes para sostenerlo.
 *
 * 3. **Respeta el debido proceso (RF-SO-04).** Solo cuentan las alertas
 *    marcadas como afectaReputacion, que son las que ya vencieron su plazo
 *    de subsanacion. Un error subsanable no debe manchar a nadie.
 */

/** Valor de partida cuando no hay conducta que evaluar todavia. */
export const PUNTAJE_NEUTRO = 50;

/** Minimo de casos para que un componente deje de ser anecdota. */
const MINIMO_PARA_EVALUAR = 3;

export interface SenalesPuntaje {
  /** Gastos ya aprobados de la ONG. */
  gastosAprobados: number;
  /** De esos, los que tienen comprobante y al menos una evidencia. */
  gastosConRespaldoCompleto: number;
  /** Alertas que ya vencieron su plazo y por tanto afectan reputacion. */
  alertasQueAfectan: number;
  /** De esas, las que la ONG resolvio. */
  alertasResueltas: number;
  /** Horas promedio en resolver una alerta; null si nunca tuvo ninguna. */
  horasPromedioRespuesta: number | null;
}

export type ComponentePuntaje = {
  codigo: 'cumplimiento_evidencias' | 'tiempo_respuesta' | 'observaciones_resueltas';
  etiqueta: string;
  /** 0 a 100, o null si aun no hay datos suficientes. */
  valor: number | null;
  peso: number;
  /** Explicacion en lenguaje que entienda un donante, no un desarrollador. */
  detalle: string;
};

export type PuntajeConfianza = {
  puntaje: number;
  componentes: ComponentePuntaje[];
  /** true si el puntaje aun descansa sobre poca conducta observada. */
  historialInsuficiente: boolean;
};

const PESOS = {
  cumplimiento_evidencias: 0.5,
  observaciones_resueltas: 0.3,
  tiempo_respuesta: 0.2,
} as const;

/** 48 horas habiles es el SLA de auditoria (RN-07); se usa de referencia. */
const HORAS_RESPUESTA_IDEAL = 48;
const HORAS_RESPUESTA_PESIMA = 240;

export function calcularPuntajeConfianza(senales: SenalesPuntaje): PuntajeConfianza {
  const componentes: ComponentePuntaje[] = [
    evaluarCumplimiento(senales),
    evaluarObservaciones(senales),
    evaluarTiempoRespuesta(senales),
  ];

  const conDatos = componentes.filter((c) => c.valor !== null);

  if (conDatos.length === 0) {
    return { puntaje: PUNTAJE_NEUTRO, componentes, historialInsuficiente: true };
  }

  // Se renormaliza sobre los componentes con datos: si una ONG nunca tuvo
  // alertas, no se le puede exigir un historial de resolucion, ni tampoco
  // premiarla por algo que no hizo.
  const pesoTotal = conDatos.reduce((suma, c) => suma + c.peso, 0);
  const ponderado = conDatos.reduce((suma, c) => suma + (c.valor ?? 0) * c.peso, 0) / pesoTotal;

  // Con poco historial el puntaje se acerca al neutro en lugar de saltar a
  // los extremos por un par de casos.
  const confianzaEnDatos = Math.min(senales.gastosAprobados / (MINIMO_PARA_EVALUAR * 2), 1);
  const puntaje = PUNTAJE_NEUTRO + (ponderado - PUNTAJE_NEUTRO) * confianzaEnDatos;

  return {
    puntaje: redondear(Math.max(0, Math.min(100, puntaje))),
    componentes,
    historialInsuficiente: senales.gastosAprobados < MINIMO_PARA_EVALUAR,
  };
}

function evaluarCumplimiento(s: SenalesPuntaje): ComponentePuntaje {
  const base = {
    codigo: 'cumplimiento_evidencias' as const,
    etiqueta: 'Gastos respaldados con comprobante y evidencia',
    peso: PESOS.cumplimiento_evidencias,
  };

  if (s.gastosAprobados === 0) {
    return { ...base, valor: null, detalle: 'Todavia no tiene gastos aprobados que evaluar.' };
  }

  const porcentaje = (s.gastosConRespaldoCompleto / s.gastosAprobados) * 100;
  return {
    ...base,
    valor: redondear(porcentaje),
    detalle:
      `${s.gastosConRespaldoCompleto} de ${s.gastosAprobados} gastos aprobados tienen ` +
      'comprobante de pago y evidencia visual.',
  };
}

function evaluarObservaciones(s: SenalesPuntaje): ComponentePuntaje {
  const base = {
    codigo: 'observaciones_resueltas' as const,
    etiqueta: 'Observaciones resueltas',
    peso: PESOS.observaciones_resueltas,
  };

  if (s.alertasQueAfectan === 0) {
    return {
      ...base,
      valor: null,
      detalle: 'No registra observaciones pendientes de subsanacion.',
    };
  }

  const porcentaje = (s.alertasResueltas / s.alertasQueAfectan) * 100;
  return {
    ...base,
    valor: redondear(porcentaje),
    detalle: `Resolvio ${s.alertasResueltas} de ${s.alertasQueAfectan} observaciones.`,
  };
}

function evaluarTiempoRespuesta(s: SenalesPuntaje): ComponentePuntaje {
  const base = {
    codigo: 'tiempo_respuesta' as const,
    etiqueta: 'Rapidez para responder observaciones',
    peso: PESOS.tiempo_respuesta,
  };

  if (s.horasPromedioRespuesta === null) {
    return { ...base, valor: null, detalle: 'Aun no ha tenido que responder observaciones.' };
  }

  const horas = s.horasPromedioRespuesta;
  let valor: number;

  if (horas <= HORAS_RESPUESTA_IDEAL) {
    valor = 100;
  } else if (horas >= HORAS_RESPUESTA_PESIMA) {
    valor = 0;
  } else {
    valor =
      100 * (1 - (horas - HORAS_RESPUESTA_IDEAL) / (HORAS_RESPUESTA_PESIMA - HORAS_RESPUESTA_IDEAL));
  }

  return {
    ...base,
    valor: redondear(valor),
    detalle: `Responde en promedio en ${Math.round(horas)} horas.`,
  };
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
