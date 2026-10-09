import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { soles } from '../../comun/dinero';
import { PrismaService } from '../../comun/prisma/prisma.service';
import {
  CONFIANZA_DONANTE,
  SUS,
  UMBRAL_PUBLICACION,
  variacionSoc1,
} from '../encuestas/instrumentos';

/**
 * Un indicador de la Tabla 3 del Entregable 2.
 *
 * `valor` es null cuando el indicador no se puede medir con lo que el
 * sistema registra hoy. Se declara igual, con el motivo, en lugar de
 * omitirlo: un tablero que solo muestra lo que sabe medir da la impresion de
 * que eso es todo lo que habia que medir.
 */
export interface Indicador {
  codigo: string;
  disciplina: string;
  nombre: string;
  meta: string;
  valor: number | string | null;
  unidad: string;
  /** Por que no se puede medir todavia, cuando valor es null. */
  noMedible?: string;
  cumple?: boolean;
  /**
   * Sobre cuantos casos se calcula (T4.4). Un 100 % de dos gastos y uno de
   * dos mil no dicen lo mismo, y el tablero tiene que poder distinguirlos.
   */
  n?: number;
}

/**
 * D6 · Un indicador que sale de lo que opinan las personas no se publica con
 * menos de UMBRAL_PUBLICACION respuestas: con tres, el promedio casi dice lo
 * que respondio cada una. Los indicadores operativos (gastos, analisis,
 * plazos) no llevan umbral: no describen a nadie.
 */
function conUmbral(indicador: Indicador, n: number): Indicador {
  if (n >= UMBRAL_PUBLICACION || indicador.valor === null) return { ...indicador, n };
  return {
    ...indicador,
    n,
    valor: null,
    cumple: undefined,
    noMedible:
      `Hay ${n} respuesta(s); se publica desde ${UMBRAL_PUBLICACION} para que el promedio ` +
      'no deje ver lo que respondio cada persona (D6).',
  };
}

@Injectable()
export class IndicadoresService {
  constructor(private readonly prisma: PrismaService) {}

  /** CU20 · Tablero de indicadores transdisciplinarios. */
  async tabla3(): Promise<{ indicadores: Indicador[]; medidos: number; total: number }> {
    const indicadores = [
      ...(await this.contables()),
      ...(await this.privacidad()),
      ...(await this.operacion()),
      ...(await this.comunicacion()),
      ...(await this.encuestas()),
      ...this.requierenInstrumento(),
    ];

    return {
      indicadores,
      medidos: indicadores.filter((i) => i.valor !== null).length,
      total: indicadores.length,
    };
  }

  private async contables(): Promise<Indicador[]> {
    const [total, conRespaldo] = await Promise.all([
      this.prisma.gasto.aggregate({
        where: { estado: 'APROBADO' },
        _sum: { montoAprobado: true },
        _count: { _all: true },
      }),
      this.prisma.gasto.aggregate({
        where: {
          estado: 'APROBADO',
          comprobante: { isNot: null },
          evidencias: { some: {} },
        },
        _sum: { montoAprobado: true },
      }),
    ]);

    const ejecutado = total._sum.montoAprobado ?? new Prisma.Decimal(0);
    const respaldado = conRespaldo._sum.montoAprobado ?? new Prisma.Decimal(0);

    const porcentaje = ejecutado.isZero()
      ? null
      : Number(respaldado.dividedBy(ejecutado).times(100).toFixed(1));

    return [
      {
        codigo: 'CYF-1',
        disciplina: 'Contabilidad y Finanzas',
        nombre: 'Soles ejecutados vinculados a comprobante y evidencia',
        meta: '100 %',
        valor: porcentaje,
        unidad: '%',
        cumple: porcentaje === null ? undefined : porcentaje >= 100,
        noMedible: ejecutado.isZero() ? 'Todavia no hay gastos ejecutados.' : undefined,
        n: total._count._all,
      },
      {
        codigo: 'CYF-2',
        disciplina: 'Contabilidad y Finanzas',
        nombre: 'Total ejecutado y verificado',
        meta: '—',
        valor: soles(ejecutado),
        unidad: 'PEN',
        n: total._count._all,
      },
    ];
  }

