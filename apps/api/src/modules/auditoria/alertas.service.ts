import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';

import { PrismaService } from '../../comun/prisma/prisma.service';
import { OngsService } from '../campanas/ongs.service';

@Injectable()
export class AlertasService {
  private readonly logger = new Logger(AlertasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ongs: OngsService,
  ) {}

  /** Alertas abiertas de una ONG, para su panel. */
  async listarPorOng(ongId: string) {
    const alertas = await this.prisma.alerta.findMany({
      where: { ongId },
      orderBy: [{ estado: 'asc' }, { plazoSubsanacion: 'asc' }],
      take: 100,
      include: { gasto: { select: { id: true, concepto: true, montoDeclarado: true } } },
    });

    const ahora = new Date();

    return alertas.map((a) => ({
      id: a.id,
      tipo: a.tipo,
      severidad: a.severidad,
      titulo: a.titulo,
      descripcion: a.descripcion,
      estado: a.estado,
      plazoSubsanacion: a.plazoSubsanacion,
      diasRestantes: a.plazoSubsanacion
        ? Math.ceil((a.plazoSubsanacion.getTime() - ahora.getTime()) / 86_400_000)
        : null,
      // Transparencia con la ONG: sabe si esto ya cuenta en su puntaje.
      afectaReputacion: a.afectaReputacion,
      gasto: a.gasto && {
        id: a.gasto.id,
        concepto: a.gasto.concepto,
        monto: a.gasto.montoDeclarado.toFixed(2),
      },
      creadoEn: a.creadoEn,
    }));
  }

  /**
   * RF-SO-04 · Debido proceso reputacional.
   *
   * Ninguna alerta afecta el puntaje publico de una ONG hasta que vence su
   * plazo de subsanacion. Este job es el unico lugar donde `afectaReputacion`
   * pasa a true por el paso del tiempo, y solo alcanza a las alertas que
   * siguen abiertas: una que la organizacion ya respondio no se activa,
   * aunque el plazo haya pasado mientras el auditor la revisaba.
   *
   * La asimetria es deliberada. Estigmatizar a una ONG honesta por un error
   * subsanable es un daño que el proyecto existe para evitar, y es mucho mas
   * costoso que tardar un dia de mas en reflejar un incumplimiento real.
   */
  @Cron(CronExpression.EVERY_HOUR)
  async vencerPlazos(): Promise<number> {
    const vencidas = await this.prisma.alerta.findMany({
      where: {
        estado: 'ABIERTA',
        afectaReputacion: false,
        plazoSubsanacion: { lt: new Date() },
      },
      select: { id: true, ongId: true },
    });

    if (vencidas.length === 0) return 0;

    await this.prisma.alerta.updateMany({
      where: { id: { in: vencidas.map((a) => a.id) } },
      data: { afectaReputacion: true },
    });

    // El puntaje se recalcula una vez por ONG, no una por alerta.
    const ongs = [...new Set(vencidas.map((a) => a.ongId))];
    for (const ongId of ongs) {
      await this.ongs.calcularPuntaje(ongId);
    }

    this.logger.log(
      `${vencidas.length} alerta(s) vencieron su plazo de subsanacion en ${ongs.length} ONG.`,
    );
    return vencidas.length;
  }

  /** Cierra una alerta que ya no corresponde, con nota obligatoria. */
  async descartar(alertaId: string, auditorId: string, nota: string) {
    const alerta = await this.prisma.alerta.update({
      where: { id: alertaId },
      data: {
        estado: 'DESCARTADA',
        resueltaEn: new Date(),
        resueltaPor: auditorId,
        notaResolucion: nota,
        // Descartada significa que no habia nada que reprochar: deja de
        // contar para el puntaje.
        afectaReputacion: false,
      },
    });

    await this.ongs.calcularPuntaje(alerta.ongId);
    return { id: alerta.id, estado: alerta.estado };
  }
}
