import { z } from 'zod';

import { validarRuc } from '../verificacion/reglas/ruc';

/**
 * El RUC se valida por modulo 11 aqui mismo, en el borde de la API.
 *
 * Rechazar un RUC invalido al registrar la ONG es mucho mas barato que
 * descubrirlo cuando un auditor revisa el expediente, y el mensaje explica
 * que corregir en lugar de limitarse a negar.
 */
const ruc = z
  .string()
  .trim()
  .superRefine((valor, ctx) => {
    const r = validarRuc(valor);
    if (!r.valido) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.motivo ?? 'RUC invalido.' });
    }
  });

export const esquemaRegistrarOng = z.object({
  ruc,
  razonSocial: z.string().trim().min(3, 'Indique la razon social de la organizacion.').max(200),
  nombreComercial: z.string().trim().max(200).optional(),
  representanteLegal: z.string().trim().min(3, 'Indique el representante legal.').max(200),
  documentoRepresentante: z
    .string()
    .trim()
    .regex(/^\d{8}$|^\d{9,12}$/, 'Ingrese el DNI (8 digitos) o carne de extranjeria.'),
  direccion: z.string().trim().min(5, 'Indique la direccion fiscal.').max(300),
  departamento: z.string().trim().min(3).max(100),
  provincia: z.string().trim().max(100).optional(),
  distrito: z.string().trim().max(100).optional(),
  correoContacto: z.string().trim().toLowerCase().email('Ingrese un correo de contacto valido.'),
  telefono: z
    .string()
    .trim()
    .regex(/^9\d{8}$|^\d{6,9}$/, 'Ingrese un telefono valido.')
    .optional(),
  sitioWeb: z.string().trim().url('El sitio web debe ser una URL completa.').optional(),
  descripcion: z.string().trim().min(30, 'Describa la labor de la organizacion.').max(2000),
  cuentaRecaudacion: z.string().trim().max(50).optional(),
  banco: z.string().trim().max(60).optional(),
  /** RF-DE-05: sin aceptar los terminos, la ONG no puede recaudar. */
  aceptaTerminos: z.literal(true, {
    errorMap: () => ({
      message:
        'Debe aceptar los terminos de adhesion, que obligan a justificar cada sol recibido.',
    }),
  }),
  versionTerminos: z.string().default('1.0'),
});
export type RegistrarOng = z.infer<typeof esquemaRegistrarOng>;

export const esquemaVerificarOng = z.object({
  decision: z.enum(['VERIFICADA', 'RECHAZADA', 'SUSPENDIDA']),
  motivo: z
    .string()
    .trim()
    .min(10, 'Explique el motivo de la decision: la ONG necesita saber que corregir.')
    .max(2000),
});
export type VerificarOng = z.infer<typeof esquemaVerificarOng>;

export const esquemaCrearCampana = z.object({
  titulo: z.string().trim().min(5, 'El titulo debe explicar la causa.').max(200),
  descripcion: z
    .string()
    .trim()
    .min(50, 'Describa la causa con al menos 50 caracteres para que el donante entienda.')
    .max(4000),
  causa: z.string().trim().min(3).max(100),
  imagenUrl: z.string().trim().url().optional(),
  departamento: z.string().trim().max(100).optional(),
  fechaInicio: z.coerce.date(),
  fechaFin: z.coerce.date().optional(),
});
export type CrearCampana = z.infer<typeof esquemaCrearCampana>;

export const esquemaActualizarCampana = esquemaCrearCampana.partial().extend({
  estado: z.enum(['BORRADOR', 'ACTIVA', 'PAUSADA', 'CERRADA']).optional(),
});
export type ActualizarCampana = z.infer<typeof esquemaActualizarCampana>;

export const esquemaCrearFondo = z.object({
  nombre: z.string().trim().min(3, 'El fondo necesita un nombre que diga su destino.').max(150),
  descripcion: z.string().trim().max(1000).optional(),
  categoriaGasto: z.enum([
    'ALIMENTOS',
    'ATENCION_VETERINARIA',
    'MEDICAMENTOS',
    'INSUMOS',
    'TRANSPORTE',
    'INFRAESTRUCTURA',
    'ESTERILIZACION',
    'OTROS',
  ]),
  meta: z.coerce
    .number()
    .positive('La meta debe ser mayor que cero.')
    .max(9_999_999_999, 'La meta excede el maximo permitido.'),
});
export type CrearFondo = z.infer<typeof esquemaCrearFondo>;

export const esquemaBuscarCausas = z.object({
  /** Texto libre; se busca con full-text search en español. */
  q: z.string().trim().max(200).optional(),
  causa: z.string().trim().max(100).optional(),
  departamento: z.string().trim().max(100).optional(),
  ongId: z.string().uuid().optional(),
  /** Puntaje minimo de confianza de la ONG. */
  puntajeMinimo: z.coerce.number().min(0).max(100).optional(),
  /** Avance minimo de la meta, en porcentaje. */
  avanceMinimo: z.coerce.number().min(0).max(100).optional(),
  orden: z.enum(['relevancia', 'recientes', 'avance', 'confianza']).default('relevancia'),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(50).default(12),
});
export type BuscarCausas = z.infer<typeof esquemaBuscarCausas>;
