import { z } from 'zod';

export const esquemaActualizarConsentimiento = z.object({
  finalidad: z.enum(['TRATAMIENTO_DATOS', 'COMUNICACIONES', 'USO_IMAGEN']),
  otorgado: z.boolean(),
  versionPolitica: z.string().default('1.0'),
});
export type ActualizarConsentimiento = z.infer<typeof esquemaActualizarConsentimiento>;

export const esquemaCrearArco = z.object({
  tipo: z.enum(['ACCESO', 'RECTIFICACION', 'CANCELACION', 'OPOSICION']),
  detalle: z
    .string()
    .trim()
    .min(10, 'Describa su solicitud con al menos 10 caracteres para poder atenderla.')
    .max(2000),
});
export type CrearArco = z.infer<typeof esquemaCrearArco>;

export const esquemaResponderArco = z.object({
  estado: z.enum(['EN_PROCESO', 'ATENDIDA', 'RECHAZADA']),
  respuesta: z
    .string()
    .trim()
    .min(10, 'La respuesta debe explicar que se hizo con la solicitud.')
    .max(4000),
});
export type ResponderArco = z.infer<typeof esquemaResponderArco>;
