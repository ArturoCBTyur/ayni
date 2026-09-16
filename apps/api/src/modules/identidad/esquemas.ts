import { z } from 'zod';

/**
 * Contratos de entrada del modulo de identidad.
 *
 * Los mensajes estan redactados para mostrarse tal cual en la interfaz
 * (RF-PS-05: explicar que ocurrio y como resolverlo), no para un log.
 */

const correo = z
  .string()
  .trim()
  .toLowerCase()
  .email('Ingrese un correo valido, por ejemplo nombre@dominio.pe');

/**
 * Politica de contraseña.
 *
 * Longitud minima de 12 con variedad de caracteres. Se prefiere longitud
 * sobre reglas rebuscadas: una frase larga resiste mas que ocho caracteres
 * con simbolos, y es mas facil de recordar para un voluntario de ONG que
 * entra desde el celular.
 */
const clave = z
  .string()
  .min(12, 'La contraseña debe tener al menos 12 caracteres.')
  .max(128, 'La contraseña no puede superar los 128 caracteres.')
  .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v), {
    message: 'Incluya al menos una letra minuscula y una mayuscula.',
  })
  .refine((v) => /\d/.test(v), { message: 'Incluya al menos un numero.' });

/** Finalidades de consentimiento que el registro puede otorgar (RF-DE-01). */
export const esquemaConsentimientos = z.object({
  /**
   * Obligatorio: sin tratamiento de datos no hay cuenta posible. Se pide
   * explicito y no por defecto, porque un consentimiento premarcado no es
   * consentimiento.
   */
  tratamientoDatos: z.literal(true, {
    errorMap: () => ({
      message: 'Para crear una cuenta debe aceptar el tratamiento de sus datos personales.',
    }),
  }),
  /** Opcional: sin este, el donante no recibe narrativas de impacto. */
  comunicaciones: z.boolean().default(false),
  /** Solo relevante para quien sube evidencias. */
  usoImagen: z.boolean().default(false),
});

export const esquemaRegistro = z.object({
  correo,
  clave,
  nombres: z.string().trim().min(2, 'Indique sus nombres.').max(120),
  apellidos: z.string().trim().min(2, 'Indique sus apellidos.').max(120),
  telefono: z
    .string()
    .trim()
    .regex(/^9\d{8}$/, 'El celular peruano tiene 9 digitos y empieza con 9.')
    .optional(),
  consentimientos: esquemaConsentimientos,
  versionPolitica: z.string().default('1.0'),
});
export type Registro = z.infer<typeof esquemaRegistro>;

export const esquemaLogin = z.object({
  correo,
  clave: z.string().min(1, 'Ingrese su contraseña.'),
  /** Codigo TOTP de 6 digitos, exigido a ONG, auditor y admin (RNF-02). */
  codigoTotp: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'El codigo de verificacion tiene 6 digitos.')
    .optional(),
});
export type Login = z.infer<typeof esquemaLogin>;

export const esquemaConfirmarTotp = z.object({
  codigoTotp: z.string().trim().regex(/^\d{6}$/, 'El codigo de verificacion tiene 6 digitos.'),
});
export type ConfirmarTotp = z.infer<typeof esquemaConfirmarTotp>;

export const esquemaActualizarConsentimiento = z.object({
  finalidad: z.enum(['TRATAMIENTO_DATOS', 'COMUNICACIONES', 'USO_IMAGEN']),
  otorgado: z.boolean(),
  versionPolitica: z.string().default('1.0'),
});
export type ActualizarConsentimiento = z.infer<typeof esquemaActualizarConsentimiento>;

export const esquemaSolicitudArco = z.object({
  tipo: z.enum(['ACCESO', 'RECTIFICACION', 'CANCELACION', 'OPOSICION']),
  detalle: z
    .string()
    .trim()
    .min(10, 'Describa su solicitud con al menos 10 caracteres para poder atenderla.')
    .max(2000),
});
export type SolicitudArcoEntrada = z.infer<typeof esquemaSolicitudArco>;
