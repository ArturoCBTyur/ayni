import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { soles } from '../../comun/dinero';
import { sumarHorasHabiles } from '../../comun/fechas';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { SLA_HORAS_HABILES } from '../auditoria/auditoria.service';

const CERO = new Prisma.Decimal(0);

/**
 * El inicio de cada rol: lo que tiene pendiente y como va lo suyo.
 *
 * Una sola consulta por pantalla de inicio, en vez de que la aplicacion
 * encadene cuatro o cinco al abrir. Cada seccion se calcula solo si la
 * persona tiene el rol que la ve, y la de la ONG sale de sus membresias
 * activas, que es lo que de verdad la autoriza, no del rol.
 *
 * No repite el tablero del administrador: la conciliacion y los indicadores
 * de la Tabla 3 siguen alla, porque calcularlos en cada inicio seria caro y
 * porque merecen leerse con calma, no de pasada.
 */
@Injectable()
export class PanelService {
  constructor(private readonly prisma: PrismaService) {}

  async panel(usuarioId: string, roles: string[]) {
    const auditaOAdministra = roles.includes('AUDITOR') || roles.includes('ADMIN');

    const [donante, ongs, auditor, administrador] = await Promise.all([
      roles.includes('DONANTE') ? this.donante(usuarioId) : null,
      this.ongs(usuarioId),
      auditaOAdministra ? this.auditor() : null,
      roles.includes('ADMIN') ? this.administrador() : null,
    ]);

    return { donante, ongs: ongs.length > 0 ? ongs : null, auditor, administrador };
  }

  /** Cuanto dio, cuanto ya se gasto con respaldo y cuanto espera evidencia. */
  private async donante(usuarioId: string) {
    const donante = await this.prisma.donante.findUnique({ where: { usuarioId } });
    if (!donante) return null;

    const [confirmadas, aplicado, sinLeer, ultimo, suscripciones, causas, devuelto] =
      await Promise.all([
        // Una donacion nacida de un traslado no es dinero nuevo: ya se conto
        // como aporte en la causa que cerro (D2).
        this.prisma.donacion.aggregate({
          where: { donanteId: donante.id, estado: 'CONFIRMADA', donacionOrigenId: null },
          _sum: { montoNeto: true },
          _count: { _all: true },
        }),
        this.prisma.aplicacionDonacion.aggregate({
          where: { donacion: { donanteId: donante.id }, gasto: { estado: 'APROBADO' } },
          _sum: { monto: true },
        }),
        this.prisma.notificacion.count({ where: { usuarioId, leidaEn: null } }),
        this.prisma.notificacion.findFirst({
          where: { usuarioId },
          orderBy: { creadoEn: 'desc' },
          select: { asunto: true, montoAplicado: true, creadoEn: true },
        }),
        this.prisma.suscripcion.count({ where: { donanteId: donante.id, estado: 'ACTIVA' } }),
        this.prisma.campana.count({
          where: {
            fondos: { some: { donaciones: { some: { donanteId: donante.id, estado: 'CONFIRMADA' } } } },
          },
        }),
        this.prisma.remanenteDonacion.aggregate({
          where: {
            donacion: { donanteId: donante.id },
            destino: 'DEVOLUCION',
            resueltoEn: { not: null },
          },
          _sum: { monto: true },
        }),
      ]);

    const aportado = confirmadas._sum.montoNeto ?? CERO;
    const ejecutado = aplicado._sum.monto ?? CERO;
    // Lo devuelto al cerrar una causa ya no espera evidencia: volvio al donante.
    const devueltoAlDonante = devuelto._sum.monto ?? CERO;

    return {
      aportes: confirmadas._count._all,
      aportado: soles(aportado),
      // Lo que ya financio un gasto aprobado, con comprobante y evidencia.
      ejecutado: soles(ejecutado),
      // Lo que sigue retenido: todavia no se gasto, o no se demostro.
      esperandoEvidencia: soles(
        Prisma.Decimal.max(aportado.minus(ejecutado).minus(devueltoAlDonante), CERO),
      ),
      devuelto: soles(devueltoAlDonante),
      causasApoyadas: causas,
      impactosSinLeer: sinLeer,
      ultimoImpacto: ultimo
        ? {
            asunto: ultimo.asunto,
            montoAplicado: ultimo.montoAplicado ? soles(ultimo.montoAplicado) : null,
            creadoEn: ultimo.creadoEn,
          }
        : null,
      suscripcionesActivas: suscripciones,
    };
  }

