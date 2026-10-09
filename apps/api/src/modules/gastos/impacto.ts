import { Prisma, type CategoriaGasto } from '@prisma/client';

import { soles } from '../../comun/dinero';

/**
 * Unidades de impacto por categoria de gasto (RF-SO-08, RF-SO-09).
 *
 * ESTA ES LA PROPUESTA DE D4 (ADR-0007), TODAVIA SIN FIRMA DE SOCIOLOGIA. Vive
 * aqui, y solo aqui, para que lo que se firme cambie este archivo y no los
 * servicios. Una categoria sin unidad (null) no mide impacto: un insumo no es
 * un resultado, y contarlo como si lo fuera inventaria uno.
 */
export const UNIDAD_POR_CATEGORIA: Record<CategoriaGasto, string | null> = {
  ALIMENTOS: 'raciones entregadas',
  ATENCION_VETERINARIA: 'animales atendidos',
  MEDICAMENTOS: 'tratamientos completados',
  INSUMOS: null,
  TRANSPORTE: 'traslados realizados',
  INFRAESTRUCTURA: 'espacios habilitados',
  ESTERILIZACION: 'esterilizaciones',
  OTROS: null,
};

export function unidadDe(categoria: CategoriaGasto): string | null {
  return UNIDAD_POR_CATEGORIA[categoria];
}

/** RF-SO-09 · Costo por unidad de impacto de un conjunto de gastos aprobados. */
export interface Impacto {
  categoria: CategoriaGasto;
  unidad: string;
  unidades: number;
  /** Cuantos gastos declararon unidades, de cuantos aprobados: el costo es solo de esos. */
  gastosConUnidades: number;
  gastosAprobados: number;
  ejecutadoConUnidades: string;
  costoPorUnidad: string | null;
}

/**
 * Agrupa por categoria y divide lo ejecutado entre las unidades declaradas.
 *
 * Solo cuenta los gastos que declararon unidades: si la mitad no las declaro,
 * dividir todo lo ejecutado entre la mitad de las unidades duplicaria el costo.
 * Por eso el resultado dice cuantos gastos entraron al calculo.
 */
export function calcularImpacto(
  gastos: Array<{
    categoria: CategoriaGasto;
    monto: Prisma.Decimal | string;
    unidades: number | null;
  }>,
): Impacto[] {
  const porCategoria = new Map<
    CategoriaGasto,
    { unidades: number; con: number; total: number; ejecutado: Prisma.Decimal }
  >();

  for (const g of gastos) {
    if (!unidadDe(g.categoria)) continue;
    const actual = porCategoria.get(g.categoria) ?? {
      unidades: 0,
      con: 0,
      total: 0,
      ejecutado: new Prisma.Decimal(0),
    };
    actual.total += 1;
    if (g.unidades && g.unidades > 0) {
      actual.unidades += g.unidades;
      actual.con += 1;
      actual.ejecutado = actual.ejecutado.plus(g.monto);
    }
    porCategoria.set(g.categoria, actual);
  }

  return [...porCategoria.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([categoria, c]) => ({
      categoria,
      unidad: unidadDe(categoria)!,
      unidades: c.unidades,
      gastosConUnidades: c.con,
      gastosAprobados: c.total,
      ejecutadoConUnidades: soles(c.ejecutado),
      costoPorUnidad: c.unidades > 0 ? soles(c.ejecutado.dividedBy(c.unidades)) : null,
    }));
}
