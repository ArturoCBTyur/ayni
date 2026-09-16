import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BitacoraService, type ContextoPeticion } from '../../comun/bitacora/bitacora.service';
import { soles } from '../../comun/dinero';
import { horasHabilesEntre, sumarHorasHabiles } from '../../comun/fechas';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { OngsService } from '../campanas/ongs.service';
import { AplicacionFifoService } from '../contable/aplicacion-fifo.service';
import { RetornoService } from '../retorno/retorno.service';
import type { BandejaFiltros, Reasignar, Revision } from './esquemas';

/** RN-07: tiempo maximo de resolucion de un caso de auditoria. */
export const SLA_HORAS_HABILES = 48;

/**
 * Porcentaje de casos ALTO que se auditan por muestreo (RN-08).
 *
 * Existe para medir los falsos aprobados: sin revisar nunca un caso que el
 * sistema aprobo solo, no habria forma de saber si la automatizacion se
 * equivoca. Es tambien la fuente de etiquetas de calidad para AIni.
 */
export const PORCENTAJE_MUESTREO_ALTO = 10;

/**
 * Resultado de una decision de auditoria.
 *
 * Los campos opcionales dependen de la decision: aprobar informa el monto y
 * cuantas donaciones quedaron financiadas; observar, hasta cuando hay plazo
 * para subsanar. Declararlo aqui evita que el tipo se pierda al componer la
 * respuesta y deja explicito que devuelve cada camino.
 */
export interface ResultadoRevision {
  revisionId: string;
  decision: 'APROBAR' | 'OBSERVAR' | 'RECHAZAR';
  estado: string;
  montoAprobado?: string;
  donacionesFinanciadas?: number;
  plazoSubsanacion?: Date;
}

@Injectable()
export class AuditoriaService {
  private readonly logger = new Logger(AuditoriaService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bitacora: BitacoraService,
    private readonly fifo: AplicacionFifoService,
    private readonly ongs: OngsService,
    private readonly retorno: RetornoService,
  ) {}

  /**
   * CU15 · Bandeja del auditor, ordenada por antiguedad o monto.
   *
   * Incluye los casos derivados por nivel MEDIO y los seleccionados por
   * muestreo entre los aprobados automaticamente.
   */
  async bandeja(auditorId: string, filtros: BandejaFiltros) {
    const donde: Prisma.GastoWhereInput = filtros.incluirMuestreo
      ? {
          OR: [
            { estado: 'EN_REVISION' },
            { estado: 'APROBADO', revisiones: { some: { esMuestreo: true, comentario: '' } } },
          ],
        }
      : { estado: 'EN_REVISION' };

    const [total, gastos] = await Promise.all([
      this.prisma.gasto.count({ where: donde }),
      this.prisma.gasto.findMany({
        where: donde,
        orderBy:
          filtros.orden === 'monto' ? { montoDeclarado: 'desc' } : { creadoEn: 'asc' },
        skip: (filtros.pagina - 1) * filtros.porPagina,
        take: filtros.porPagina,
        include: {
          ong: true,
          fondo: { include: { campana: true } },
          analisis: { orderBy: { creadoEn: 'desc' }, take: 1 },
          revisiones: { orderBy: { creadoEn: 'desc' }, take: 1 },
          alertas: { where: { estado: { in: ['ABIERTA', 'EN_SUBSANACION'] } } },
        },
      }),
    ]);

    const conflictos = await this.ongsConConflicto(auditorId);

    return {
      total,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
      casos: gastos.map((g) => {
        const analisis = g.analisis[0];
        const vence = sumarHorasHabiles(g.creadoEn, SLA_HORAS_HABILES);

        return {
          id: g.id,
          monto: soles(g.montoDeclarado),
          concepto: g.concepto,
          proveedor: g.proveedorNombre,
          fechaGasto: g.fechaGasto,
          recibidoEn: g.creadoEn,
          ong: {
            id: g.ong.id,
            nombre: g.ong.nombreComercial ?? g.ong.razonSocial,
            puntajeConfianza: soles(g.ong.puntajeConfianza),
          },
          campana: g.fondo.campana.titulo,
          fondo: g.fondo.nombre,
          nivel: analisis?.nivel ?? null,
          scoreFinal: analisis ? Number(analisis.scoreFinal) : null,
          esMuestreo: g.revisiones[0]?.esMuestreo ?? false,
          alertasAbiertas: g.alertas.length,
          sla: {
            venceEn: vence,
            horasTranscurridas: horasHabilesEntre(g.creadoEn, new Date()),
            vencido: new Date() > vence,
          },
          // El auditor no puede revisar a una ONG de la que es miembro.
          conflictoInteres: conflictos.includes(g.ongId),
        };
      }),
    };
  }

