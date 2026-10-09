import { DocumentoPdf } from '../../comun/formatos/pdf';
import { fechaEnLima } from '../../comun/periodo';
import { enSoles } from '../analitica/estados.render';

/**
 * RF-DE-07 · Constancia de donacion para el donante (T6.1).
 *
 * Dice que la donacion existio, por cuanto, a quien y que se hizo con ella.
 * NO es el comprobante de recepcion de donaciones que la norma tributaria
 * pide a una entidad perceptora: que datos exige ese comprobante y en que
 * forma lo tiene que validar un contador, y hasta entonces la constancia lo
 * advierte en lugar de imitarlo.
 */
export interface Constancia {
  numero: string;
  emitidaEn: Date;
  donatario: {
    razonSocial: string;
    ruc: string;
    direccion: string;
    /** Calificada como perceptora en la fecha de la donacion, con su resolucion. */
    perceptora: { resolucion: string; desde: Date; hasta: Date | null } | null;
  };
  donante: { nombre: string; documento: string | null };
  donacion: {
    id: string;
    fecha: Date;
    monto: string;
    comision: string;
    neto: string;
    medio: string;
    referencia: string | null;
    fondo: string;
    campana: string;
    /** Si nacio del saldo de un aporte anterior al cerrar su causa. */
    trasladadaDesde: string | null;
  };
  destino: { aplicado: string; esperandoEvidencia: string; saldoDeCierre: string | null };
}

export function constanciaPdf(c: Constancia): Buffer {
  const pdf = new DocumentoPdf(`Constancia de donación ${c.numero}`);
  const derecha = DocumentoPdf.ANCHO_UTIL;
  const fila = (concepto: string, valor: string, negrita = false) =>
    pdf.fila([
      { texto: concepto, negrita },
      { texto: valor, x: derecha, alineacion: 'derecha', negrita },
    ]);

  pdf.linea('Constancia de donación', { tamano: 16, negrita: true });
  pdf.linea(`N.° ${c.numero} · emitida el ${fechaEnLima(c.emitidaEn)}`, { gris: true });
  pdf.espacio(6).raya();

  pdf.linea('Organización que recibió la donación', { tamano: 11, negrita: true });
  pdf.linea(c.donatario.razonSocial);
  pdf.linea(`RUC ${c.donatario.ruc} · ${c.donatario.direccion}`, { tamano: 9, gris: true });
  if (c.donatario.perceptora) {
    const p = c.donatario.perceptora;
    pdf.linea(
      `Calificada por SUNAT como entidad perceptora de donaciones: ${p.resolucion}, ` +
        `desde el ${fechaEnLima(p.desde)}${p.hasta ? ` hasta el ${fechaEnLima(p.hasta)}` : ''}.`,
      { tamano: 9 },
    );
  }
  pdf.espacio(8);

  pdf.linea('Donante', { tamano: 11, negrita: true });
  pdf.linea(c.donante.nombre);
  if (c.donante.documento) pdf.linea(c.donante.documento, { tamano: 9, gris: true });
  pdf.espacio(8);

  pdf.linea('Donación', { tamano: 11, negrita: true });
  fila('Fecha', fechaEnLima(c.donacion.fecha));
  fila('Monto donado', enSoles(c.donacion.monto), true);
  fila('Comisión de la pasarela de pago', enSoles(c.donacion.comision));
  fila('Monto que llegó al fondo', enSoles(c.donacion.neto));
  fila('Medio', c.donacion.medio);
  if (c.donacion.referencia) fila('Referencia del pago', c.donacion.referencia);
  fila('Destino', `${c.donacion.fondo} · ${c.donacion.campana}`);
  if (c.donacion.trasladadaDesde) {
    pdf.linea(
      `Proviene del saldo de un aporte anterior a ${c.donacion.trasladadaDesde}, ` +
        'trasladado por elección del donante al cerrar esa causa.',
      { tamano: 9, gris: true },
    );
  }
  pdf.espacio(8);

  pdf.linea('Qué se hizo con ella, a la fecha', { tamano: 11, negrita: true });
  fila('Aplicado a gastos verificados', enSoles(c.destino.aplicado));
  fila('Retenido, esperando evidencia', enSoles(c.destino.esperandoEvidencia));
  if (c.destino.saldoDeCierre) fila('Saldo al cerrar la causa', c.destino.saldoDeCierre);
  pdf.espacio(12).raya();

  pdf.parrafo(
    'Esta constancia acredita la donación registrada en Ayni. No es un comprobante de pago.',
    { tamano: 8, gris: true },
  );
  if (c.donatario.perceptora) {
    pdf.parrafo(
      'Tampoco reemplaza el comprobante de recepción de donaciones que la organización, como ' +
        'entidad perceptora, debe emitir según la norma tributaria. Qué datos exige ese ' +
        'comprobante está pendiente de validación por un contador (plan transdisciplinario, ' +
        'T6.1); no presente esta constancia ante SUNAT en su lugar.',
      { tamano: 8, gris: true },
    );
  }
  return pdf.generar();
}
