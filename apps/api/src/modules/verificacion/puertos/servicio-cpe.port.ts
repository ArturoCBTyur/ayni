/**
 * Consulta de validez de comprobantes de pago electronicos (RF-DE-03).
 *
 * La SUNAT expone un servicio de consulta que requiere credenciales SOL que
 * el equipo todavia no tiene. Mientras tanto, FakeSunat responde con lo que
 * si se puede determinar sin red: el digito verificador del RUC, el formato
 * de serie y numero, y la coherencia aritmetica del comprobante.
 *
 * La distincion importa y el codigo la hace explicita: `VALIDO` de FakeSunat
 * significa "bien formado", no "existe y fue emitido". Por eso el motor lo
 * trata como una señal mas y no como prueba, y por eso el resultado incluye
 * `fuente`, para que un auditor sepa de donde salio el dictamen.
 */
export type DictamenCpe = 'VALIDO' | 'INVALIDO' | 'NO_DISPONIBLE';

export interface ConsultaCpe {
  tipo: string;
  rucEmisor: string;
  serie: string;
  numero: string;
  fechaEmision: Date;
  total: number;
}

export interface ResultadoCpe {
  dictamen: DictamenCpe;
  /** De donde viene el dictamen: importa para saber cuanto pesa. */
  fuente: 'formato' | 'sunat';
  /** Motivos legibles del dictamen. */
  observaciones: string[];
  /**
   * Lo que la fuente pudo confirmar. Con FakeSunat nunca incluye la
   * existencia del comprobante, porque eso solo lo sabe la SUNAT.
   */
  confirmado: {
    rucBienFormado: boolean;
    serieBienFormada: boolean;
    aritmeticaCoherente: boolean;
    fechaCoherente: boolean;
    existeEnSunat: boolean | null;
  };
}

export interface ServicioCpe {
  readonly nombre: string;
  consultar(datos: ConsultaCpe): Promise<ResultadoCpe>;
}

export const SERVICIO_CPE = Symbol('SERVICIO_CPE');
