import { Prisma, type TipoMovimiento } from '@prisma/client';

const CERO = new Prisma.Decimal(0);

/** Suma de los montos del libro por tipo de movimiento. */
export type SumasPorTipo = Record<TipoMovimiento, Prisma.Decimal>;

export function sumasVacias(): SumasPorTipo {
  return {
    INGRESO: CERO,
    COMISION: CERO,
    RETENCION: CERO,
    EJECUCION: CERO,
    REVERSO: CERO,
    REASIGNACION: CERO,
    DEVOLUCION: CERO,
    TRASLADO_SALIDA: CERO,
    TRASLADO_ENTRADA: CERO,
  };
}

/** Convierte el resultado de un groupBy por tipo en sumas, con cero en lo que falte. */
export function sumasDesdeGrupos(
  grupos: Array<{ tipo: TipoMovimiento; _sum: { monto: Prisma.Decimal | null } }>,
): SumasPorTipo {
  const sumas = sumasVacias();
  for (const g of grupos) sumas[g.tipo] = g._sum.monto ?? CERO;
  return sumas;
}

/**
 * Saldos de un fondo clasificados segun D1 (RF-CF-06).
 *
 * El marco propuesto (INPAG) separa lo que el donante todavia condiciona de
 * lo que ya se libero. En este modelo eso tiene una lectura directa: lo
 * retenido por justificar sigue con restriccion, y lo ejecutado es lo que se
 * libero al aprobarse un gasto.
 */
export interface SaldosClasificados {
  /** Lo que entro del donante, antes de la comision (INGRESO). */
  recaudadoBruto: Prisma.Decimal;
  /** Lo que se quedo la pasarela (COMISION). */
  comisiones: Prisma.Decimal;
  /** Retenido por justificar: sigue sujeto a la condicion del donante. */
  conRestriccion: Prisma.Decimal;
  /** Ejecutado contra gasto aprobado, neto de reversos. */
  liberados: Prisma.Decimal;
  /** Salio de lo retenido para otro destino y todavia no llego a el. */
  reasignadoPendiente: Prisma.Decimal;
  /** D2 · Remanente devuelto a sus donantes al cerrar la causa. */
  devuelto: Prisma.Decimal;
  /** D2 · Remanente que salio hacia otro fondo elegido por su donante. */
  trasladado: Prisma.Decimal;
  /** D2 · Lo que llego desde el cierre de otra causa (TRASLADO_ENTRADA). */
  recibidoPorTraslado: Prisma.Decimal;
  /**
   * Lo recibido neto de comisiones y de lo que salio por cierre. NO es lo
   * que hay en custodia: el libro no registra la salida del dinero hacia la
   * ONG (hallazgo 3 de D1).
   */
  efectivoRecibidoNeto: Prisma.Decimal;
}

/**
 * Clasifica a partir de las sumas del libro, sin mirar los saldos guardados.
 *
 * Es la misma aritmetica que el trigger fn_movimiento_aplicar_saldos, escrita
 * por separado a proposito: la conciliacion compara las dos, y si las dos
 * salieran de la misma funcion no compararia nada.
 */
export function clasificarSaldos(s: SumasPorTipo): SaldosClasificados {
  return {
    recaudadoBruto: s.INGRESO,
    comisiones: s.COMISION,
    conRestriccion: s.RETENCION.minus(s.EJECUCION).plus(s.REVERSO).minus(s.REASIGNACION),
    liberados: s.EJECUCION.minus(s.REVERSO),
    reasignadoPendiente: s.REASIGNACION.minus(s.DEVOLUCION).minus(s.TRASLADO_SALIDA),
    devuelto: s.DEVOLUCION,
    trasladado: s.TRASLADO_SALIDA,
    recibidoPorTraslado: s.TRASLADO_ENTRADA,
    efectivoRecibidoNeto: s.INGRESO.minus(s.COMISION)
      .plus(s.TRASLADO_ENTRADA)
      .minus(s.DEVOLUCION)
      .minus(s.TRASLADO_SALIDA),
  };
}

/**
 * Lo que la clasificacion tiene que cumplir para ser una particion.
 *
 * Todo sol que entro (del donante o trasladado desde otra causa) esta en
 * exactamente un lugar: se lo quedo la pasarela, sigue retenido, se libero,
 * va hacia otro destino, se devolvio o se traslado. Si la suma no da lo que
 * entro, el libro tiene un asiento que la clasificacion no sabe leer.
 */
export function clasificacionCuadra(c: SaldosClasificados): boolean {
  return c.comisiones
    .plus(c.conRestriccion)
    .plus(c.liberados)
    .plus(c.reasignadoPendiente)
    .plus(c.devuelto)
    .plus(c.trasladado)
    .equals(c.recaudadoBruto.plus(c.recibidoPorTraslado));
}
