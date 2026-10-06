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

// ---------------------------------------------------------------------------
// RF-16 · Administracion de usuarios
// ---------------------------------------------------------------------------

/** Los cinco roles del catalogo (seed.ts). */
export const CODIGOS_ROL = ['DONANTE', 'ONG_ADMIN', 'ONG_OPERADOR', 'AUDITOR', 'ADMIN'] as const;
export type CodigoRol = (typeof CODIGOS_ROL)[number];

/**
 * Motivo de una accion administrativa sobre una cuenta.
 *
 * Obligatorio siempre, como al verificar una ONG: bloquear a alguien o darle
 * el rol de auditor sin dejar dicho por que es exactamente lo que una
 * bitacora existe para impedir.
 */
const motivoAdministrativo = z
  .string()
  .trim()
  .min(10, 'Explique el motivo con al menos 10 caracteres: queda en la bitacora.')
  .max(500, 'El motivo no puede superar los 500 caracteres.');

export const esquemaFiltroUsuarios = z.object({
  q: z.string().trim().max(120).optional(),
  rol: z.enum(CODIGOS_ROL).optional(),
  estado: z.enum(['PENDIENTE_VERIFICACION', 'ACTIVO', 'BLOQUEADO']).optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(100).default(20),
});
export type FiltroUsuarios = z.infer<typeof esquemaFiltroUsuarios>;

export const esquemaCambiarRoles = z.object({
  roles: z
    .array(z.enum(CODIGOS_ROL))
    .min(1, 'Una cuenta necesita al menos un rol.')
    .transform((roles) => [...new Set(roles)]),
  motivo: motivoAdministrativo,
});
export type CambiarRoles = z.infer<typeof esquemaCambiarRoles>;

export const esquemaCambiarEstado = z.object({
  estado: z.enum(['ACTIVO', 'BLOQUEADO']),
  motivo: motivoAdministrativo,
});
export type CambiarEstado = z.infer<typeof esquemaCambiarEstado>;

export const esquemaMotivo = z.object({ motivo: motivoAdministrativo });
export type Motivo = z.infer<typeof esquemaMotivo>;
