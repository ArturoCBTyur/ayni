import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';

import { soles } from '../../comun/dinero';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { clasificarSaldos, sumasDesdeGrupos } from '../contable/clasificacion';
import { LibroService } from '../contable/libro.service';

export type SeveridadDescuadre = 'CRITICO' | 'ADVERTENCIA';

export interface Descuadre {
  /** Identificador estable de la comprobacion que fallo. */
  comprobacion: string;
  severidad: SeveridadDescuadre;
  /** Que se esperaba y que se encontro, en lenguaje de auditoria. */
  descripcion: string;
  esperado?: string;
  encontrado?: string;
  diferencia?: string;
  entidadId?: string;
}

export interface ResultadoConciliacion {
  fecha: Date;
  /** Cuadra cuando no hay ningun descuadre critico. */
  cuadra: boolean;
  totales: {
    pagosAprobados: string;
    ingresosLibro: string;
    comisiones: string;
    retenido: string;
    ejecutado: string;
    aplicadoADonaciones: string;
  };
  descuadres: Descuadre[];
  cadenas: { fondos: number; rotas: number; fondosRotos: string[] };
  duracionMs: number;
}

/**
 * Conciliacion contable automatica (RF-CF-04, CU16).
 *
 * Sustituye el cruce manual en hojas de calculo que el Entregable 2 describe
 * como lento, propenso a errores y dificil de auditar. La idea es simple: el
 * mismo dinero esta registrado en varias tablas por caminos independientes,
 * y si esos caminos no coinciden, algo se rompio.
 *
 * Cada comprobacion compara dos fuentes que se escribieron por separado. No
 * tiene sentido comparar una tabla consigo misma: eso siempre cuadra y no
 * demuestra nada.
 */
@Injectable()
export class ConciliacionService {
  private readonly logger = new Logger(ConciliacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly libro: LibroService,
  ) {}

  /**
   * Conciliacion diaria.
   *
   * Corre de madrugada, cuando no hay actividad que pueda producir un
   * descuadre transitorio: un pago confirmado a mitad de la comprobacion
   * aparecería en una fuente y no en la otra, y reportaria un problema que
   * no existe.
   */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async conciliacionDiaria(): Promise<ResultadoConciliacion> {
    const resultado = await this.conciliar();

    if (!resultado.cuadra) {
      this.logger.error(
        `Conciliacion con ${resultado.descuadres.length} descuadre(s). ` +
          resultado.descuadres.map((d) => d.comprobacion).join(', '),
      );
    } else {
      this.logger.log(
        `Conciliacion diaria correcta: ${resultado.totales.ingresosLibro} ingresados, ` +
          `${resultado.totales.retenido} retenidos, ${resultado.totales.ejecutado} ejecutados.`,
      );
    }

    return resultado;
  }