  /** Por cada ONG de la que es miembro: dinero, gastos y lo que espera de el. */
  private async ongs(usuarioId: string) {
    const membresias = await this.prisma.ongMiembro.findMany({
      where: { usuarioId, activo: true },
      include: { ong: true },
    });

    return Promise.all(
      membresias.map(async ({ ong, cargo }) => {
        const [campanas, saldos, gastos, observaciones, porDifuminar, equipo] = await Promise.all([
          this.prisma.campana.groupBy({
            by: ['estado'],
            where: { ongId: ong.id },
            _count: { _all: true },
          }),
          this.prisma.fondo.aggregate({
            where: { campana: { ongId: ong.id } },
            _sum: { meta: true, saldoRecaudado: true, saldoRetenido: true, saldoEjecutado: true },
          }),
          this.prisma.gasto.groupBy({
            by: ['estado'],
            where: { ongId: ong.id },
            _count: { _all: true },
          }),
          this.prisma.alerta.count({
            where: { ongId: ong.id, estado: { in: ['ABIERTA', 'EN_SUBSANACION'] } },
          }),
          this.prisma.evidencia.count({
            where: { gasto: { ongId: ong.id }, contienePersonas: true, anonimizada: false },
          }),
          this.prisma.ongMiembro.count({ where: { ongId: ong.id, activo: true } }),
        ]);

        const contar = <T extends { _count: { _all: number } }>(filas: T[], clave: keyof T) =>
          Object.fromEntries(filas.map((f) => [String(f[clave]), f._count._all]));

        return {
          id: ong.id,
          nombre: ong.nombreComercial ?? ong.razonSocial,
          cargo,
          estadoVerificacion: ong.estadoVerificacion,
          motivoRechazo: ong.motivoRechazo,
          puntajeConfianza: soles(ong.puntajeConfianza),
          campanas: contar(campanas, 'estado'),
          gastos: contar(gastos, 'estado'),
          meta: soles(saldos._sum.meta ?? CERO),
          recaudado: soles(saldos._sum.saldoRecaudado ?? CERO),
          retenido: soles(saldos._sum.saldoRetenido ?? CERO),
          ejecutado: soles(saldos._sum.saldoEjecutado ?? CERO),
          observacionesAbiertas: observaciones,
          fotosPorDifuminar: porDifuminar,
          equipoActivo: equipo,
        };
      }),
    );
  }

  /** La cola del auditor: cuantos casos, cuantos fuera de plazo y de que nivel. */
  private async auditor() {
    const [enRevision, ongsPorVerificar, alertasAbiertas] = await Promise.all([
      this.prisma.gasto.findMany({
        where: { estado: 'EN_REVISION' },
        select: {
          creadoEn: true,
          analisis: { orderBy: { creadoEn: 'desc' }, take: 1, select: { nivel: true } },
        },
      }),
      this.prisma.ong.count({ where: { estadoVerificacion: { in: ['PENDIENTE', 'EN_REVISION'] } } }),
      this.prisma.alerta.count({ where: { estado: { in: ['ABIERTA', 'EN_SUBSANACION'] } } }),
    ]);

    const ahora = new Date();
    const porNivel: Record<string, number> = { ALTO: 0, MEDIO: 0, BAJO: 0, SIN_ANALISIS: 0 };
    for (const g of enRevision) {
      porNivel[g.analisis[0]?.nivel ?? 'SIN_ANALISIS'] += 1;
    }

    return {
      casosEnRevision: enRevision.length,
      // RN-07: 48 horas habiles para resolver.
      casosVencidos: enRevision.filter(
        (g) => sumarHorasHabiles(g.creadoEn, SLA_HORAS_HABILES) < ahora,
      ).length,
      porNivel,
      ongsPorVerificar,
      alertasAbiertas,
    };
  }

  /** Lo que el administrador de la plataforma tiene que atender. */
  private async administrador() {
    const ahora = new Date();
    const sinAtender: Prisma.SolicitudArcoWhereInput = {
      estado: { in: ['RECIBIDA', 'EN_PROCESO'] },
    };

    const [arcoPendientes, arcoVencidas, colaPendiente, colaFallida, bloqueados] =
      await Promise.all([
        this.prisma.solicitudArco.count({ where: sinAtender }),
        this.prisma.solicitudArco.count({ where: { ...sinAtender, plazoLimite: { lt: ahora } } }),
        this.prisma.trabajoVerificacion.count({
          where: { estado: { in: ['PENDIENTE', 'PROCESANDO'] } },
        }),
        this.prisma.trabajoVerificacion.count({ where: { estado: 'FALLIDO' } }),
        this.prisma.usuario.count({ where: { estado: 'BLOQUEADO' } }),
      ]);

    return {
      arcoPendientes,
      // Ley 29733: una solicitud vencida es un incumplimiento, no un atraso.
      arcoVencidas,
      colaPendiente,
      colaFallida,
      usuariosBloqueados: bloqueados,
    };
  }
}