  private async privacidad(): Promise<Indicador[]> {
    // RNF-06 · La base impide notificar una evidencia sin anonimizar, asi
    // que esto deberia ser siempre 0. Se mide igual: un indicador que no se
    // comprueba nunca es una promesa, no un control.
    const [publicadasSinAnonimizar, conEvidencia] = await Promise.all([
      this.prisma.notificacion.count({ where: { evidencia: { anonimizada: false } } }),
      this.prisma.notificacion.count({ where: { evidenciaId: { not: null } } }),
    ]);

    const arco = await this.prisma.solicitudArco.findMany({
      where: { estado: { in: ['ATENDIDA', 'RECHAZADA'] } },
      select: { plazoLimite: true, respondidoEn: true },
    });
    const enPlazo = arco.filter((s) => s.respondidoEn && s.respondidoEn <= s.plazoLimite).length;

    return [
      {
        codigo: 'DER-1',
        disciplina: 'Derecho',
        nombre: 'Evidencias con personas publicadas sin anonimizar',
        meta: '0 %',
        valor: publicadasSinAnonimizar,
        unidad: 'notificaciones',
        cumple: publicadasSinAnonimizar === 0,
        n: conEvidencia,
      },
      {
        codigo: 'DER-2',
        disciplina: 'Derecho',
        nombre: 'Solicitudes ARCO atendidas dentro del plazo legal',
        meta: '100 %',
        valor: arco.length === 0 ? null : Math.round((enPlazo / arco.length) * 1000) / 10,
        unidad: '%',
        cumple: arco.length === 0 ? undefined : enPlazo === arco.length,
        noMedible: arco.length === 0 ? 'Aun no se ha resuelto ninguna solicitud ARCO.' : undefined,
        n: arco.length,
      },
    ];
  }

  private async operacion(): Promise<Indicador[]> {
    const [porNivel, gastos] = await Promise.all([
      this.prisma.analisisAini.groupBy({ by: ['nivel'], _count: { _all: true } }),
      this.prisma.gasto.findMany({
        where: { capturadoEn: { not: null }, sincronizadoEn: { not: null } },
        select: { capturadoEn: true, sincronizadoEn: true },
      }),
    ]);

    const totalAnalisis = porNivel.reduce((s, n) => s + n._count._all, 0);
    const altos = porNivel.find((n) => n.nivel === 'ALTO')?._count._all ?? 0;

    // Mediana y no promedio: un solo gasto capturado sin conexion y
    // sincronizado dias despues desplazaria el promedio sin que la
    // experiencia tipica del operador haya cambiado.
    const duraciones = gastos
      .map((g) => (g.sincronizadoEn!.getTime() - g.capturadoEn!.getTime()) / 1000)
      .filter((s) => s >= 0)
      .sort((a, b) => a - b);

    const mediana =
      duraciones.length === 0
        ? null
        : Math.round(duraciones[Math.floor(duraciones.length / 2)]);

    const muestreo = await this.prisma.revisionAuditoria.findMany({
      where: { esMuestreo: true, comentario: { not: '' } },
      select: { decision: true },
    });
    const falsos = muestreo.filter((m) => m.decision !== 'APROBAR').length;

    return [
      {
        codigo: 'INF-1',
        disciplina: 'Informatica',
        nombre: 'Gastos resueltos automaticamente, sin revision humana',
        meta: '>= 60 %',
        valor: totalAnalisis === 0 ? null : Math.round((altos / totalAnalisis) * 1000) / 10,
        unidad: '%',
        cumple: totalAnalisis === 0 ? undefined : (altos / totalAnalisis) * 100 >= 60,
        noMedible: totalAnalisis === 0 ? 'Todavia no hay analisis registrados.' : undefined,
        n: totalAnalisis,
      },
      {
        codigo: 'INF-2',
        disciplina: 'Informatica',
        nombre: 'Falsos aprobados detectados por muestreo',
        meta: '<= 2 %',
        valor: muestreo.length === 0 ? null : Math.round((falsos / muestreo.length) * 1000) / 10,
        unidad: '%',
        cumple: muestreo.length === 0 ? undefined : (falsos / muestreo.length) * 100 <= 2,
        noMedible:
          muestreo.length === 0
            ? 'Aun no se han completado revisiones por muestreo (RN-08).'
            : undefined,
        n: muestreo.length,
      },
      {
        codigo: 'PSI-2',
        disciplina: 'Psicologia y UX',
        nombre: 'Tiempo entre captura y sincronizacion de un gasto',
        meta: '<= 120 s (mediana)',
        valor: mediana,
        unidad: 's',
        cumple: mediana === null ? undefined : mediana <= 120,
        noMedible: mediana === null ? 'Todavia no hay gastos con captura registrada.' : undefined,
        n: duraciones.length,
      },
    ];
  }

