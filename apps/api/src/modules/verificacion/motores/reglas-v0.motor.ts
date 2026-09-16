import { Inject, Injectable } from '@nestjs/common';

import { NITIDEZ_MINIMA, UMBRAL_DUPLICADO_PERCEPTUAL } from '../../gastos/imagen';
import { FakeSunatService } from '../cpe/fake-sunat.service';
import type {
  AlertaAnalisis,
  EntradaAnalisis,
  MotivoAnalisis,
  NivelConfianza,
  ResultadoAnalisis,
} from '../contrato/analisis.contrato';
import type { MotorVerificacion } from '../puertos/motor-verificacion.port';
import { SERVICIO_CPE, type ServicioCpe } from '../puertos/servicio-cpe.port';
import { validarRuc, validarSerieNumero } from '../reglas/ruc';

/**
 * Motor de Reglas v0: la verificacion de esta version, sin IA (ADR-0005).
 *
 * Produce exactamente el mismo `ResultadoAnalisis` que producira AIni, con
 * las tres señales del contrato y la misma regla de umbrales. La diferencia
 * esta solo en como se obtiene cada señal: aqui son reglas deterministas
 * sobre datos declarados, hashes e historial, en lugar de OCR, vision por
 * computador y modelos entrenados.
 *
 * Dos principios que el codigo respeta a proposito:
 *
 * 1. **Nunca inventa certeza.** Cuando una señal no se puede evaluar (no hay
 *    historial, la evidencia es un video, el comprobante no trae IGV), la
 *    regla no penaliza: se omite. Penalizar por falta de datos convertiria
 *    la ignorancia del sistema en una sospecha sobre la ONG.
 *
 * 2. **Todo motivo es legible.** Cada regla reporta que evaluo, como salio y
 *    con que valor. Es lo que exige RNF-09, y tambien lo que permite que una
 *    ONG entienda que corregir en lugar de recibir un numero sin explicacion.
 */
@Injectable()
export class MotorReglasV0 implements MotorVerificacion {
  readonly version = 'motor-verificacion@reglas-v0';

  constructor(@Inject(SERVICIO_CPE) private readonly cpe: ServicioCpe) {}

  async analizar(entrada: EntradaAnalisis): Promise<ResultadoAnalisis> {
    const inicio = Date.now();
    const motivos: MotivoAnalisis[] = [];
    const alertas: AlertaAnalisis[] = [];

    const bloqueo = this.evaluarBloqueos(entrada, motivos, alertas);

    const scoreDocumental = await this.evaluarDocumental(entrada, motivos);
    const scoreVisual = this.evaluarVisual(entrada, motivos);
    const scoreAnomalia = this.evaluarAnomalia(entrada, motivos, alertas);

    const { regla } = entrada;
    const scoreFinal = redondear(
      scoreDocumental * regla.pesoDocumental +
        scoreVisual * regla.pesoVisual +
        scoreAnomalia * regla.pesoAnomalia,
    );

    // Un bloqueo duro manda a BAJO sin importar el promedio: son hechos
    // objetivos (un comprobante repetido, saldo insuficiente), no indicios
    // que puedan compensarse con un buen puntaje en otra señal.
    const nivel: NivelConfianza = bloqueo
      ? 'BAJO'
      : scoreFinal > regla.umbralAlto
        ? 'ALTO'
        : scoreFinal >= regla.umbralMedio
          ? 'MEDIO'
          : 'BAJO';

    return {
      scoreDocumental: redondear(scoreDocumental),
      scoreVisual: redondear(scoreVisual),
      scoreAnomalia: redondear(scoreAnomalia),
      scoreFinal: bloqueo ? 0 : scoreFinal,
      nivel,
      datosExtraidos: {
        // En v1 los campos los captura el operador. Con AIni la fuente sera
        // "ocr" y se podran contrastar ambas lecturas (RF-IA-03).
        fuente: 'declarado',
        tipo: entrada.comprobante.tipo,
        rucEmisor: entrada.comprobante.rucEmisor,
        serie: entrada.comprobante.serie,
        numero: entrada.comprobante.numero,
        fechaEmision: entrada.comprobante.fechaEmision,
        subtotal: entrada.comprobante.subtotal,
        igv: entrada.comprobante.igv,
        total: entrada.comprobante.total,
      },
      explicacion: { motivos, resumen: this.redactarResumen(nivel, motivos, bloqueo) },
      alertas,
      narrativaBorrador: null,
      versionModelo: this.version,
      duracionMs: Date.now() - inicio,
    };
  }

