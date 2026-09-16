import { Prisma } from '@prisma/client';

/** Decimales con los que se opera y se muestra el sol peruano. */
export const DECIMALES = 2;

/**
 * Formatea un importe para salir por la API.
 *
 * Siempre con dos decimales. `Decimal.toFixed()` sin argumento devuelve
 * "100" cuando el valor es entero y "95.56" cuando no lo es, asi que la
 * misma API entregaria montos con formato distinto segun el valor. En una
 * plataforma cuyo argumento central es que cada sol es trazable, que un
 * importe se vea como "100" y otro como "95.56" resta credibilidad antes de
 * que nadie revise la contabilidad.
 *
 * Se devuelve como texto y no como number a proposito: el punto flotante de
 * JavaScript no representa exactamente los centimos, y el redondeo tiene que
 * ocurrir una sola vez, aqui, y no en cada consumidor.
 */
export function soles(valor: Prisma.Decimal | number | string): string {
  return new Prisma.Decimal(valor).toFixed(DECIMALES);
}

/** Suma una lista de importes sin perder precision. */
export function sumarSoles(valores: Array<Prisma.Decimal | number | string>): Prisma.Decimal {
  return valores.reduce<Prisma.Decimal>(
    (total, v) => total.plus(new Prisma.Decimal(v)),
    new Prisma.Decimal(0),
  );
}