  private async comunicacion(): Promise<Indicador[]> {
    const [valoraciones, notificaciones] = await Promise.all([
      this.prisma.feedbackDonante.aggregate({
        where: { valoracion: { not: null } },
        _avg: { valoracion: true },
        _count: { _all: true },
      }),
      this.prisma.notificacion.findMany({
        where: { tipo: 'IMPACTO', enviadaEn: { not: null }, gastoId: { not: null } },
        select: { enviadaEn: true, gasto: { select: { aprobadoEn: true } } },
      }),
    ]);

    const minutos = notificaciones
      .filter((n) => n.gasto?.aprobadoEn)
      .map((n) => (n.enviadaEn!.getTime() - n.gasto!.aprobadoEn!.getTime()) / 60_000)
      .filter((m) => m >= 0)
      .sort((a, b) => a - b);

    const medianaMinutos =
      minutos.length === 0 ? null : Math.round(minutos[Math.floor(minutos.length / 2)] * 10) / 10;

    return [
      conUmbral(
        {
          codigo: 'COM-1',
          disciplina: 'Comunicacion',
          nombre: 'Valoracion de la narrativa por el donante',
          meta: '>= 4 de 5',
          valor: valoraciones._avg.valoracion
            ? Math.round(valoraciones._avg.valoracion * 10) / 10
            : null,
          unidad: '/5',
          cumple: valoraciones._avg.valoracion ? valoraciones._avg.valoracion >= 4 : undefined,
          noMedible:
            valoraciones._count._all === 0
              ? 'Ningun donante ha valorado una narrativa todavia.'
              : undefined,
        },
        valoraciones._count._all,
      ),
      {
        codigo: 'COM-2',
        disciplina: 'Comunicacion y Psicologia',
        nombre: 'Tiempo entre aprobacion del gasto y aviso al donante',
        meta: '<= 10 min',
        valor: medianaMinutos,
        unidad: 'min',
        cumple: medianaMinutos === null ? undefined : medianaMinutos <= 10,
        noMedible: medianaMinutos === null ? 'Aun no se ha enviado ninguna narrativa.' : undefined,
        n: minutos.length,
      },
    ];
  }