  // ---------------------------------------------------------------------
  // Bloqueos duros: hechos objetivos que no admiten compensacion.
  // ---------------------------------------------------------------------

  private evaluarBloqueos(
    entrada: EntradaAnalisis,
    motivos: MotivoAnalisis[],
    alertas: AlertaAnalisis[],
  ): boolean {
    let bloqueado = false;

    if (entrada.declarado.montoDeclarado > entrada.contexto.saldoRetenido) {
      bloqueado = true;
      motivos.push({
        regla: 'bloqueo.saldo_insuficiente',
        senal: 'documental',
        resultado: 'falla',
        mensaje:
          `El gasto declara S/ ${entrada.declarado.montoDeclarado.toFixed(2)} pero el fondo ` +
          `solo tiene S/ ${entrada.contexto.saldoRetenido.toFixed(2)} retenidos.`,
        valor: entrada.declarado.montoDeclarado,
        penalizacion: 100,
      });
      alertas.push({
        tipo: 'SALDO_INSUFICIENTE',
        severidad: 'ALTA',
        titulo: 'El gasto excede el saldo retenido del fondo',
        descripcion:
          'No se puede ejecutar un gasto mayor que lo efectivamente recaudado y retenido ' +
          'para ese destino.',
      });
    }

    const duplicada = entrada.evidencias.find(
      (e) => e.hashPerceptual !== null && e.distanciaMinimaHistorico !== undefined
        ? e.distanciaMinimaHistorico < UMBRAL_DUPLICADO_PERCEPTUAL
        : false,
    );
    if (duplicada) {
      bloqueado = true;
      motivos.push({
        regla: 'bloqueo.evidencia_reutilizada',
        senal: 'visual',
        resultado: 'falla',
        mensaje:
          'La evidencia coincide con una imagen ya presentada en otro gasto, aunque se haya ' +
          'recortado o vuelto a guardar.',
        valor: duplicada.distanciaMinimaHistorico ?? null,
        penalizacion: 100,
      });
      alertas.push({
        tipo: 'EVIDENCIA_REUTILIZADA',
        severidad: 'ALTA',
        titulo: 'Evidencia reutilizada',
        descripcion: 'La imagen ya se uso como evidencia de otro gasto.',
      });
    }

    return bloqueado;
  }

  // ---------------------------------------------------------------------
  // Señal documental: lo que se puede afirmar del comprobante sin leerlo.
  // ---------------------------------------------------------------------

