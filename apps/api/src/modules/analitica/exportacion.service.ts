import { Injectable, NotFoundException } from '@nestjs/common';

import { soles } from '../../comun/dinero';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { LibroService } from '../contable/libro.service';
import { ConciliacionService } from './conciliacion.service';

/**
 * Marca de orden de bytes. Excel en Windows la necesita para reconocer que
 * el CSV es UTF-8; sin ella, "Atencion veterinaria" con tilde llega mal
 * escrita en la maquina de quien audita. Se construye desde su punto de
 * codigo porque como caracter literal es invisible al revisar el codigo.
 */
const BOM = String.fromCharCode(0xfeff);

type ValorCsv = string | number | bigint | boolean | Date | null | undefined;

/**
 * Escapa un valor para CSV segun RFC 4180.
 *
 * Importa mas de lo que parece: un concepto de gasto como
 * `Alimento "premium", 20 kg` rompe la columna si no se entrecomilla, y el
 * archivo que un auditor abre en Excel queda desalineado justo donde estaba
 * el dato que venia a revisar.
 */
function campo(valor: ValorCsv): string {
  if (valor === null || valor === undefined) return '';

  const texto = valor instanceof Date ? valor.toISOString() : String(valor);

  if (/[",;\n\r]/.test(texto)) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

function aCsv(cabeceras: string[], filas: ValorCsv[][]): string {
  const lineas = [
    cabeceras.map(campo).join(','),
    ...filas.map((fila) => fila.map(campo).join(',')),
  ];

  return `${BOM}${lineas.join('\r\n')}\r\n`;
}

@Injectable()
export class ExportacionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly libro: LibroService,
    private readonly conciliacion: ConciliacionService,
  ) {}

  /**
   * Extracto del libro de un fondo, con sus hashes.
   *
   * Se exportan tambien hash_previo y hash_actual: permiten que un tercero
   * recalcule la cadena por su cuenta, sin confiar en que el sistema diga la
   * verdad sobre si misma. Es la diferencia entre un reporte y una prueba.
   */
  async libroDeFondo(fondoId: string): Promise<{ nombre: string; csv: string }> {
    const fondo = await this.prisma.fondo.findUnique({
      where: { id: fondoId },
      include: { campana: { include: { ong: true } } },
    });
    if (!fondo) throw new NotFoundException('No encontramos ese fondo.');

    const movimientos = await this.libro.extracto(fondoId);

    const csv = aCsv(
      [
        'secuencia',
        'fecha',
        'tipo',
        'cuenta_debe',
        'cuenta_haber',
        'monto_pen',
        'descripcion',
        'donacion_id',
        'gasto_id',
        'hash_previo',
        'hash_actual',
      ],
      movimientos.map((m) => [
        m.secuencia,
        m.fecha.toISOString(),
        m.tipo,
        m.debe,
        m.haber,
        m.monto,
        m.descripcion,
        m.donacionId,
        m.gastoId,
        m.hashPrevio,
        m.hashActual,
      ]),
    );

    return { nombre: `libro-${this.aSlug(fondo.nombre)}.csv`, csv };
  }

  /** Gastos de una ONG con su verificacion y su respaldo documental. */
  async gastosDeOng(ongId: string): Promise<{ nombre: string; csv: string }> {
    const ong = await this.prisma.ong.findUnique({ where: { id: ongId } });
    if (!ong) throw new NotFoundException('No encontramos esa organizacion.');

    const gastos = await this.prisma.gasto.findMany({
      where: { ongId },
      orderBy: { creadoEn: 'desc' },
      include: {
        fondo: { include: { campana: true } },
        comprobante: true,
        evidencias: true,
        analisis: { orderBy: { creadoEn: 'desc' }, take: 1 },
        revisiones: { orderBy: { creadoEn: 'desc' }, take: 1, include: { auditor: true } },
      },
    });

    const csv = aCsv(
      [
        'fecha_gasto',
        'campana',
        'fondo',
        'categoria',
        'concepto',
        'proveedor',
        'monto_declarado_pen',
        'monto_aprobado_pen',
        'estado',
        'comprobante',
        'ruc_emisor',
        'validez_cpe',
        'evidencias',
        'nivel_confianza',
        'score_final',
        'motor',
        'decision_auditor',
        'auditor',
      ],
      gastos.map((g) => {
        const analisis = g.analisis[0];
        const revision = g.revisiones[0];

        return [
          g.fechaGasto.toISOString().slice(0, 10),
          g.fondo.campana.titulo,
          g.fondo.nombre,
          g.fondo.categoriaGasto,
          g.concepto,
          g.proveedorNombre,
          soles(g.montoDeclarado),
          g.montoAprobado ? soles(g.montoAprobado) : '',
          g.estado,
          g.comprobante ? `${g.comprobante.tipo} ${g.comprobante.serie}-${g.comprobante.numero}` : '',
          g.comprobante?.rucEmisor ?? '',
          g.comprobante?.validezCpe ?? '',
          g.evidencias.length,
          analisis?.nivel ?? '',
          analisis ? Number(analisis.scoreFinal) : '',
          analisis ? 'reglas-v0' : '',
          revision?.decision ?? '',
          revision ? `${revision.auditor.nombres} ${revision.auditor.apellidos}` : '',
        ];
      }),
    );

    return { nombre: `gastos-${this.aSlug(ong.razonSocial)}.csv`, csv };
  }

  /** Resultado de la conciliacion, apto para adjuntar a un informe. */
  async conciliacionCsv(): Promise<{ nombre: string; csv: string }> {
    const resultado = await this.conciliacion.conciliar();

    const filas: ValorCsv[][] = [
      ['TOTAL', 'pagos_aprobados', resultado.totales.pagosAprobados, '', '', ''],
      ['TOTAL', 'ingresos_libro', resultado.totales.ingresosLibro, '', '', ''],
      ['TOTAL', 'comisiones', resultado.totales.comisiones, '', '', ''],
      ['TOTAL', 'retenido', resultado.totales.retenido, '', '', ''],
      ['TOTAL', 'ejecutado', resultado.totales.ejecutado, '', '', ''],
      ['TOTAL', 'aplicado_a_donaciones', resultado.totales.aplicadoADonaciones, '', '', ''],
      ...resultado.descuadres.map((d) => [
        d.severidad,
        d.comprobacion,
        d.encontrado ?? '',
        d.esperado ?? '',
        d.diferencia ?? '',
        d.descripcion,
      ]),
    ];

    const csv = aCsv(
      ['tipo', 'comprobacion', 'encontrado', 'esperado', 'diferencia', 'detalle'],
      filas,
    );

    const fecha = resultado.fecha.toISOString().slice(0, 10);
    return { nombre: `conciliacion-${fecha}.csv`, csv };
  }

  /**
   * CU17 · Informe de auditoria.
   *
   * Se devuelve como estructura y no como PDF: el informe se imprime desde
   * el navegador, que ya sabe paginar y generar PDF, en lugar de sumar una
   * dependencia de renderizado en el servidor. Los datos son los mismos y
   * el archivo resultante es igual de valido para adjuntar.
   */
  async informeAuditoria(ongId: string) {
    const ong = await this.prisma.ong.findUnique({
      where: { id: ongId },
      include: { verificador: true },
    });
    if (!ong) throw new NotFoundException('No encontramos esa organizacion.');

    const [gastos, alertas, revisiones, fondos] = await Promise.all([
      this.prisma.gasto.groupBy({
        by: ['estado'],
        where: { ongId },
        _count: { _all: true },
        _sum: { montoAprobado: true },
      }),
      this.prisma.alerta.groupBy({
        by: ['estado'],
        where: { ongId },
        _count: { _all: true },
      }),
      this.prisma.revisionAuditoria.findMany({
        where: { gasto: { ongId }, comentario: { not: '' } },
        orderBy: { creadoEn: 'desc' },
        take: 50,
        include: { auditor: true, gasto: true },
      }),
      this.prisma.fondo.findMany({
        where: { campana: { ongId } },
        include: { campana: true },
      }),
    ]);

    const cadenas = await Promise.all(fondos.map((f) => this.libro.verificarCadena(f.id)));

    return {
      generadoEn: new Date().toISOString(),
      organizacion: {
        id: ong.id,
        razonSocial: ong.razonSocial,
        ruc: ong.ruc,
        estadoVerificacion: ong.estadoVerificacion,
        verificadaEn: ong.verificadaEn,
        verificadaPor: ong.verificador
          ? `${ong.verificador.nombres} ${ong.verificador.apellidos}`
          : null,
        puntajeConfianza: soles(ong.puntajeConfianza),
      },
      fondos: fondos.map((f, i) => ({
        // Para pedir el extracto del libro de este fondo.
        id: f.id,
        campana: f.campana.titulo,
        nombre: f.nombre,
        meta: soles(f.meta),
        recaudado: soles(f.saldoRecaudado),
        retenido: soles(f.saldoRetenido),
        ejecutado: soles(f.saldoEjecutado),
        // La integridad del libro de cada fondo es lo primero que un auditor
        // externo querria confirmar antes de mirar cualquier cifra.
        cadenaIntegra: !cadenas[i].rota,
        movimientos: cadenas[i].movimientos,
      })),
      gastos: gastos.map((g) => ({
        estado: g.estado,
        cantidad: g._count._all,
        monto: soles(g._sum.montoAprobado ?? 0),
      })),
      alertas: Object.fromEntries(alertas.map((a) => [a.estado, a._count._all])),
      decisionesDeAuditoria: revisiones.map((r) => ({
        fecha: r.creadoEn,
        gasto: r.gasto.concepto,
        monto: soles(r.gasto.montoDeclarado),
        decision: r.decision,
        comentario: r.comentario,
        auditor: `${r.auditor.nombres} ${r.auditor.apellidos}`,
        esMuestreo: r.esMuestreo,
      })),
    };
  }

  private aSlug(texto: string): string {
    return texto
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
  }
}