  /**
   * CU15 · Decision del auditor.
   *
   * APROBAR aplica el gasto FIFO por la misma ruta que usa la aprobacion
   * automatica: una sola implementacion contable, sin importar quien decide.
   *
   * La decision se guarda en revisiones_auditoria pase lo que pase, incluso
   * si la aplicacion contable falla despues: es el registro de que una
   * persona miro el caso y que concluyo.
   */
  async revisar(
    gastoId: string,
    auditorId: string,
    datos: Revision,
    contexto: ContextoPeticion,
  ): Promise<ResultadoRevision> {
    const gasto = await this.prisma.gasto.findUnique({
      where: { id: gastoId },
      include: { analisis: { orderBy: { creadoEn: 'desc' }, take: 1 } },
    });
    if (!gasto) throw new NotFoundException('No encontramos ese gasto.');

    await this.exigirSinConflicto(auditorId, gasto.ongId);

    if (gasto.estado === 'APROBADO' && datos.decision === 'APROBAR') {
      throw new BadRequestException('Ese gasto ya estaba aprobado.');
    }
    if (gasto.estado === 'RECHAZADO') {
      throw new BadRequestException('Ese gasto ya fue rechazado.');
    }

    const montoAprobado = new Prisma.Decimal(datos.montoAprobado ?? gasto.montoDeclarado);
    if (datos.decision === 'APROBAR' && montoAprobado.greaterThan(gasto.montoDeclarado)) {
      throw new BadRequestException(
        'No se puede aprobar por mas de lo que la organizacion declaro.',
      );
    }

    const revision = await this.prisma.revisionAuditoria.create({
      data: {
        gastoId,
        analisisId: gasto.analisis[0]?.id,
        auditorId,
        decision: datos.decision,
        comentario: datos.comentario,
        montoAprobado: datos.decision === 'APROBAR' ? montoAprobado : null,
      },
    });

    const resultado = await this.ejecutarDecision(gasto, datos, montoAprobado, auditorId);

    await this.bitacora.registrar({
      usuarioId: auditorId,
      accion: `AUDITORIA_${datos.decision}`,
      entidad: 'gastos',
      entidadId: gastoId,
      valorAnterior: { estado: gasto.estado },
      valorNuevo: {
        estado: resultado.estado,
        decision: datos.decision,
        montoAprobado: datos.decision === 'APROBAR' ? soles(montoAprobado) : null,
        // El nivel que habia propuesto el motor: permite medir despues
        // cuantas veces la maquina y la persona discreparon.
        nivelPropuesto: gasto.analisis[0]?.nivel ?? null,
      },
      ...contexto,
    });

    // El puntaje publico de la ONG se recalcula con la conducta observada.
    await this.ongs.calcularPuntaje(gasto.ongId);

    return {
      revisionId: revision.id,
      decision: datos.decision,
      estado: resultado.estado,
      ...resultado.detalle,
    };
  }

