import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { AplicacionFifoService } from '../contable/aplicacion-fifo.service';
import { distanciaHamming } from '../gastos/imagen';
import type { EntradaAnalisis, ResultadoAnalisis } from './contrato/analisis.contrato';
import { MOTOR_VERIFICACION, type MotorVerificacion } from './puertos/motor-verificacion.port';

/** Dias hacia atras que se consideran para detectar fraccionamiento. */
const VENTANA_FRACCIONAMIENTO_DIAS = 7;
/** Plazo que se da a la ONG para subsanar una observacion (RF-SO-04). */
const DIAS_SUBSANACION = 5;

@Injectable()
export class VerificacionService {
  private readonly logger = new Logger(VerificacionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bitacora: BitacoraService,
    private readonly fifo: AplicacionFifoService,
    @Inject(MOTOR_VERIFICACION) private readonly motor: MotorVerificacion,
  ) {}

  /**
   * Analiza un gasto y aplica la regla de decision (RF-IA-07).
   *
   * Es el punto donde el resultado del motor se convierte en una decision
   * operativa. Lo importante del diseño: este metodo no sabe si el analisis
   * lo produjo el motor de reglas o AIni. Recibe un `ResultadoAnalisis` y
   * actua igual en ambos casos.
   */
  async analizarGasto(gastoId: string): Promise<{
    analisisId: string;
    nivel: string;
    scoreFinal: number;
    accion: string;
  }> {
    const entrada = await this.construirEntrada(gastoId);
    const resultado = await this.motor.analizar(entrada);

    const analisis = await this.persistir(gastoId, entrada, resultado);
    const accion = await this.aplicarDecision(gastoId, resultado, analisis.id);

    return {
      analisisId: analisis.id,
      nivel: resultado.nivel,
      scoreFinal: resultado.scoreFinal,
      accion,
    };
  }

  /**
   * Reune todo lo que el motor necesita para decidir.
   *
   * El backend calcula aqui las señales que requieren consultar la base
   * (historial de montos, proveedores conocidos, distancia perceptual
   * minima) para que el motor sea una funcion sobre su entrada. Eso lo hace
   * comprobable sin base de datos, y permite que AIni reciba exactamente las
   * mismas señales sin tener que consultar nada.
   */
  private async construirEntrada(gastoId: string): Promise<EntradaAnalisis> {
    const gasto = await this.prisma.gasto.findUnique({
      where: { id: gastoId },
      include: { comprobante: true, evidencias: true, fondo: true },
    });

    if (!gasto) throw new NotFoundException('No encontramos ese gasto.');
    if (!gasto.comprobante) {
      throw new NotFoundException('El gasto no tiene comprobante que analizar.');
    }

    const regla = await this.prisma.reglaConfianza.findFirstOrThrow({ where: { activa: true } });

    const [estadisticas, proveedorPrevio, recientes, historicoPerceptual] = await Promise.all([
      this.estadisticasCategoria(gasto.fondo.categoriaGasto, gasto.ongId),
      this.prisma.gasto.count({
        where: {
          ongId: gasto.ongId,
          proveedorNombre: gasto.proveedorNombre,
          id: { not: gastoId },
        },
      }),
      this.prisma.gasto.count({
        where: {
          ongId: gasto.ongId,
          fondo: { categoriaGasto: gasto.fondo.categoriaGasto },
          id: { not: gastoId },
          creadoEn: {
            gte: new Date(Date.now() - VENTANA_FRACCIONAMIENTO_DIAS * 86_400_000),
          },
        },
      }),
      this.prisma.evidencia.findMany({
        where: { hashPerceptual: { not: null }, gastoId: { not: gastoId } },
        select: { hashPerceptual: true },
        orderBy: { creadoEn: 'desc' },
        take: 5000,
      }),
    ]);

    const hashesHistoricos = historicoPerceptual
      .map((e) => e.hashPerceptual)
      .filter((h): h is string => h !== null);

    return {
      gastoId: gasto.id,
      declarado: {
        fondoId: gasto.fondoId,
        categoriaGasto: gasto.fondo.categoriaGasto,
        montoDeclarado: gasto.montoDeclarado.toNumber(),
        concepto: gasto.concepto,
        proveedorNombre: gasto.proveedorNombre,
        proveedorRuc: gasto.proveedorRuc,
        fechaGasto: gasto.fechaGasto.toISOString(),
        capturadoEn: gasto.capturadoEn?.toISOString() ?? null,
      },
      comprobante: {
        tipo: gasto.comprobante.tipo,
        rucEmisor: gasto.comprobante.rucEmisor,
        serie: gasto.comprobante.serie,
        numero: gasto.comprobante.numero,
        fechaEmision: gasto.comprobante.fechaEmision.toISOString(),
        subtotal: gasto.comprobante.subtotal.toNumber(),
        igv: gasto.comprobante.igv.toNumber(),
        total: gasto.comprobante.total.toNumber(),
        moneda: gasto.comprobante.moneda,
        hashSha256: gasto.comprobante.hashSha256,
        archivoUrl: gasto.comprobante.archivoUrl,
      },
      evidencias: gasto.evidencias.map((e) => ({
        id: e.id,
        tipo: e.tipo,
        hashSha256: e.hashSha256,
        hashPerceptual: e.hashPerceptual,
        nitidez: e.nitidez ? e.nitidez.toNumber() : null,
        ancho: e.ancho,
        alto: e.alto,
        exifCapturadoEn: e.exifCapturadoEn?.toISOString() ?? null,
        distanciaMinimaHistorico: e.hashPerceptual
          ? this.distanciaMinima(e.hashPerceptual, hashesHistoricos)
          : undefined,
        contienePersonas: e.contienePersonas,
        anonimizada: e.anonimizada,
        archivoUrl: e.archivoUrl,
      })),
      contexto: {
        saldoRetenido: gasto.fondo.saldoRetenido.toNumber(),
        mediaHistoricaCategoria: estadisticas.media,
        desviacionHistoricaCategoria: estadisticas.desviacion,
        proveedorConocido: proveedorPrevio > 0,
        gastosRecientesMismaCategoria: recientes,
      },
      regla: {
        id: regla.id,
        umbralAlto: regla.umbralAlto,
        umbralMedio: regla.umbralMedio,
        pesoDocumental: regla.pesoDocumental.toNumber(),
        pesoVisual: regla.pesoVisual.toNumber(),
        pesoAnomalia: regla.pesoAnomalia.toNumber(),
      },
    };
  }

