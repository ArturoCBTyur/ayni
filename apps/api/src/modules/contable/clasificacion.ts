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
  /**
   * Lo recibido neto de comisiones. NO es lo que hay en custodia: el libro
   * no registra la salida del dinero hacia la ONG (hallazgo 3 de D1).
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
    reasignadoPendiente: s.REASIGNACION,
    efectivoRecibidoNeto: s.INGRESO.minus(s.COMISION),
  };
}

/**
 * Lo que la clasificacion tiene que cumplir para ser una particion.
 *
 * Todo sol que entro esta en exactamente un lugar: se lo quedo la pasarela,
 * sigue retenido, se libero o salio hacia otro destino. Si la suma no da el
 * bruto, el libro tiene un asiento que la clasificacion no sabe leer.
 */
export function clasificacionCuadra(c: SaldosClasificados): boolean {
  return c.comisiones
    .plus(c.conRestriccion)
    .plus(c.liberados)
    .plus(c.reasignadoPendiente)
    .equals(c.recaudadoBruto);
}
