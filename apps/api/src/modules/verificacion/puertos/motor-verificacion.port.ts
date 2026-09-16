import type { EntradaAnalisis, ResultadoAnalisis } from '../contrato/analisis.contrato';

/**
 * El seam de AIni.
 *
 * Toda la verificacion del sistema pasa por aqui. Es el unico punto que la
 * sesion de incorporacion de IA tendra que tocar: se agrega MotorAIni, se
 * registra bajo el mismo token y se conmuta con VERIFICACION_DRIVER.
 */
export interface MotorVerificacion {
  /** Nombre y version que quedan en analisis_aini.version_modelo. */
  readonly version: string;

  analizar(entrada: EntradaAnalisis): Promise<ResultadoAnalisis>;
}

export const MOTOR_VERIFICACION = Symbol('MOTOR_VERIFICACION');