  private async evaluarDocumental(
    entrada: EntradaAnalisis,
    motivos: MotivoAnalisis[],
  ): Promise<number> {
    const c = entrada.comprobante;
    let score = 100;

    const ruc = validarRuc(c.rucEmisor);
    if (ruc.valido) {
      motivos.push({
        regla: 'doc.ruc_modulo11',
        senal: 'documental',
        resultado: 'ok',
        mensaje: `El RUC del emisor es valido (${ruc.tipoContribuyente}).`,
        valor: c.rucEmisor,
        penalizacion: 0,
      });
    } else {
      score -= 40;
      motivos.push({
        regla: 'doc.ruc_modulo11',
        senal: 'documental',
        resultado: 'falla',
        mensaje: ruc.motivo ?? 'El RUC del emisor no es valido.',
        valor: c.rucEmisor,
        penalizacion: 40,
      });
    }

    const serie = validarSerieNumero(c.tipo, c.serie, c.numero);
    if (!serie.valido) {
      score -= 15;
      motivos.push({
        regla: 'doc.formato_serie',
        senal: 'documental',
        resultado: 'falla',
        mensaje: serie.motivo ?? 'La serie o el numero no tienen formato valido.',
        valor: `${c.serie}-${c.numero}`,
        penalizacion: 15,
      });
    } else if (!serie.electronico) {
      // Un comprobante fisico es legitimo pero menos verificable que uno
      // electronico: baja un poco la confianza, no la destruye.
      score -= 5;
      motivos.push({
        regla: 'doc.comprobante_fisico',
        senal: 'documental',
        resultado: 'advertencia',
        mensaje:
          'El comprobante parece fisico y no electronico, lo que dificulta su verificacion.',
        valor: c.serie,
        penalizacion: 5,
      });
    }

    const desglose = FakeSunatService.verificarDesglose(c.subtotal, c.igv, c.total);
    if (!desglose.sumaCorrecta) {
      score -= 25;
      motivos.push({
        regla: 'doc.suma_comprobante',
        senal: 'documental',
        resultado: 'falla',
        mensaje: `Subtotal mas IGV (${(c.subtotal + c.igv).toFixed(2)}) no coincide con el total declarado (${c.total.toFixed(2)}).`,
        valor: c.total,
        penalizacion: 25,
      });
    } else if (!desglose.igvCorrecto) {
      score -= 10;
      motivos.push({
        regla: 'doc.igv_18',
        senal: 'documental',
        resultado: 'advertencia',
        mensaje: `El IGV declarado (${c.igv.toFixed(2)}) no corresponde al 18 % del subtotal (${desglose.igvEsperado.toFixed(2)}).`,
        valor: c.igv,
        penalizacion: 10,
      });
    }

    if (Math.abs(c.total - entrada.declarado.montoDeclarado) > 0.02) {
      score -= 20;
      motivos.push({
        regla: 'doc.total_vs_declarado',
        senal: 'documental',
        resultado: 'falla',
        mensaje: `El total del comprobante (${c.total.toFixed(2)}) no coincide con el monto declarado del gasto (${entrada.declarado.montoDeclarado.toFixed(2)}).`,
        valor: c.total,
        penalizacion: 20,
      });
    }

    const emision = new Date(c.fechaEmision);
    const gasto = new Date(entrada.declarado.fechaGasto);
    const diasDesfase = Math.round((gasto.getTime() - emision.getTime()) / 86_400_000);

    if (diasDesfase < 0) {
      score -= 20;
      motivos.push({
        regla: 'doc.fecha_posterior',
        senal: 'documental',
        resultado: 'falla',
        mensaje: 'El comprobante fue emitido despues de la fecha declarada del gasto.',
        valor: diasDesfase,
        penalizacion: 20,
      });
    } else if (diasDesfase > 30) {
      score -= 10;
      motivos.push({
        regla: 'doc.comprobante_antiguo',
        senal: 'documental',
        resultado: 'advertencia',
        mensaje: `El comprobante tiene ${diasDesfase} dias de antiguedad respecto del gasto.`,
        valor: diasDesfase,
        penalizacion: 10,
      });
    }

    const resultadoCpe = await this.cpe.consultar({
      tipo: c.tipo,
      rucEmisor: c.rucEmisor,
      serie: c.serie,
      numero: c.numero,
      fechaEmision: emision,
      total: c.total,
    });

    motivos.push({
      regla: 'doc.validez_cpe',
      senal: 'documental',
      resultado: resultadoCpe.dictamen === 'VALIDO' ? 'ok' : 'advertencia',
      mensaje:
        resultadoCpe.fuente === 'formato'
          ? `Validacion por formato: ${resultadoCpe.observaciones[0]}`
          : `Consulta a la SUNAT: ${resultadoCpe.dictamen}.`,
      valor: resultadoCpe.dictamen,
      penalizacion: 0,
    });

    return Math.max(0, score);
  }

  // ---------------------------------------------------------------------
  // Señal visual: calidad y novedad de la evidencia, sin reconocer escenas.
  // ---------------------------------------------------------------------

