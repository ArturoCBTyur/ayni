import { z } from 'zod';

/** Importe en soles con dos decimales exactos. */
const monto = z.coerce
  .number()
  .positive('El monto debe ser mayor que cero.')
  .max(999_999.99, 'El monto excede el maximo por transaccion.')
  .refine((v) => Number.isInteger(Math.round(v * 100)), {
    message: 'El monto no puede tener mas de dos decimales.',
  });

export const esquemaDonar = z.object({
  fondoId: z.string().uuid('Elija un fondo valido.'),
  monto,
  /** Token emitido por la pasarela. Nunca viaja un numero de tarjeta. */
  tokenTarjeta: z.string().trim().min(8, 'Falta el token de pago.').max(120),
  anonima: z.boolean().default(false),
  mensaje: z.string().trim().max(500).optional(),
});
export type Donar = z.infer<typeof esquemaDonar>;

export const esquemaSuscribir = z.object({
  fondoId: z.string().uuid('Elija un fondo valido.'),
  monto,
  tokenTarjeta: z.string().trim().min(8, 'Falta el token de pago.').max(120),
  /** Dia del mes para el cobro; se ajusta en meses cortos. */
  diaCobro: z.coerce.number().int().min(1).max(28).default(1),
  anonima: z.boolean().default(false),
});
export type Suscribir = z.infer<typeof esquemaSuscribir>;

export const esquemaCambiarSuscripcion = z.object({
  accion: z.enum(['PAUSAR', 'REANUDAR', 'CANCELAR']),
});
export type CambiarSuscripcion = z.infer<typeof esquemaCambiarSuscripcion>;

/**
 * Evento de webhook de la pasarela.
 *
 * Se valida con el mismo rigor que una entrada de usuario: un webhook llega
 * desde fuera y su firma prueba el origen, no que el contenido tenga sentido.
 */
export const esquemaEventoWebhook = z.object({
  eventoId: z.string().min(8).max(120),
  tipo: z.enum(['cargo.aprobado', 'cargo.rechazado', 'cargo.reversado']),
  referenciaExterna: z.string().min(4).max(120),
  referenciaInterna: z.string().uuid(),
  monto: z.coerce.number().positive(),
  comision: z.coerce.number().min(0),
  metodo: z.string().max(40).optional(),
  ultimos4: z.string().max(4).optional(),
  marca: z.string().max(40).optional(),
  motivoRechazo: z.string().max(300).optional(),
  creadoEn: z.string(),
});
export type EventoWebhookEntrada = z.infer<typeof esquemaEventoWebhook>;