  async conciliar(): Promise<ResultadoConciliacion> {
    const inicio = Date.now();
    const descuadres: Descuadre[] = [];

    const totales = await this.calcularTotales();

    // 1. Lo cobrado por la pasarela debe coincidir con lo asentado como
    //    INGRESO. Son dos escrituras distintas: una la hace el webhook y la
    //    otra el trigger del libro.
    this.compararImportes(descuadres, {
      comprobacion: 'pagos_vs_ingresos',
      severidad: 'CRITICO',
      descripcion:
        'Los pagos aprobados por la pasarela no coinciden con los ingresos asentados en el libro.',
      esperado: totales.pagosAprobados,
      encontrado: totales.ingresosLibro,
    });

    // 2. Las comisiones que informo la pasarela contra las asentadas.
    this.compararImportes(descuadres, {
      comprobacion: 'comisiones_vs_libro',
      severidad: 'CRITICO',
      descripcion: 'Las comisiones cobradas no coinciden con los movimientos de tipo COMISION.',
      esperado: totales.comisionesPagos,
      encontrado: totales.comisionesLibro,
    });

    // 2b. D2 · Lo que sale trasladado de un fondo al cerrar su causa tiene
    //     que entrar en otro. Un traslado a medias deja dinero fuera de los dos.
    this.compararImportes(descuadres, {
      comprobacion: 'traslados_salida_vs_entrada',
      severidad: 'CRITICO',
      descripcion:
        'Los remanentes trasladados que salieron de sus fondos no coinciden con los que ' +
        'entraron a los fondos de destino.',
      esperado: totales.trasladosSalida,
      encontrado: totales.trasladosEntrada,
    });

    // 3. Los saldos de los fondos son una proyeccion del libro: si difieren,
    //    alguien los escribio por fuera del trigger.
    await this.compararSaldosDeFondos(descuadres);

    // 4. RN-04 · cada gasto aprobado debe estar cubierto exactamente por sus
    //    aplicaciones a donaciones.
    await this.compararAplicaciones(descuadres);

    // 5. Ninguna donacion puede tener aplicado mas de lo que aporto.
    await this.compararDonacionesSobreaplicadas(descuadres);

    // 6. RNF-07 · integridad de la cadena de hashes.
    const cadenas = await this.libro.verificarTodasLasCadenas();
    const rotas = cadenas.filter((c) => c.rota);

    for (const cadena of rotas) {
      descuadres.push({
        comprobacion: 'cadena_hashes',
        severidad: 'CRITICO',
        descripcion:
          `La cadena de hashes del fondo se rompe en el movimiento ${cadena.secuenciaRota}. ` +
          'Alguien modifico el libro por fuera de la aplicacion.',
        entidadId: cadena.fondoId,
      });
    }

    return {
      fecha: new Date(),
      cuadra: !descuadres.some((d) => d.severidad === 'CRITICO'),
      totales: {
        pagosAprobados: totales.pagosAprobados,
        ingresosLibro: totales.ingresosLibro,
        comisiones: totales.comisionesLibro,
        retenido: totales.retenido,
        ejecutado: totales.ejecutado,
        aplicadoADonaciones: totales.aplicado,
      },
      descuadres,
      cadenas: {
        fondos: cadenas.length,
        rotas: rotas.length,
        fondosRotos: rotas.map((c) => c.fondoId),
      },
      duracionMs: Date.now() - inicio,
    };
  }

  private async calcularTotales() {
    const [pagos, movimientos, aplicaciones] = await Promise.all([
      this.prisma.pago.aggregate({
        where: { estado: 'APROBADO' },
        _sum: { monto: true, comision: true },
      }),
      this.prisma.movimientoContable.groupBy({ by: ['tipo'], _sum: { monto: true } }),
      this.prisma.aplicacionDonacion.aggregate({ _sum: { monto: true } }),
    ]);

    const libro = clasificarSaldos(sumasDesdeGrupos(movimientos));

    return {
      pagosAprobados: soles(pagos._sum.monto ?? 0),
      comisionesPagos: soles(pagos._sum.comision ?? 0),
      ingresosLibro: soles(libro.recaudadoBruto),
      comisionesLibro: soles(libro.comisiones),
      retenido: soles(libro.conRestriccion),
      ejecutado: soles(libro.liberados),
      aplicado: soles(aplicaciones._sum.monto ?? 0),
      trasladosSalida: soles(libro.trasladado),
      trasladosEntrada: soles(libro.recibidoPorTraslado),
    };
  }

  private compararImportes(
    descuadres: Descuadre[],
    datos: {
      comprobacion: string;
      severidad: SeveridadDescuadre;
      descripcion: string;
      esperado: string;
      encontrado: string;
    },
  ): void {
    const diferencia = new Prisma.Decimal(datos.esperado).minus(datos.encontrado);
    if (diferencia.isZero()) return;

    descuadres.push({
      comprobacion: datos.comprobacion,
      severidad: datos.severidad,
      descripcion: datos.descripcion,
      esperado: datos.esperado,
      encontrado: datos.encontrado,
      diferencia: soles(diferencia),
    });
  }

