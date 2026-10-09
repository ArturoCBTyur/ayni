import { Prisma, type DestinoRemanente, type EstadoGasto, type PrismaClient } from '@prisma/client';

/**
 * Politica de remanente al cerrar una causa (RF-CF-11).
 *
 * ESTA ES LA PROPUESTA DE D2 (ADR-0007), TODAVIA SIN FIRMA DE DERECHO NI DE
 * CONTABILIDAD. Vive aqui, y solo aqui, para que lo que se firme cambie este
 * archivo y no el servicio:
 *
 * - 90 dias desde el cierre del fondo para justificar lo retenido, con aviso
 *   a la ONG a los 60;
 * - al vencer, el remanente de cada donante va a donde el elija: devolucion
 *   o traslado a otro fondo, con su consentimiento expreso;
 * - sin respuesta en 30 dias, devolucion;
 * - la comision de la pasarela no se devuelve: se cobro por un servicio que
 *   ya se presto. Derecho tiene que confirmarlo.
 */
export const DIAS_JUSTIFICACION = 90;
export const DIAS_AVISO_ONG = 60;
export const DIAS_ELECCION = 30;
export const DESTINO_POR_DEFECTO: DestinoRemanente = 'DEVOLUCION';

/**
 * Gastos que todavia pueden ejecutar dinero del fondo. Mientras haya alguno,
 * el remanente no se calcula: aprobarlo despues cambiaria cuanto queda.
 */
export const GASTOS_EN_CURSO: EstadoGasto[] = ['EN_ANALISIS', 'EN_REVISION', 'OBSERVADO'];

const DIA_MS = 24 * 60 * 60 * 1000;

export function sumarDias(desde: Date, dias: number): Date {
  return new Date(desde.getTime() + dias * DIA_MS);
}

type Cliente = PrismaClient | Prisma.TransactionClient;

/**
 * Abre el cierre de un fondo, si no lo tiene. Lo llaman cerrar un fondo,
 * cerrar su campaña y el job diario para los fondos cerrados antes de que
 * existiera esta politica (que empiezan a contar desde hoy).
 *
 * Un fondo que nunca recibio dinero no abre cierre: no hay nada que
 * justificar ni que devolver, y un informe de cierre vacio no informa nada.
 */
export async function iniciarCierreDeCausa(
  cliente: Cliente,
  fondoId: string,
  ahora = new Date(),
): Promise<boolean> {
  const [existente, movimientos] = await Promise.all([
    cliente.cierreCausa.findUnique({ where: { fondoId }, select: { id: true } }),
    cliente.movimientoContable.count({ where: { fondoId } }),
  ]);
  if (existente || movimientos === 0) return false;

  try {
    await cliente.cierreCausa.create({
      data: {
        fondoId,
        iniciadoEn: ahora,
        venceJustificacionEn: sumarDias(ahora, DIAS_JUSTIFICACION),
      },
    });
    return true;
  } catch (e) {
    // Dos cierres a la vez del mismo fondo: el otro ya lo abrio.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') return false;
    throw e;
  }
}
