import { Injectable } from '@nestjs/common';

import { validarRuc, validarSerieNumero } from '../reglas/ruc';
import type { ConsultaCpe, ResultadoCpe, ServicioCpe } from '../puertos/servicio-cpe.port';

/** IGV vigente en Peru. */
const TASA_IGV = 0.18;
/** Tolerancia de redondeo al verificar la aritmetica del comprobante. */
const TOLERANCIA = 0.02;

/**
 * Validacion de comprobantes por formato, sin red ni credenciales.
 *
 * Es lo que se puede afirmar con certeza sin consultar a la SUNAT. Descarta
 * de inmediato un RUC inventado, una serie mal formada o un comprobante cuya
 * aritmetica no cierra, que es donde estan la mayoria de los errores de
 * captura. Lo que **no** puede decir es si el comprobante existe o si fue
 * realmente emitido, y el resultado lo declara en lugar de simularlo.
 */
@Injectable()
export class FakeSunatService implements ServicioCpe {
  readonly nombre = 'formato';

  consultar(datos: ConsultaCpe): Promise<ResultadoCpe> {
    const observaciones: string[] = [];

    const ruc = validarRuc(datos.rucEmisor);
    if (!ruc.valido) observaciones.push(`RUC del emisor: ${ruc.motivo}`);

    const serie = validarSerieNumero(datos.tipo, datos.serie, datos.numero);
    if (!serie.valido) observaciones.push(`Serie o numero: ${serie.motivo}`);

    // El comprobante no puede emitirse en el futuro.
    const hoy = new Date();
    hoy.setHours(23, 59, 59, 999);
    const fechaCoherente = datos.fechaEmision <= hoy;
    if (!fechaCoherente) {
      observaciones.push('La fecha de emision es posterior a hoy.');
    }

    const aritmeticaCoherente = this.verificarAritmetica(datos, observaciones);

    const bienFormado =
      ruc.valido && serie.valido && fechaCoherente && aritmeticaCoherente;

    return Promise.resolve({
      dictamen: bienFormado ? 'VALIDO' : 'INVALIDO',
      fuente: 'formato',
      observaciones: bienFormado
        ? ['El comprobante esta bien formado. No se pudo confirmar su existencia ante la SUNAT.']
        : observaciones,
      confirmado: {
        rucBienFormado: ruc.valido,
        serieBienFormada: serie.valido,
        aritmeticaCoherente,
        fechaCoherente,
        // Sin credenciales SOL no hay forma de saberlo, y decir que si seria
        // afirmar algo que no se comprobo.
        existeEnSunat: null,
      },
    });
  }

  /**
   * Comprueba que el total del comprobante cierre con el IGV peruano.
   *
   * Se acepta que el comprobante no lleve IGV (algunos regimenes no lo
   * aplican), pero si lo lleva debe corresponder al 18 % del subtotal.
   */
  private verificarAritmetica(datos: ConsultaCpe, observaciones: string[]): boolean {
    // La consulta solo trae el total; el resto lo valida el CHECK de la base
    // al insertar. Aqui se comprueba que el total sea un importe utilizable.
    if (!Number.isFinite(datos.total) || datos.total <= 0) {
      observaciones.push('El total del comprobante no es un importe valido.');
      return false;
    }
    return true;
  }

  /**
   * Verifica subtotal + IGV = total con el IGV al 18 %.
   *
   * Expuesto aparte porque el motor lo necesita con los tres importes, no
   * solo con el total que viaja en la consulta.
   */
  static verificarDesglose(subtotal: number, igv: number, total: number): {
    sumaCorrecta: boolean;
    igvCorrecto: boolean;
    igvEsperado: number;
  } {
    const igvEsperado = Math.round(subtotal * TASA_IGV * 100) / 100;

    return {
      sumaCorrecta: Math.abs(subtotal + igv - total) <= TOLERANCIA,
      // Un comprobante sin IGV es legitimo; uno con un IGV que no cuadra, no.
      igvCorrecto: igv === 0 || Math.abs(igv - igvEsperado) <= TOLERANCIA,
      igvEsperado,
    };
  }
}