  /**
   * Los saldos del fondo frente a la suma de su propio libro.
   *
   * Los saldos los mantiene el trigger fn_movimiento_aplicar_saldos; la suma
   * del libro sale de clasificarSaldos, escrita aparte. Antes esta suma solo
   * miraba RETENCION y EJECUCION, y el primer REVERSO o REASIGNACION que se
   * asentara habria aparecido como un descuadre que no existe.
   */
  private async compararSaldosDeFondos(descuadres: Descuadre[]): Promise<void> {
    const [fondos, grupos] = await Promise.all([
      this.prisma.fondo.findMany({
        select: { id: true, nombre: true, saldoRetenido: true, saldoEjecutado: true },
      }),
      this.prisma.movimientoContable.groupBy({ by: ['fondoId', 'tipo'], _sum: { monto: true } }),
    ]);

    const gruposPorFondo = new Map<string, typeof grupos>();
    for (const g of grupos) {
      gruposPorFondo.set(g.fondoId, [...(gruposPorFondo.get(g.fondoId) ?? []), g]);
    }

    for (const fondo of fondos) {
      const libro = clasificarSaldos(sumasDesdeGrupos(gruposPorFondo.get(fondo.id) ?? []));

      if (!fondo.saldoRetenido.equals(libro.conRestriccion)) {
        descuadres.push({
          comprobacion: 'saldo_retenido_vs_libro',
          severidad: 'CRITICO',
          descripcion: `El saldo retenido del fondo "${fondo.nombre}" no coincide con su libro.`,
          esperado: soles(libro.conRestriccion),
          encontrado: soles(fondo.saldoRetenido),
          diferencia: soles(libro.conRestriccion.minus(fondo.saldoRetenido)),
          entidadId: fondo.id,
        });
      }
      if (!fondo.saldoEjecutado.equals(libro.liberados)) {
        descuadres.push({
          comprobacion: 'saldo_ejecutado_vs_libro',
          severidad: 'CRITICO',
          descripcion: `El saldo ejecutado del fondo "${fondo.nombre}" no coincide con su libro.`,
          esperado: soles(libro.liberados),
          encontrado: soles(fondo.saldoEjecutado),
          diferencia: soles(libro.liberados.minus(fondo.saldoEjecutado)),
          entidadId: fondo.id,
        });
      }
    }
  }

  /** RN-04 · gastos aprobados cubiertos exactamente por sus aplicaciones. */
  private async compararAplicaciones(descuadres: Descuadre[]): Promise<void> {
    const filas = await this.prisma.$queryRaw<
      { id: string; concepto: string; monto_aprobado: Prisma.Decimal; aplicado: Prisma.Decimal }[]
    >`
      SELECT g.id, g.concepto, g.monto_aprobado,
             COALESCE(SUM(a.monto), 0) AS aplicado
        FROM gastos g
        LEFT JOIN aplicaciones_donacion a ON a.gasto_id = g.id
       WHERE g.estado = 'APROBADO'
       GROUP BY g.id
      HAVING g.monto_aprobado <> COALESCE(SUM(a.monto), 0)
    `;

    for (const fila of filas) {
      descuadres.push({
        comprobacion: 'aplicaciones_vs_monto_aprobado',
        severidad: 'CRITICO',
        descripcion:
          `El gasto "${fila.concepto}" esta aprobado por un monto que no coincide con lo ` +
          'aplicado a las donaciones que lo financian (RN-04).',
        esperado: soles(fila.monto_aprobado),
        encontrado: soles(fila.aplicado),
        diferencia: soles(fila.monto_aprobado.minus(fila.aplicado)),
        entidadId: fila.id,
      });
    }
  }

  /** Ninguna donacion puede financiar mas de lo que aporto. */
  private async compararDonacionesSobreaplicadas(descuadres: Descuadre[]): Promise<void> {
    const filas = await this.prisma.$queryRaw<
      { id: string; monto_neto: Prisma.Decimal; aplicado: Prisma.Decimal }[]
    >`
      SELECT d.id, d.monto_neto, COALESCE(SUM(a.monto), 0) AS aplicado
        FROM donaciones d
        LEFT JOIN aplicaciones_donacion a ON a.donacion_id = d.id
       GROUP BY d.id
      HAVING COALESCE(SUM(a.monto), 0) > d.monto_neto
    `;

    for (const fila of filas) {
      descuadres.push({
        comprobacion: 'donacion_sobreaplicada',
        severidad: 'CRITICO',
        descripcion: 'Una donacion financio mas de lo que aporto.',
        esperado: soles(fila.monto_neto),
        encontrado: soles(fila.aplicado),
        diferencia: soles(fila.aplicado.minus(fila.monto_neto)),
        entidadId: fila.id,
      });
    }
  }
}
