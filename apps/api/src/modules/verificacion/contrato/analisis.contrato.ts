/**
 * Contrato de datos del analisis de evidencias.
 *
 * Es la transcripcion literal del "Contrato de datos de AIni (MVP)" de la
 * seccion 7.4 del Entregable 2. Se escribe una sola vez y lo comparten las
 * dos implementaciones de MotorVerificacion:
 *
 *   MotorReglasV0  - esta version, determinista, sin IA
 *   MotorAIni      - sesion futura, cliente del servicio FastAPI
 *
 * Nada fuera de este archivo debe conocer cual de las dos esta activa. Ese
 * es todo el punto: cambiar de motor no puede obligar a tocar el core
 * contable, la base de datos ni el frontend.
 */

export type NivelConfianza = 'ALTO' | 'MEDIO' | 'BAJO';

/** De donde salio cada campo del comprobante. */
export type FuenteDatos = 'declarado' | 'ocr';

/** Lo que el backend envia al motor. */
export interface EntradaAnalisis {
  gastoId: string;

  /** Metadato declarado por la ONG al registrar el gasto. */
  declarado: {
    fondoId: string;
    categoriaGasto: string;
    montoDeclarado: number;
    concepto: string;
    proveedorNombre: string;
    proveedorRuc: string | null;
    fechaGasto: string;
    /**
     * Hora original de captura en el dispositivo. Distinta de la fecha
     * declarada del gasto: permite distinguir un registro tardio de una
     * sincronizacion tardia por falta de conexion (RNF-16).
     */
    capturadoEn: string | null;
  };

  /** Datos del comprobante y su archivo. */
  comprobante: {
    tipo: string;
    rucEmisor: string;
    serie: string;
    numero: string;
    fechaEmision: string;
    subtotal: number;
    igv: number;
    total: number;
    moneda: string;
    hashSha256: string;
    /** URL firmada con expiracion; AIni la usara para descargar el archivo. */
    archivoUrl: string;
  };

  /** Evidencias visuales asociadas al gasto. */
  evidencias: Array<{
    id: string;
    tipo: string;
    hashSha256: string;
    hashPerceptual: string | null;
    nitidez: number | null;
    ancho: number | null;
    alto: number | null;
    exifCapturadoEn: string | null;
    /**
     * Distancia de Hamming minima frente a todo el historico de evidencias.
     *
     * La calcula el backend, que tiene acceso al historico, y no el motor.
     * Asi la señal esta disponible igual para el motor de reglas y para
     * AIni, sin que ninguno de los dos tenga que consultar la base.
     */
    distanciaMinimaHistorico?: number;
    contienePersonas: boolean;
    anonimizada: boolean;
    archivoUrl: string;
  }>;

  /** Contexto del fondo, necesario para las señales de anomalia. */
  contexto: {
    saldoRetenido: number;
    /** Media y desviacion historicas de la categoria, si hay datos. */
    mediaHistoricaCategoria: number | null;
    desviacionHistoricaCategoria: number | null;
    /** El proveedor ya fue usado antes por esta ONG. */
    proveedorConocido: boolean;
    /** Gastos de la ONG en la ventana de fraccionamiento. */
    gastosRecientesMismaCategoria: number;
  };

  /** Regla de umbrales vigente al momento del analisis (RN-06). */
  regla: ReglaUmbrales;
}

export interface ReglaUmbrales {
  id: string;
  umbralAlto: number;
  umbralMedio: number;
  pesoDocumental: number;
  pesoVisual: number;
  pesoAnomalia: number;
}

/**
 * Un motivo del puntaje, legible por una persona.
 *
 * RNF-09 exige que toda decision sea explicable, y RF-IA-08 que la
 * explicacion sea legible. Por eso no basta con guardar el numero: cada
 * regla reporta que evaluo, como salio y con que valor.
 */
export type MotivoAnalisis = {
  /** Identificador estable de la regla, p. ej. "doc.ruc_modulo11". */
  regla: string;
  senal: 'documental' | 'visual' | 'anomalia';
  resultado: 'ok' | 'advertencia' | 'falla';
  /** Redactado para que lo entienda la ONG, no solo un desarrollador. */
  mensaje: string;
  /** Valor que disparo la regla, para poder auditar el motivo. */
  valor?: string | number | null;
  /** Puntos que esta regla resto al puntaje de su señal. */
  penalizacion: number;
};

export type AlertaAnalisis = {
  tipo: string;
  severidad: 'ALTA' | 'MEDIA' | 'BAJA';
  titulo: string;
  descripcion: string;
};

/** Lo que el motor devuelve. Se persiste integro en analisis_aini. */
export interface ResultadoAnalisis {
  scoreDocumental: number;
  scoreVisual: number;
  scoreAnomalia: number;
  scoreFinal: number;
  nivel: NivelConfianza;

  /**
   * Campos del comprobante con su procedencia. En v1 la fuente es
   * "declarado" porque los captura el operador; con AIni sera "ocr".
   */
  datosExtraidos: {
    fuente: FuenteDatos;
    tipo: string;
    rucEmisor: string;
    serie: string;
    numero: string;
    fechaEmision: string;
    subtotal: number;
    igv: number;
    total: number;
  };

  explicacion: {
    motivos: MotivoAnalisis[];
    /** Resumen en una frase, el que ve la ONG en la app. */
    resumen: string;
  };

  alertas: AlertaAnalisis[];

  /** Borrador de narrativa; el Motor de Retorno decide si lo usa. */
  narrativaBorrador: string | null;

  /** Nombre y version del motor, para trazar la decision. */
  versionModelo: string;

  duracionMs: number;
}
