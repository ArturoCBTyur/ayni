import type { TipoComprobante, TipoMovimiento } from '@prisma/client';

import { soles } from '../../comun/dinero';
import { fechaEnLima, type Periodo } from '../../comun/periodo';
import { lineasDiario } from './pcge';

/**
 * Libro diario (formato 5.1) y libro mayor (formato 6.1) del PLE de SUNAT.
 * RF-CF-10, T2.4.
 *
 * ES UN BORRADOR. La estructura sigue los 21 campos de los formatos 5.1 y
 * 6.1 tal como se entendieron al escribir esto, y el plan exige que un
 * contador la valide antes de que nadie la presente. Ademas, D1 (ADR-0007)
 * muestra que este libro no es la contabilidad completa de la ONG: no
 * registra el desembolso hacia ella ni sus otros ingresos y gastos. Por eso
 * el archivo sale con el prefijo BORRADOR- en el nombre.
 *
 * Lo que un contador tiene que revisar, como minimo: el formato del
 * correlativo (campo 3), que hacer con los campos 10 a 12 cuando el
 * movimiento no tiene comprobante, la codificacion del archivo (sale en
 * UTF-8) y si hace falta el formato 5.3 del plan de cuentas.
 */

export type LibroPle = 'diario' | 'mayor';

const CODIGO_LIBRO: Record<LibroPle, string> = { diario: '050100', mayor: '060100' };

/** Tabla 10 de SUNAT. La nota de venta no es comprobante de pago: va como "otros". */
const TIPO_COMPROBANTE: Record<TipoComprobante, string> = {
  FACTURA: '01',
  RECIBO_HONORARIOS: '02',
  BOLETA: '03',
  NOTA_VENTA: '00',
};

export interface MovimientoPle {
  fondoId: string;
  secuencia: number;
  fecha: Date;
  tipo: TipoMovimiento;
  monto: string;
  descripcion: string;
  comprobante: { tipo: TipoComprobante; serie: string; numero: string } | null;
}

/**
 * LE + RUC + AAAAMM00 + libro + oportunidad (00) + con operaciones (1/0) +
 * contenido (1) + moneda soles (1) + generado por el PLE (1).
 */
export function nombreArchivoPle(
  ruc: string,
  p: Periodo,
  libro: LibroPle,
  conOperaciones: boolean,
): string {
  const mes = String(p.mes).padStart(2, '0');
  return `LE${ruc}${p.anio}${mes}00${CODIGO_LIBRO[libro]}00${conOperaciones ? 1 : 0}111.txt`;
}

/**
 * Codigo unico de la operacion: el fondo y su secuencia. Cada fondo tiene su
 * propia cadena, asi que la secuencia sola se repite entre fondos de la
 * misma ONG.
 */
function cuo(m: MovimientoPle): string {
  return `${m.fondoId.replace(/-/g, '').slice(0, 8)}${String(m.secuencia).padStart(6, '0')}`;
}

/** El separador del PLE es la barra vertical: no puede aparecer en un campo. */
function limpiar(texto: string, maximo: number): string {
  return texto
    .replace(/[|\s]+/g, ' ')
    .trim()
    .slice(0, maximo);
}

/** Las lineas del libro pedido, ya ordenadas: por fecha el diario, por cuenta el mayor. */
export function lineasPle(movimientos: MovimientoPle[], p: Periodo, libro: LibroPle): string[] {
  const periodoPle = `${p.anio}${String(p.mes).padStart(2, '0')}00`;

  const filas = movimientos.flatMap((m) =>
    lineasDiario(m.tipo, m.monto).map((l, i) => {
      const fecha = fechaEnLima(m.fecha);
      const campos = [
        periodoPle,
        cuo(m),
        `M${i + 1}`,
        l.cuenta.codigo,
        '',
        '',
        'PEN',
        '',
        '',
        m.comprobante ? TIPO_COMPROBANTE[m.comprobante.tipo] : '00',
        m.comprobante ? limpiar(m.comprobante.serie, 20) : '',
        m.comprobante ? limpiar(m.comprobante.numero, 20) : String(m.secuencia),
        fecha,
        '',
        fecha,
        limpiar(m.descripcion, 200),
        limpiar(l.auxiliar, 200),
        soles(l.debe),
        soles(l.haber),
        '',
        '1',
      ];
      return { cuenta: l.cuenta.codigo, orden: m.fecha.getTime(), cuo: cuo(m), linea: i, campos };
    }),
  );

  if (libro === 'mayor') {
    filas.sort(
      (a, b) =>
        (a.cuenta < b.cuenta ? -1 : a.cuenta > b.cuenta ? 1 : 0) ||
        a.orden - b.orden ||
        (a.cuo < b.cuo ? -1 : a.cuo > b.cuo ? 1 : 0) ||
        a.linea - b.linea,
    );
  }

  return filas.map((f) => `${f.campos.join('|')}|`);
}