  private evaluarVisual(entrada: EntradaAnalisis, motivos: MotivoAnalisis[]): number {
    const fotos = entrada.evidencias.filter((e) => e.tipo === 'FOTO');

    if (fotos.length === 0) {
      // Sin fotos que evaluar, la señal se omite en lugar de penalizar: un
      // gasto respaldado con video no es sospechoso por serlo.
      motivos.push({
        regla: 'vis.sin_fotos',
        senal: 'visual',
        resultado: 'advertencia',
        mensaje: 'No hay fotografias que analizar; la evidencia se revisara manualmente.',
        penalizacion: 0,
      });
      return 60;
    }

    let score = 100;

    const borrosas = fotos.filter((f) => f.nitidez !== null && f.nitidez < NITIDEZ_MINIMA);
    if (borrosas.length > 0) {
      const penalizacion = Math.min(30, borrosas.length * 15);
      score -= penalizacion;
      motivos.push({
        regla: 'vis.nitidez',
        senal: 'visual',
        resultado: 'advertencia',
        mensaje: `${borrosas.length} de ${fotos.length} fotos estan por debajo del umbral de nitidez.`,
        valor: borrosas[0].nitidez,
        penalizacion,
      });
    }

    const pequenas = fotos.filter((f) => (f.ancho ?? 0) < 640 || (f.alto ?? 0) < 480);
    if (pequenas.length > 0) {
      score -= 10;
      motivos.push({
        regla: 'vis.resolucion',
        senal: 'visual',
        resultado: 'advertencia',
        mensaje: 'Alguna evidencia tiene resolucion baja y puede no mostrar el detalle necesario.',
        valor: `${pequenas[0].ancho}x${pequenas[0].alto}`,
        penalizacion: 10,
      });
    }

    // Novedad perceptual: cuanto mas lejos del historico, mejor.
    const distancias = fotos
      .map((f) => f.distanciaMinimaHistorico)
      .filter((d): d is number => typeof d === 'number');

    if (distancias.length > 0) {
      const minima = Math.min(...distancias);
      if (minima < UMBRAL_DUPLICADO_PERCEPTUAL * 2) {
        score -= 20;
        motivos.push({
          regla: 'vis.similitud_historico',
          senal: 'visual',
          resultado: 'advertencia',
          mensaje: `La evidencia se parece a otra ya presentada (distancia ${minima} de 64 bits).`,
          valor: minima,
          penalizacion: 20,
        });
      } else {
        motivos.push({
          regla: 'vis.similitud_historico',
          senal: 'visual',
          resultado: 'ok',
          mensaje: 'La evidencia no se parece a ninguna presentada antes.',
          valor: minima,
          penalizacion: 0,
        });
      }
    }

    // Frescura del EXIF respecto de la fecha del gasto.
    const conExif = fotos.filter((f) => f.exifCapturadoEn !== null);
    if (conExif.length > 0) {
      const fechaGasto = new Date(entrada.declarado.fechaGasto).getTime();
      const dias = Math.abs(
        Math.round((new Date(conExif[0].exifCapturadoEn!).getTime() - fechaGasto) / 86_400_000),
      );

      if (dias > 15) {
        score -= 15;
        motivos.push({
          regla: 'vis.exif_desfasado',
          senal: 'visual',
          resultado: 'advertencia',
          mensaje: `La foto fue tomada ${dias} dias antes o despues de la fecha del gasto.`,
          valor: dias,
          penalizacion: 15,
        });
      } else {
        motivos.push({
          regla: 'vis.exif_coherente',
          senal: 'visual',
          resultado: 'ok',
          mensaje: 'La fecha de captura de la foto es coherente con la del gasto.',
          valor: dias,
          penalizacion: 0,
        });
      }
    }

    return Math.max(0, score);
  }

  // ---------------------------------------------------------------------
  // Señal de anomalia: estadistica simple sobre el historial de la ONG.
  // ---------------------------------------------------------------------

