import { Prisma, type TipoMovimiento } from '@prisma/client';

import { ASIENTOS, CUENTAS } from './cuentas';

/**
 * Correspondencia de las cuentas internas con el PCGE (RF-CF-05).
 *
 * El libro conserva sus cinco cuentas propias: un plan completo haria mas
 * dificil leerlo, que es lo que un auditor va a querer hacer. La traduccion
 * al Plan Contable General Empresarial ocurre solo al exportar, y nunca
 * reescribe un asiento: los hashes de la cadena incluyen las cuentas
 * internas, asi que cambiarlas romperia la prueba de que el libro no se toco.
 *
 * ESTA TABLA ES LA PROPUESTA DE D1 (ADR-0007), TODAVIA SIN FIRMA DE
 * CONTABILIDAD. Vive aqui, y solo aqui, para que la decision que se firme
 * cambie un archivo y sus pruebas, no los servicios que la usan.
 *
 * Se traduce a nivel de divisionaria (tres digitos) y la cuenta interna
 * viaja como subcuenta auxiliar. Por eso 20.1 y 20.2 caen ambas en la 496:
 * la RETENCION es una reclasificacion dentro de los ingresos diferidos, y lo
 * que las distingue es la auxiliar.
 */

export type CuentaInterna = (typeof CUENTAS)[keyof typeof CUENTAS];

export type Naturaleza = 'DEUDORA' | 'ACREEDORA';

export interface CuentaPcge {
  codigo: string;
  nombre: string;
  /** Lado en que la cuenta acumula su saldo en este modelo. */
  naturaleza: Naturaleza;
}

export const PCGE: Record<CuentaInterna, CuentaPcge> = {
  [CUENTAS.CAJA]: {
    codigo: '104',
    nombre: 'Cuentas corrientes en instituciones financieras',
    naturaleza: 'DEUDORA',
  },
  // La donacion es un pasivo hasta justificarla: si la causa no la usa, el
  // donante conserva un derecho sobre ella (D2). Ingreso diferido, no ingreso.
  [CUENTAS.POR_EJECUTAR]: {
    codigo: '496',
    nombre: 'Ingresos diferidos',
    naturaleza: 'ACREEDORA',
  },
  [CUENTAS.RETENIDO]: {
    codigo: '496',
    nombre: 'Ingresos diferidos',
    naturaleza: 'ACREEDORA',
  },
  // "Gastos ejecutados" se abona al ejecutar: es el ingreso que se reconoce
  // cuando la condicion del donante se cumple, no el gasto. Llevarla al
  // elemento 6 daria un gasto con saldo acreedor; ademas, en el PCGE la 60
  // es Compras. Ver el hallazgo 1 de D1.
  [CUENTAS.EJECUTADO]: {
    codigo: '759',
    nombre: 'Otros ingresos de gestion',
    naturaleza: 'ACREEDORA',
  },
  [CUENTAS.COMISION_PASARELA]: {
    codigo: '639',
    nombre: 'Otros servicios prestados por terceros',
    naturaleza: 'DEUDORA',
  },
};

export interface LineaPcge {
  cuenta: CuentaPcge;
  /** La cuenta interna, como subcuenta auxiliar. */
  auxiliar: CuentaInterna;
}

/**
 * Asiento PCGE de un tipo de movimiento.
 *
 * Se resuelve por el tipo y no por el texto guardado en cada fila: el unico
 * que escribe asientos es LibroService, y lo hace siempre desde ASIENTOS. Un
 * solo lugar decide que cuenta se carga y cual se abona; leerlo de vuelta de
 * cada fila seria aceptar que pueda haber otro.
 */
export function asientoPcge(tipo: TipoMovimiento): { debe: LineaPcge; haber: LineaPcge } {
  const { debe, haber } = ASIENTOS[tipo];
  return {
    debe: { cuenta: PCGE[debe], auxiliar: debe },
    haber: { cuenta: PCGE[haber], auxiliar: haber },
  };
}

export interface LineaDiario extends LineaPcge {
  debe: Prisma.Decimal;
  haber: Prisma.Decimal;
}

/**
 * Las dos lineas de diario de un movimiento: el cargo y el abono.
 *
 * Un libro diario lleva una linea por cuenta afectada, no una por hecho. Es
 * la forma en que un contador comprueba que cada asiento cuadra, y la que
 * piden el mayor y el PLE.
 */
export function lineasDiario(
  tipo: TipoMovimiento,
  monto: Prisma.Decimal | string,
): [LineaDiario, LineaDiario] {
  const importe = new Prisma.Decimal(monto);
  const cero = new Prisma.Decimal(0);
  const { debe, haber } = asientoPcge(tipo);
  return [
    { ...debe, debe: importe, haber: cero },
    { ...haber, debe: cero, haber: importe },
  ];
}