  /**
   * SOC-1 y PSI-1, medidos con las encuestas de la Fase 4 (RF-SO-06, RF-PS-06).
   *
   * Sobre la version activa de cada instrumento: dos versiones con items
   * distintos no miden lo mismo y no se promedian juntas.
   */
  private async encuestas(): Promise<Indicador[]> {
    const [confianza, sus] = await Promise.all([
      this.prisma.instrumentoEncuesta.findFirst({
        where: { codigo: CONFIANZA_DONANTE.codigo, activo: true },
      }),
      this.prisma.instrumentoEncuesta.findFirst({ where: { codigo: SUS.codigo, activo: true } }),
    ]);

    const pares = confianza
      ? await this.prisma.$queryRaw<{ base: Prisma.Decimal; seguimiento: Prisma.Decimal }[]>`
          SELECT b.puntaje AS base, s.puntaje AS seguimiento
            FROM respuestas_encuesta b
            JOIN respuestas_encuesta s
              ON s.instrumento_id = b.instrumento_id AND s.seudonimo = b.seudonimo
           WHERE b.instrumento_id = ${confianza.id}::uuid
             AND b.momento = 'LINEA_BASE' AND s.momento = 'SEGUIMIENTO'
        `
      : [];
    const variacion = variacionSoc1(
      pares.map((p) => ({ base: Number(p.base), seguimiento: Number(p.seguimiento) })),
    );

    const usabilidad = sus
      ? await this.prisma.respuestaEncuesta.aggregate({
          where: { instrumentoId: sus.id },
          _avg: { puntaje: true },
          _count: { _all: true },
        })
      : null;
    const promedioSus = usabilidad?._avg.puntaje
      ? Math.round(Number(usabilidad._avg.puntaje) * 10) / 10
      : null;

    return [
      conUmbral(
        {
          codigo: 'SOC-1',
          disciplina: 'Sociologia',
          nombre: 'Variacion del indice de confianza del donante',
          meta: '+20 % sobre la linea base',
          valor: variacion,
          unidad: '%',
          cumple: variacion === null ? undefined : variacion >= 20,
          noMedible:
            variacion === null
              ? 'Todavia no hay donantes con linea base y seguimiento respondidos.'
              : undefined,
        },
        pares.length,
      ),
      conUmbral(
        {
          codigo: 'PSI-1',
          disciplina: 'Psicologia y UX',
          nombre: 'Usabilidad percibida (System Usability Scale)',
          meta: 'SUS >= 75',
          valor: promedioSus,
          unidad: 'SUS',
          cumple: promedioSus === null ? undefined : promedioSus >= 75,
          noMedible:
            promedioSus === null ? 'Todavia nadie respondio el cuestionario SUS.' : undefined,
        },
        usabilidad?._count._all ?? 0,
      ),
    ];
  }

  /**
   * Indicadores que el sistema no puede calcular por si solo.
   *
   * Se declaran con su motivo porque forman parte de la Tabla 3 y omitirlos
   * daria una imagen incompleta de lo que el piloto se propuso medir. SOC-1 y
   * PSI-1 salieron de aqui con las encuestas de la Fase 4; queda INF-3, que es
   * del frente de IA.
   */
  private requierenInstrumento(): Indicador[] {
    return [
      {
        codigo: 'INF-3',
        disciplina: 'Informatica',
        nombre: 'Exactitud de extraccion de campos del comprobante',
        meta: '>= 90 %',
        valor: null,
        unidad: '%',
        noMedible:
          'Esta version no extrae campos: los captura el operador. Se podra medir cuando ' +
          'AIni lea el comprobante y haya una lectura automatica que contrastar.',
      },
    ];
  }

  /** Resumen para la cabecera del tablero. */
  async resumen() {
    const [ongs, campanas, donantes, donaciones, gastos, notificaciones] = await Promise.all([
      this.prisma.ong.count({ where: { estadoVerificacion: 'VERIFICADA' } }),
      this.prisma.campana.count({ where: { estado: 'ACTIVA' } }),
      this.prisma.donante.count(),
      this.prisma.donacion.aggregate({
        where: { estado: 'CONFIRMADA' },
        _sum: { monto: true },
        _count: { _all: true },
      }),
      this.prisma.gasto.groupBy({ by: ['estado'], _count: { _all: true } }),
      this.prisma.notificacion.count({ where: { tipo: 'IMPACTO' } }),
    ]);

    return {
      ongsVerificadas: ongs,
      campanasActivas: campanas,
      donantes,
      donaciones: {
        cantidad: donaciones._count._all,
        total: soles(donaciones._sum.monto ?? 0),
      },
      gastos: Object.fromEntries(gastos.map((g) => [g.estado, g._count._all])),
      narrativasEnviadas: notificaciones,
    };
  }
}