  private evaluarAnomalia(
    entrada: EntradaAnalisis,
    motivos: MotivoAnalisis[],
    alertas: AlertaAnalisis[],
  ): number {
    const { contexto, declarado } = entrada;
    let score = 100;

    const { mediaHistoricaCategoria: media, desviacionHistoricaCategoria: desviacion } = contexto;

    if (media !== null && desviacion !== null && desviacion > 0) {
      const z = Math.abs(declarado.montoDeclarado - media) / desviacion;

      if (z > 3) {
        score -= 30;
        motivos.push({
          regla: 'ano.monto_atipico',
          senal: 'anomalia',
          resultado: 'falla',
          mensaje: `El monto se aparta ${z.toFixed(1)} desviaciones del promedio historico de la categoria (S/ ${media.toFixed(2)}).`,
          valor: redondear(z),
          penalizacion: 30,
        });
        alertas.push({
          tipo: 'MONTO_ATIPICO',
          severidad: 'MEDIA',
          titulo: 'Monto muy alejado del historico',
          descripcion: `El gasto es inusual para la categoria ${declarado.categoriaGasto}.`,
        });
      } else if (z > 2) {
        score -= 15;
        motivos.push({
          regla: 'ano.monto_atipico',
          senal: 'anomalia',
          resultado: 'advertencia',
          mensaje: `El monto se aparta ${z.toFixed(1)} desviaciones del promedio historico de la categoria.`,
          valor: redondear(z),
          penalizacion: 15,
        });
      } else {
        motivos.push({
          regla: 'ano.monto_tipico',
          senal: 'anomalia',
          resultado: 'ok',
          mensaje: 'El monto esta dentro de lo habitual para esta categoria.',
          valor: redondear(z),
          penalizacion: 0,
        });
      }
    } else {
      // Sin historial no hay anomalia que medir. Penalizar aqui castigaria a
      // toda ONG nueva por el solo hecho de serlo.
      motivos.push({
        regla: 'ano.sin_historial',
        senal: 'anomalia',
        resultado: 'advertencia',
        mensaje: 'Aun no hay suficiente historial en esta categoria para comparar el monto.',
        penalizacion: 0,
      });
    }

    if (!contexto.proveedorConocido) {
      score -= 10;
      motivos.push({
        regla: 'ano.proveedor_nuevo',
        senal: 'anomalia',
        resultado: 'advertencia',
        mensaje: `Es la primera vez que esta organizacion registra un gasto con ${declarado.proveedorNombre}.`,
        valor: declarado.proveedorNombre,
        penalizacion: 10,
      });
    }

    // Fraccionamiento: muchos gastos seguidos de la misma categoria pueden
    // ser una forma de esquivar un umbral de revision.
    if (contexto.gastosRecientesMismaCategoria >= 5) {
      score -= 20;
      motivos.push({
        regla: 'ano.fraccionamiento',
        senal: 'anomalia',
        resultado: 'advertencia',
        mensaje: `Se registraron ${contexto.gastosRecientesMismaCategoria} gastos de esta categoria en los ultimos dias.`,
        valor: contexto.gastosRecientesMismaCategoria,
        penalizacion: 20,
      });
      alertas.push({
        tipo: 'POSIBLE_FRACCIONAMIENTO',
        severidad: 'MEDIA',
        titulo: 'Varios gastos seguidos de la misma categoria',
        descripcion:
          'Conviene revisar si corresponden a compras independientes o a un mismo gasto dividido.',
      });
    }

    const registro = new Date(declarado.fechaGasto);
    const captura = declarado.capturadoEn ? new Date(declarado.capturadoEn) : null;
    if (captura) {
      const dias = Math.round((captura.getTime() - registro.getTime()) / 86_400_000);
      if (dias > 30) {
        score -= 10;
        motivos.push({
          regla: 'ano.registro_tardio',
          senal: 'anomalia',
          resultado: 'advertencia',
          mensaje: `El gasto se capturo ${dias} dias despues de la fecha declarada.`,
          valor: dias,
          penalizacion: 10,
        });
      }
    }

    return Math.max(0, score);
  }

  /** Frase unica que la ONG ve en la app, antes del detalle. */
  private redactarResumen(
    nivel: NivelConfianza,
    motivos: MotivoAnalisis[],
    bloqueado: boolean,
  ): string {
    const fallas = motivos.filter((m) => m.resultado === 'falla');
    const advertencias = motivos.filter((m) => m.resultado === 'advertencia');

    if (bloqueado) {
      return `Gasto bloqueado: ${fallas[0]?.mensaje ?? 'se detecto una inconsistencia grave.'}`;
    }
    if (nivel === 'ALTO') {
      return 'El comprobante y la evidencia son coherentes. El gasto se aprueba automaticamente.';
    }
    if (nivel === 'MEDIO') {
      const razon = fallas[0]?.mensaje ?? advertencias[0]?.mensaje ?? 'hay datos por confirmar';
      return `Pasa a revision de un auditor: ${razon}`;
    }
    return `Se observaron inconsistencias que la organizacion debe subsanar: ${
      fallas[0]?.mensaje ?? advertencias[0]?.mensaje ?? 'revise el detalle.'
    }`;
  }
}

function redondear(valor: number): number {
  return Math.round(valor * 100) / 100;
}
