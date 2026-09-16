import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';

import { PrismaService } from '../../comun/prisma/prisma.service';
import { VerificacionService } from './verificacion.service';

/** Cuantos trabajos toma cada pasada. */
const LOTE = 5;
/** Espera entre reintentos, creciente: 1, 4 y 9 minutos. */
const BACKOFF_BASE_MS = 60_000;

interface TrabajoTomado {
  id: string;
  gasto_id: string;
  intentos: number;
  max_intentos: number;
}

/**
 * Cola de verificacion sobre PostgreSQL (ADR-0002).
 *
 * Reemplaza a BullMQ/Redis en el MVP. El patron es el estandar de colas en
 * PostgreSQL: `FOR UPDATE SKIP LOCKED` toma un lote y lo marca como
 * PROCESANDO en una sola operacion atomica, de modo que dos workers nunca
 * tomen el mismo trabajo y ninguno quede esperando al otro.
 *
 * Cuando AIni entre, el analisis pasara a tardar segundos en lugar de
 * milisegundos y convendra migrar a Redis. Lo que cambiara entonces es el
 * productor; los estados del trabajo y el consumidor siguen igual.
 */
@Injectable()
export class ColaVerificacionService {
  private readonly logger = new Logger(ColaVerificacionService.name);
  private procesando = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly verificacion: VerificacionService,
  ) {}

  /**
   * Pasada periodica.
   *
   * El guard `procesando` evita que dos pasadas se solapen dentro del mismo
   * proceso. Entre procesos distintos, quien garantiza la exclusion es
   * SKIP LOCKED en la base, no esta bandera.
   */
  @Interval(5_000)
  async pasada(): Promise<void> {
    if (this.procesando) return;
    this.procesando = true;
    try {
      await this.procesarLote();
    } catch (error) {
      this.logger.error(
        `Fallo la pasada de la cola: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.procesando = false;
    }
  }

  /** Procesa un lote y devuelve cuantos trabajos atendio. */
  async procesarLote(): Promise<number> {
    const trabajos = await this.tomarLote();
    if (trabajos.length === 0) return 0;

    for (const trabajo of trabajos) {
      await this.procesarTrabajo(trabajo);
    }
    return trabajos.length;
  }

  /**
   * Toma hasta LOTE trabajos pendientes y los marca PROCESANDO.
   *
   * Todo en una sentencia: seleccionar y marcar por separado abriria una
   * ventana en la que otro worker podria tomar el mismo trabajo.
   */
  private async tomarLote(): Promise<TrabajoTomado[]> {
    return this.prisma.$queryRaw<TrabajoTomado[]>`
      UPDATE trabajos_verificacion t
         SET estado = 'PROCESANDO', tomado_en = now(), intentos = t.intentos + 1
       WHERE t.id IN (
         SELECT id FROM trabajos_verificacion
          WHERE estado = 'PENDIENTE'
            AND proximo_intento_en <= now()
          ORDER BY creado_en ASC
          LIMIT ${LOTE}
            FOR UPDATE SKIP LOCKED
       )
      RETURNING t.id, t.gasto_id, t.intentos, t.max_intentos
    `;
  }

  private async procesarTrabajo(trabajo: TrabajoTomado): Promise<void> {
    try {
      const resultado = await this.verificacion.analizarGasto(trabajo.gasto_id);

      await this.prisma.trabajoVerificacion.update({
        where: { id: trabajo.id },
        data: { estado: 'COMPLETADO', completadoEn: new Date(), error: null },
      });

      this.logger.log(
        `Gasto ${trabajo.gasto_id}: ${resultado.nivel} (${resultado.scoreFinal}) -> ${resultado.accion}`,
      );
    } catch (error) {
      const mensaje = error instanceof Error ? error.message : String(error);
      const agotado = trabajo.intentos >= trabajo.max_intentos;

      await this.prisma.trabajoVerificacion.update({
        where: { id: trabajo.id },
        data: {
          estado: agotado ? 'FALLIDO' : 'PENDIENTE',
          error: mensaje,
          // Backoff cuadratico: reintentar de inmediato ante un fallo
          // sistematico solo multiplica el ruido.
          proximoIntentoEn: new Date(Date.now() + BACKOFF_BASE_MS * trabajo.intentos ** 2),
        },
      });

      if (agotado) {
        // Un gasto cuyo analisis no se puede completar no puede quedarse en
        // EN_ANALISIS para siempre: pasa a revision humana, que es el
        // desenlace seguro cuando la automatizacion falla.
        await this.prisma.gasto.updateMany({
          where: { id: trabajo.gasto_id, estado: 'EN_ANALISIS' },
          data: { estado: 'EN_REVISION' },
        });
        this.logger.error(
          `Gasto ${trabajo.gasto_id}: analisis agotado tras ${trabajo.intentos} intentos (${mensaje}). Derivado a revision humana.`,
        );
      } else {
        this.logger.warn(
          `Gasto ${trabajo.gasto_id}: intento ${trabajo.intentos} fallido (${mensaje}). Se reintentara.`,
        );
      }
    }
  }

  /** Estado de la cola, para el panel del administrador. */
  async estado() {
    const filas = await this.prisma.trabajoVerificacion.groupBy({
      by: ['estado'],
      _count: { _all: true },
    });

    const porEstado = Object.fromEntries(filas.map((f) => [f.estado, f._count._all]));

    return {
      pendientes: porEstado.PENDIENTE ?? 0,
      procesando: porEstado.PROCESANDO ?? 0,
      completados: porEstado.COMPLETADO ?? 0,
      fallidos: porEstado.FALLIDO ?? 0,
    };
  }
}
