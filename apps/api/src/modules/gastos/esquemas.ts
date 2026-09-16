import { z } from 'zod';

import { validarRuc } from '../verificacion/reglas/ruc';

const monto = z.coerce
  .number()
  .positive('El monto debe ser mayor que cero.')
  .max(9_999_999.99)
  .refine((v) => Number.isInteger(Math.round(v * 100)), {
    message: 'El monto no puede tener mas de dos decimales.',
  });

export const esquemaUrlSubida = z.object({
  tipo: z.enum(['comprobante', 'evidencia']),
  /** Extension del archivo; define como se guarda y se sirve despues. */
  extension: z.enum(['jpg', 'jpeg', 'png', 'webp', 'pdf', 'mp4']),
});
export type UrlSubidaEntrada = z.infer<typeof esquemaUrlSubida>;

const esquemaComprobante = z.object({
  tipo: z.enum(['FACTURA', 'BOLETA', 'RECIBO_HONORARIOS', 'NOTA_VENTA']),
  rucEmisor: z
    .string()
    .trim()
    .superRefine((valor, ctx) => {
      const r = validarRuc(valor);
      if (!r.valido) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: r.motivo ?? 'RUC invalido.' });
      }
    }),
  razonSocialEmisor: z.string().trim().max(200).optional(),
  serie: z.string().trim().min(3).max(8),
  numero: z.string().trim().min(1).max(20),
  fechaEmision: z.coerce.date(),
  subtotal: monto,
  igv: z.coerce.number().min(0).max(9_999_999.99),
  total: monto,
  /** Objeto ya subido mediante URL firmada. */
  objeto: z.string().trim().min(3).max(300),
  mime: z.string().trim().max(100),
});

const esquemaEvidencia = z.object({
  tipo: z.enum(['FOTO', 'VIDEO']).default('FOTO'),
  objeto: z.string().trim().min(3).max(300),
  mime: z.string().trim().max(100),
  /**
   * RF-DE-04: declaracion obligatoria. Sin deteccion automatica de rostros,
   * esta respuesta es lo que activa la exigencia de anonimizar.
   */
  contienePersonas: z.boolean(),
  /** Consentimiento de uso de imagen cuando aparecen personas. */
  consentimientoImagen: z.boolean().default(false),
  latitud: z.coerce.number().min(-90).max(90).optional(),
  longitud: z.coerce.number().min(-180).max(180).optional(),
});

export const esquemaRegistrarGasto = z
  .object({
    fondoId: z.string().uuid('Elija un fondo valido.'),
    montoDeclarado: monto,
    concepto: z.string().trim().min(5, 'Describa en que se gasto.').max(300),
    proveedorNombre: z.string().trim().min(2, 'Indique el proveedor.').max(200),
    proveedorRuc: z.string().trim().length(11).optional(),
    fechaGasto: z.coerce.date(),
    /**
     * Hora original de captura en el dispositivo (RF-IN-03, RNF-16).
     *
     * Se envia desde la app y se conserva tal cual al sincronizar. Sin este
     * dato, un gasto capturado sin conexion y subido dias despues pareceria
     * registrado tarde, y el motor lo penalizaria por algo que no ocurrio.
     */
    capturadoEn: z.coerce.date().optional(),
    latitud: z.coerce.number().min(-90).max(90).optional(),
    longitud: z.coerce.number().min(-180).max(180).optional(),
    comprobante: esquemaComprobante,
    evidencias: z
      .array(esquemaEvidencia)
      .min(1, 'Adjunte al menos una evidencia visual del gasto.')
      .max(5, 'Puede adjuntar hasta 5 evidencias por gasto.'),
  })
  .superRefine((datos, ctx) => {
    if (datos.comprobante.fechaEmision > datos.fechaGasto) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['comprobante', 'fechaEmision'],
        message: 'El comprobante no puede emitirse despues de la fecha del gasto.',
      });
    }
    const personas = datos.evidencias.some((e) => e.contienePersonas);
    const consentimiento = datos.evidencias.every(
      (e) => !e.contienePersonas || e.consentimientoImagen,
    );
    if (personas && !consentimiento) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['evidencias'],
        message:
          'Si en la evidencia aparecen personas, debe confirmar que cuenta con su ' +
          'consentimiento para usar su imagen.',
      });
    }
  });
export type RegistrarGasto = z.infer<typeof esquemaRegistrarGasto>;

export const esquemaAnonimizar = z.object({
  regiones: z
    .array(
      z.object({
        x: z.coerce.number().min(0),
        y: z.coerce.number().min(0),
        ancho: z.coerce.number().positive(),
        alto: z.coerce.number().positive(),
      }),
    )
    .min(1, 'Marque al menos una region para difuminar.')
    .max(20),
});
export type Anonimizar = z.infer<typeof esquemaAnonimizar>;