  private distanciaMinima(hash: string, historico: string[]): number | undefined {
    if (historico.length === 0) return undefined;
    return historico.reduce(
      (minima, otro) => Math.min(minima, distanciaHamming(hash, otro)),
      Number.MAX_SAFE_INTEGER,
    );
  }

  /**
   * Media y desviacion de los gastos aprobados de la categoria.
   *
   * Devuelve null cuando hay menos de tres casos: con uno o dos, la
   * desviacion no describe nada y cualquier monto pareceria atipico.
   */
  private async estadisticasCategoria(
    categoria: string,
    ongId: string,
  ): Promise<{ media: number | null; desviacion: number | null }> {
    const [fila] = await this.prisma.$queryRaw<
      { n: bigint; media: number | null; desviacion: number | null }[]
    >`
      SELECT count(*)::bigint AS n,
             avg(g.monto_declarado)::float8         AS media,
             stddev_samp(g.monto_declarado)::float8 AS desviacion
        FROM gastos g
        JOIN fondos f ON f.id = g.fondo_id
       WHERE g.ong_id = ${ongId}::uuid
         AND f.categoria_gasto::text = ${categoria}
         AND g.estado = 'APROBADO'
    `;

    if (Number(fila.n) < 3) return { media: null, desviacion: null };
    return { media: fila.media, desviacion: fila.desviacion };
  }

  /** Persiste el resultado integro, atado al motor y a la regla usada. */
  private async persistir(
    gastoId: string,
    entrada: EntradaAnalisis,
    resultado: ResultadoAnalisis,
  ) {
    const [nombre, version] = resultado.versionModelo.split('@');
    const modelo = await this.prisma.modeloIa.findUniqueOrThrow({
      where: { nombre_version: { nombre, version } },
    });

    return this.prisma.analisisAini.create({
      data: {
        gastoId,
        modeloId: modelo.id,
        // RN-06: queda registrada la regla vigente al momento del analisis,
        // de modo que cambiar los umbrales despues no reescribe el pasado.
        reglaId: entrada.regla.id,
        scoreDocumental: resultado.scoreDocumental,
        scoreVisual: resultado.scoreVisual,
        scoreAnomalia: resultado.scoreAnomalia,
        scoreFinal: resultado.scoreFinal,
        nivel: resultado.nivel,
        datosExtraidos: { ...resultado.datosExtraidos },
        explicacion: { ...resultado.explicacion },
        narrativaBorrador: resultado.narrativaBorrador,
        duracionMs: resultado.duracionMs,
      },
    });
  }

  /**
   * Convierte el nivel en una decision operativa (Tabla 16).
   *
   *   ALTO   aprueba, aplica FIFO y asienta la ejecucion
   *   MEDIO  deriva al panel de auditoria
   *   BAJO   bloquea y abre alerta para que la ONG subsane
   */
  private async aplicarDecision(
    gastoId: string,
    resultado: ResultadoAnalisis,
    analisisId: string,
  ): Promise<string> {
    const gasto = await this.prisma.gasto.findUniqueOrThrow({ where: { id: gastoId } });

    if (resultado.nivel === 'ALTO') {
      await this.fifo.aprobarYAplicar({
        gastoId,
        montoAprobado: gasto.montoDeclarado,
      });

      await this.bitacora.registrar({
        accion: 'GASTO_APROBADO_AUTOMATICAMENTE',
        entidad: 'gastos',
        entidadId: gastoId,
        valorAnterior: { estado: gasto.estado },
        valorNuevo: {
          estado: 'APROBADO',
          nivel: resultado.nivel,
          scoreFinal: resultado.scoreFinal,
          motor: resultado.versionModelo,
        },
      });

      return 'aprobado_automaticamente';
    }

    if (resultado.nivel === 'MEDIO') {
      await this.prisma.gasto.update({
        where: { id: gastoId },
        data: { estado: 'EN_REVISION' },
      });
      return 'derivado_a_auditoria';
    }

    // BAJO: se bloquea y se abre alerta con plazo de subsanacion. La
    // reputacion no se toca todavia (RF-SO-04): afectaReputacion se activa
    // solo cuando vence el plazo sin respuesta.
    await this.prisma.$transaction(async (tx) => {
      await tx.gasto.update({ where: { id: gastoId }, data: { estado: 'OBSERVADO' } });

      const principal = resultado.alertas[0];
      await tx.alerta.create({
        data: {
          ongId: gasto.ongId,
          gastoId,
          analisisId,
          tipo: principal?.tipo ?? 'CONFIANZA_BAJA',
          severidad: principal?.severidad ?? 'MEDIA',
          titulo: principal?.titulo ?? 'El gasto requiere subsanacion',
          descripcion: principal?.descripcion ?? resultado.explicacion.resumen,
          estado: 'ABIERTA',
          plazoSubsanacion: new Date(Date.now() + DIAS_SUBSANACION * 86_400_000),
          afectaReputacion: false,
        },
      });
    });

    return 'observado_para_subsanacion';
  }
}
