/**
 * Contrato de la pasarela de pago.
 *
 * El nucleo de donaciones no conoce a Culqi ni a Mercado Pago: conoce esta
 * interfaz. En el MVP la implementa FakeGateway, que no necesita cuenta de
 * comercio ni llaves, y cuando haya credenciales se agrega CulqiGateway
 * contra el mismo contrato sin tocar el core contable.
 *
 * RNF-04: la plataforma nunca recibe ni almacena datos de tarjeta. El cliente
 * tokeniza contra la pasarela y aqui solo viaja el token.
 */
export interface OrdenCobro {
  /** Identificador de la donacion en nuestra base. */
  referenciaInterna: string;
  monto: number;
  moneda: 'PEN';
  descripcion: string;
  /** Token emitido por la pasarela; nunca el numero de tarjeta. */
  tokenTarjeta: string;
  correoPagador: string;
}

export type EstadoCobro = 'APROBADO' | 'RECHAZADO' | 'PENDIENTE';

export interface ResultadoCobro {
  /** Identificador del cargo en la pasarela. */
  referenciaExterna: string;
  estado: EstadoCobro;
  comision: number;
  montoNeto: number;
  metodo?: string;
  /** Ultimos cuatro digitos, lo unico de la tarjeta que se puede guardar. */
  ultimos4?: string;
  marca?: string;
  motivoRechazo?: string;
}

/** Evento que la pasarela envia por webhook para confirmar el cobro. */
export interface EventoWebhook {
  /** Identificador del evento; sostiene la idempotencia. */
  eventoId: string;
  tipo: 'cargo.aprobado' | 'cargo.rechazado' | 'cargo.reversado';
  referenciaExterna: string;
  referenciaInterna: string;
  monto: number;
  comision: number;
  metodo?: string;
  ultimos4?: string;
  marca?: string;
  motivoRechazo?: string;
  creadoEn: string;
}

export interface PasarelaPago {
  readonly nombre: string;

  cobrar(orden: OrdenCobro): Promise<ResultadoCobro>;

  /**
   * Comprueba que el webhook venga realmente de la pasarela.
   *
   * Se verifica sobre el cuerpo crudo, no sobre el JSON ya parseado: volver a
   * serializar el objeto puede cambiar el orden de las claves o el formato de
   * los numeros, y la firma dejaria de coincidir por una razon que no tiene
   * nada que ver con su autenticidad.
   */
  verificarFirma(cuerpoCrudo: string, firma: string | undefined): boolean;

  /** Cancela una suscripcion recurrente en la pasarela. */
  cancelarSuscripcion(referenciaExterna: string): Promise<void>;

  /**
   * D2 · Devuelve al pagador parte de un cobro aprobado: el remanente de su
   * donacion cuando la causa cierra. Devuelve la referencia del reembolso.
   */
  reembolsar(referenciaExterna: string, monto: number): Promise<{ referencia: string }>;
}

export const PASARELA_PAGO = Symbol('PASARELA_PAGO');
