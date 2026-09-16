/**
 * Plan de cuentas minimo del modelo de retencion condicionada.
 *
 * La idea contable del proyecto es que el dinero donado no es ingreso de la
 * ONG mientras no se justifique: es una obligacion frente al donante y frente
 * a la causa. Por eso vive en cuentas de pasivo hasta que un gasto aprobado
 * lo libera, y solo entonces se reconoce como gasto ejecutado.
 *
 * Con cinco cuentas alcanza para el MVP. Un plan contable completo (PCGE)
 * excede lo que el piloto necesita y haria mas dificil leer el libro, que es
 * justamente lo que un auditor va a querer hacer.
 */
export const CUENTAS = {
  /** Efectivo recibido a traves de la pasarela. */
  CAJA: '10.1 Caja y bancos',
  /** Donaciones recibidas pendientes de asignar a un gasto. */
  POR_EJECUTAR: '20.1 Donaciones por ejecutar',
  /** Dinero condicionado: solo se libera contra gasto aprobado. */
  RETENIDO: '20.2 Fondos retenidos por justificar',
  /** Gasto reconocido cuando la evidencia se valida. */
  EJECUTADO: '60.1 Gastos ejecutados',
  /** Comision cobrada por la pasarela de pago (RN-02). */
  COMISION_PASARELA: '63.1 Comisiones de pasarela',
} as const;

/**
 * Asiento de cada tipo de movimiento: que cuenta se carga y cual se abona.
 *
 * Tenerlo en un solo lugar evita que dos modulos inventen asientos distintos
 * para el mismo hecho, que es como un libro deja de cuadrar sin que nadie lo
 * note hasta la conciliacion.
 */
export const ASIENTOS = {
  /** Entra el monto bruto de la donacion. */
  INGRESO: { debe: CUENTAS.CAJA, haber: CUENTAS.POR_EJECUTAR },
  /** La pasarela se queda su comision; reduce el efectivo disponible. */
  COMISION: { debe: CUENTAS.COMISION_PASARELA, haber: CUENTAS.CAJA },
  /** El neto pasa a estar condicionado a la evidencia. */
  RETENCION: { debe: CUENTAS.POR_EJECUTAR, haber: CUENTAS.RETENIDO },
  /** Un gasto aprobado libera la retencion y reconoce el gasto. */
  EJECUCION: { debe: CUENTAS.RETENIDO, haber: CUENTAS.EJECUTADO },
  /** Correccion de un movimiento anterior (RN-03: nunca se edita). */
  REVERSO: { debe: CUENTAS.EJECUTADO, haber: CUENTAS.RETENIDO },
  /** Traslado de saldo retenido a otro fondo con consentimiento del donante. */
  REASIGNACION: { debe: CUENTAS.RETENIDO, haber: CUENTAS.POR_EJECUTAR },
} as const;
