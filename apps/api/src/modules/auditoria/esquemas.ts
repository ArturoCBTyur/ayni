import { z } from 'zod';

/**
 * Decision del auditor sobre un gasto (CU15).
 *
 * El comentario es obligatorio incluso al aprobar. Una aprobacion sin
 * fundamento registrado no es auditable, y es lo primero que un revisor
 * externo preguntaria. Ademas, cada decision se convierte en una etiqueta
 * para el futuro reentrenamiento de AIni (RF-IA-11): una etiqueta sin
 * justificacion vale mucho menos.
 */
export const esquemaRevision = z
  .object({
    decision: z.enum(['APROBAR', 'OBSERVAR', 'RECHAZAR']),
    comentario: z
      .string()
      .trim()
      .min(15, 'Explique su decision en al menos 15 caracteres: queda como registro auditable.')
      .max(2000),
    /**
     * Permite aprobar por un monto menor al declarado, cuando el comprobante
     * respalda solo una parte. Si se omite, se aprueba el monto declarado.
     */
    montoAprobado: z.coerce.number().positive().max(9_999_999.99).optional(),
    /** Dias que se conceden a la ONG para subsanar. */
    diasSubsanacion: z.coerce.number().int().min(1).max(30).default(5),
  })
  .superRefine((datos, ctx) => {
    if (datos.decision !== 'APROBAR' && datos.montoAprobado !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['montoAprobado'],
        message: 'Solo se indica monto aprobado cuando la decision es APROBAR.',
      });
    }
  });
export type Revision = z.infer<typeof esquemaRevision>;

export const esquemaSubsanacion = z.object({
  respuesta: z
    .string()
    .trim()
    .min(20, 'Describa que corrigio para que el auditor pueda evaluarlo.')
    .max(2000),
});
export type Subsanacion = z.infer<typeof esquemaSubsanacion>;

export const esquemaReasignar = z.object({
  auditorDestinoId: z.string().uuid('Indique el auditor que tomara el caso.'),
  motivo: z
    .string()
    .trim()
    .min(10, 'Explique por que se reasigna el caso.')
    .max(500),
});
export type Reasignar = z.infer<typeof esquemaReasignar>;

export const esquemaBandeja = z.object({
  /** Ordena por antiguedad o por monto, como pide CU15. */
  orden: z.enum(['antiguedad', 'monto']).default('antiguedad'),
  /** Incluye tambien los casos de muestreo de nivel ALTO (RN-08). */
  // Antes era z.coerce.boolean(), que convierte el texto "false" de la URL
  // en true: no habia forma de excluir el muestreo desde la consulta.
  incluirMuestreo: z.union([z.boolean(), z.enum(['true', 'false'])]).default(true),
  /**
   * Nivel del motor. Filtra por cualquier analisis del gasto con ese nivel:
   * un gasto subsanado puede tener uno anterior distinto, y para elegir por
   * donde empezar alcanza.
   */
  nivel: z.enum(['ALTO', 'MEDIO', 'BAJO']).optional(),
  /** Solo los casos de una organizacion. */
  ongId: z.string().uuid().optional(),
  pagina: z.coerce.number().int().min(1).default(1),
  porPagina: z.coerce.number().int().min(1).max(50).default(20),
});
export type BandejaFiltros = z.infer<typeof esquemaBandeja>;