  private async ejecutarDecision(
    gasto: { id: string; ongId: string; estado: string; montoDeclarado: Prisma.Decimal },
    datos: Revision,
    montoAprobado: Prisma.Decimal,
    auditorId: string,
  ): Promise<{
    estado: string;
    detalle: Pick<ResultadoRevision, 'montoAprobado' | 'donacionesFinanciadas' | 'plazoSubsanacion'>;
  }> {
    if (datos.decision === 'APROBAR') {
      const aplicacion = await this.fifo.aprobarYAplicar({
        gastoId: gasto.id,
        montoAprobado,
        aprobadoPor: auditorId,
      });

      // Aprobar resuelve las alertas que el analisis habia abierto.
      await this.prisma.alerta.updateMany({
        where: { gastoId: gasto.id, estado: { in: ['ABIERTA', 'EN_SUBSANACION'] } },
        data: {
          estado: 'RESUELTA',
          resueltaEn: new Date(),
          resueltaPor: auditorId,
          notaResolucion: 'Resuelta por decision de auditoria.',
        },
      });

      // Cierra el ciclo con el donante. Un fallo aqui no revierte una
      // aprobacion ya asentada en el libro.
      try {
        await this.retorno.notificarImpacto(gasto.id);
      } catch (error) {
        this.logger.error(
          `Gasto ${gasto.id} aprobado en auditoria, pero fallo la notificacion: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }

      return {
        estado: 'APROBADO',
        detalle: {
          montoAprobado: aplicacion.montoAprobado,
          donacionesFinanciadas: aplicacion.aplicaciones.length,
        },
      };
    }

    if (datos.decision === 'OBSERVAR') {
      const plazo = new Date(Date.now() + datos.diasSubsanacion * 86_400_000);

      await this.prisma.$transaction(async (tx) => {
        await tx.gasto.update({ where: { id: gasto.id }, data: { estado: 'OBSERVADO' } });
        await tx.alerta.create({
          data: {
            ongId: gasto.ongId,
            gastoId: gasto.id,
            tipo: 'OBSERVACION_AUDITORIA',
            severidad: 'MEDIA',
            titulo: 'Un auditor observo este gasto',
            descripcion: datos.comentario,
            estado: 'ABIERTA',
            plazoSubsanacion: plazo,
            // RF-SO-04: la reputacion no se toca hasta que venza el plazo.
            afectaReputacion: false,
          },
        });
      });

      return { estado: 'OBSERVADO', detalle: { plazoSubsanacion: plazo } };
    }

    // RECHAZAR: el gasto no se ejecuta y el dinero sigue retenido para otro
    // gasto del mismo fondo. La alerta afecta reputacion de inmediato porque
    // ya hubo revision humana: no queda nada que subsanar.
    await this.prisma.$transaction(async (tx) => {
      await tx.gasto.update({ where: { id: gasto.id }, data: { estado: 'RECHAZADO' } });
      await tx.alerta.updateMany({
        where: { gastoId: gasto.id, estado: { in: ['ABIERTA', 'EN_SUBSANACION'] } },
        data: { afectaReputacion: true },
      });
      await tx.alerta.create({
        data: {
          ongId: gasto.ongId,
          gastoId: gasto.id,
          tipo: 'GASTO_RECHAZADO',
          severidad: 'ALTA',
          titulo: 'Gasto rechazado en auditoria',
          descripcion: datos.comentario,
          estado: 'RESUELTA',
          resueltaEn: new Date(),
          resueltaPor: auditorId,
          afectaReputacion: true,
        },
      });
    });

    return { estado: 'RECHAZADO', detalle: {} };
  }

  /**
   * CU11 · La ONG responde una observacion.
   *
   * El caso vuelve a analisis: se encola de nuevo para que el motor lo
   * evalue con la evidencia corregida, en lugar de aprobarlo por el solo
   * hecho de haber respondido.
   */
  async subsanar(
    alertaId: string,
    usuarioId: string,
    respuesta: string,
    contexto: ContextoPeticion,
  ) {
    const alerta = await this.prisma.alerta.findUnique({
      where: { id: alertaId },
      include: { gasto: true },
    });
    if (!alerta) throw new NotFoundException('No encontramos esa observacion.');

    const membresia = await this.prisma.ongMiembro.findUnique({
      where: { ongId_usuarioId: { ongId: alerta.ongId, usuarioId } },
    });
    if (!membresia?.activo) {
      throw new ForbiddenException('No pertenece a esa organizacion.');
    }
    if (alerta.estado === 'RESUELTA' || alerta.estado === 'DESCARTADA') {
      throw new BadRequestException('Esa observacion ya estaba cerrada.');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.alerta.update({
        where: { id: alertaId },
        data: {
          estado: 'EN_SUBSANACION',
          notaResolucion: respuesta,
        },
      });

      if (alerta.gastoId && alerta.gasto?.estado === 'OBSERVADO') {
        await tx.gasto.update({
          where: { id: alerta.gastoId },
          data: { estado: 'EN_ANALISIS' },
        });
        // Vuelve a la cola: responder no es lo mismo que corregir.
        await tx.trabajoVerificacion.create({ data: { gastoId: alerta.gastoId } });
      }
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: 'ALERTA_SUBSANADA',
      entidad: 'alertas',
      entidadId: alertaId,
      valorAnterior: { estado: alerta.estado },
      valorNuevo: { estado: 'EN_SUBSANACION' },
      ...contexto,
    });

    return { id: alertaId, estado: 'EN_SUBSANACION', gastoReanalizado: alerta.gastoId !== null };
  }

  /**
   * Reasigna un caso por conflicto de interes (CU15, flujo alterno 3b).
   *
   * Se registra en la bitacora con el motivo: un caso que cambia de manos
   * sin explicacion es exactamente lo que una auditoria externa marcaria.
   */
  async reasignar(
    gastoId: string,
    auditorOrigenId: string,
    datos: Reasignar,
    contexto: ContextoPeticion,
  ) {
    const gasto = await this.prisma.gasto.findUnique({ where: { id: gastoId } });
    if (!gasto) throw new NotFoundException('No encontramos ese gasto.');

    const destino = await this.prisma.usuario.findFirst({
      where: {
        id: datos.auditorDestinoId,
        estado: 'ACTIVO',
        roles: { some: { rol: { codigo: 'AUDITOR' } } },
      },
    });
    if (!destino) {
      throw new BadRequestException('El destinatario no es un auditor activo.');
    }

    const conflictos = await this.ongsConConflicto(destino.id);
    if (conflictos.includes(gasto.ongId)) {
      throw new BadRequestException(
        'Ese auditor tambien pertenece a la organizacion; elija a otro.',
      );
    }

    await this.prisma.revisionAuditoria.create({
      data: {
        gastoId,
        auditorId: auditorOrigenId,
        decision: 'OBSERVAR',
        comentario: `Reasignado por conflicto de interes: ${datos.motivo}`,
        conflictoInteres: true,
      },
    });

    await this.bitacora.registrar({
      usuarioId: auditorOrigenId,
      accion: 'AUDITORIA_REASIGNADA',
      entidad: 'gastos',
      entidadId: gastoId,
      valorNuevo: { auditorDestino: destino.id, motivo: datos.motivo },
      ...contexto,
    });

    return { gastoId, reasignadoA: destino.id };
  }

  /**
   * RN-08 · Selecciona casos ALTO para auditoria por muestreo.
   *
   * Sin esto no habria forma de medir los falsos aprobados, que es el
   * indicador que decide si la automatizacion merece confianza. Se marca con
   * una revision vacia que sirve de señal: el auditor la completa despues.
   */
  async seleccionarMuestreo(limite = 10): Promise<number> {
    const candidatos = await this.prisma.$queryRaw<{ id: string }[]>`
      SELECT g.id
        FROM gastos g
        JOIN analisis_aini a ON a.gasto_id = g.id AND a.nivel = 'ALTO'
       WHERE g.estado = 'APROBADO'
         AND NOT EXISTS (SELECT 1 FROM revisiones_auditoria r WHERE r.gasto_id = g.id)
         AND random() < ${PORCENTAJE_MUESTREO_ALTO / 100}
       ORDER BY g.aprobado_en DESC
       LIMIT ${limite}
    `;

    if (candidatos.length === 0) return 0;

    // Se usa el primer auditor activo como titular provisional; el caso se
    // reasigna si quien lo toma tiene conflicto.
    const auditor = await this.prisma.usuario.findFirst({
      where: { estado: 'ACTIVO', roles: { some: { rol: { codigo: 'AUDITOR' } } } },
    });
    if (!auditor) {
      this.logger.warn('No hay auditores activos para asignar el muestreo.');
      return 0;
    }

    await this.prisma.revisionAuditoria.createMany({
      data: candidatos.map((c) => ({
        gastoId: c.id,
        auditorId: auditor.id,
        decision: 'APROBAR' as const,
        // Vacio a proposito: marca el caso como pendiente de revision por
        // muestreo, y la bandeja lo distingue por eso.
        comentario: '',
        esMuestreo: true,
      })),
    });

    this.logger.log(`Muestreo: ${candidatos.length} caso(s) ALTO seleccionados para revision.`);
    return candidatos.length;
  }

  /** Indicadores del panel de auditoria. */
  async indicadores() {
    const [porNivel, revisiones, vencidos] = await Promise.all([
      this.prisma.analisisAini.groupBy({ by: ['nivel'], _count: { _all: true } }),
      this.prisma.revisionAuditoria.groupBy({
        by: ['decision'],
        where: { comentario: { not: '' } },
        _count: { _all: true },
      }),
      this.prisma.gasto.findMany({
        where: { estado: 'EN_REVISION' },
        select: { creadoEn: true },
      }),
    ]);

    const total = porNivel.reduce((suma, n) => suma + n._count._all, 0);
    const altos = porNivel.find((n) => n.nivel === 'ALTO')?._count._all ?? 0;

    // RN-08: de los casos ALTO revisados por muestreo, cuantos se cayeron.
    const muestreados = await this.prisma.revisionAuditoria.findMany({
      where: { esMuestreo: true, comentario: { not: '' } },
      select: { decision: true },
    });
    const falsosAprobados = muestreados.filter((m) => m.decision !== 'APROBAR').length;

    return {
      analisis: {
        total,
        porNivel: Object.fromEntries(porNivel.map((n) => [n.nivel, n._count._all])),
        // Indicador de la Tabla 3: gastos resueltos sin intervencion humana.
        porcentajeAutomatico: total > 0 ? Math.round((altos / total) * 1000) / 10 : 0,
      },
      revisiones: Object.fromEntries(revisiones.map((r) => [r.decision, r._count._all])),
      muestreo: {
        revisados: muestreados.length,
        falsosAprobados,
        porcentaje:
          muestreados.length > 0
            ? Math.round((falsosAprobados / muestreados.length) * 1000) / 10
            : null,
      },
      sla: {
        horasHabiles: SLA_HORAS_HABILES,
        pendientes: vencidos.length,
        vencidos: vencidos.filter(
          (g) => new Date() > sumarHorasHabiles(g.creadoEn, SLA_HORAS_HABILES),
        ).length,
      },
    };
  }

  /** ONG en las que el auditor es miembro y por tanto no puede revisar. */
  private async ongsConConflicto(auditorId: string): Promise<string[]> {
    const membresias = await this.prisma.ongMiembro.findMany({
      where: { usuarioId: auditorId, activo: true },
      select: { ongId: true },
    });
    return membresias.map((m) => m.ongId);
  }

  private async exigirSinConflicto(auditorId: string, ongId: string): Promise<void> {
    const conflictos = await this.ongsConConflicto(auditorId);
    if (conflictos.includes(ongId)) {
      throw new ForbiddenException(
        'No puede auditar a una organizacion de la que es miembro. Reasigne el caso.',
      );
    }
  }
}
