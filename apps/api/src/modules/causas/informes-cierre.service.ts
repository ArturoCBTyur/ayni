import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import { create as crearQr } from 'qrcode';
import sharp from 'sharp';

import { jsonCanonico, sha256 } from '../../comun/canonico';
import { soles } from '../../comun/dinero';
import { DocumentoPdf } from '../../comun/formatos/pdf';
import { fechaEnLima } from '../../comun/periodo';
import { PrismaService } from '../../comun/prisma/prisma.service';
import type { Configuracion } from '../../config/configuracion';
import { balanceComprobacion, type EstadoMensual } from '../analitica/estados.service';
import { enSoles } from '../analitica/estados.render';
import { clasificacionCuadra, clasificarSaldos } from '../contable/clasificacion';
import { LibroService } from '../contable/libro.service';
import { objetoPublicable } from '../gastos/evidencia-publica';
import { calcularImpacto, type Impacto } from '../gastos/impacto';
import { ALMACENAMIENTO, type AlmacenamientoArchivos } from '../gastos/puertos/almacenamiento.port';
import { DESTINO_POR_DEFECTO, DIAS_ELECCION, DIAS_JUSTIFICACION } from './politica';

export const VERSION_INFORME = 2;

/** Fotos que entran al PDF: una por gasto, hasta este total, para que pese poco. */
const FOTOS_MAXIMAS = 12;

/**
 * RF-CF-12 · Lo que dice el informe de cierre de una causa.
 *
 * Como un cierre mensual: todo importe es texto y no hay marca de tiempo de
 * cuando se genero, fuera de las del propio cierre. Es publico (lo enlaza el
 * QR), asi que no nombra a ningun donante, y de un proveedor que es persona
 * natural no da el nombre ni el RUC.
 */
export interface InformeContenido {
  version: number;
  id: string;
  verificacion: { url: string };
  cierre: {
    id: string;
    iniciadoEn: string;
    venceJustificacionEn: string;
    resueltoEn: string;
    politica: {
      diasJustificacion: number;
      diasEleccion: number;
      destinoPorDefecto: string;
      decision: string;
    };
  };
  fondo: EstadoMensual['fondo'];
  resumen: {
    donaciones: number;
    donantes: number;
    gastosAprobados: number;
    recaudadoBruto: string;
    comisiones: string;
    recibidoPorTraslado: string;
    liberados: string;
    devuelto: string;
    trasladado: string;
    conRestriccion: string;
    particionCuadra: boolean;
  };
  balanceComprobacion: EstadoMensual['balanceComprobacion'];
  /** RF-SO-09 · Costo por unidad de impacto, si la categoria del fondo la mide (D4). */
  impacto: Impacto | null;
  gastos: Array<{
    id: string;
    fecha: string;
    concepto: string;
    proveedor: string;
    monto: string;
    unidadesImpacto: number | null;
    comprobante: { tipo: string; serie: string; numero: string; rucEmisor: string | null } | null;
    /** El SHA-256 del archivo que se publica, para que nadie lo cambie despues. */
    evidencias: Array<{ id: string; sha256: string | null }>;
  }>;
  remanente: {
    total: string;
    devolucion: { monto: string; donaciones: number; porDefecto: number };
    traslado: {
      monto: string;
      donaciones: number;
      fondos: Array<{ id: string; nombre: string; monto: string }>;
    };
  };
  cierresMensuales: Array<{ periodo: string; hash: string }>;
  libro: {
    movimientos: number;
    ultimaSecuencia: number | null;
    hashUltimo: string | null;
    cadenaIntegra: boolean;
  };
}

export interface Verificacion {
  informe: { id: string; hash: string; creadoEn: Date };
  fondo: string;
  ong: string;
  hashRecalculado: string;
  hashCoincide: boolean;
  cadena: { integra: boolean; movimientos: number };
  ultimoMovimiento: { secuencia: number | null; coincide: boolean };
  movimientosPosteriores: number;
  /** En una frase, si el informe se sostiene. */
  conclusion: string;
  sostiene: boolean;
}

/** Lo que paga un recibo por honorarios es una persona: el informe publico no la nombra. */
function proveedorPublico(tipo: string | undefined, nombre: string): string {
  return tipo === 'RECIBO_HONORARIOS' ? 'Persona natural (recibo por honorarios)' : nombre;
}

@Injectable()
export class InformesCierreService {
  private readonly logger = new Logger(InformesCierreService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly libro: LibroService,
    private readonly config: ConfigService<Configuracion, true>,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoArchivos,
  ) {}

  urlDeVerificacion(id: string): string {
    const base = this.config.get('API_URL_PUBLICA', { infer: true }).replace(/\/$/, '');
    const prefijo = this.config.get('API_PREFIX', { infer: true });
    return `${base}/${prefijo}/publico/informes/${id}`;
  }

  /** Arma, congela y guarda el informe de un cierre resuelto. Idempotente. */
  async generar(cierreId: string): Promise<{ id: string; hash: string }> {
    const existente = await this.prisma.informeCierre.findUnique({ where: { cierreId } });
    if (existente) return { id: existente.id, hash: existente.hashContenido };

    const contenido = jsonCanonico(await this.armar(cierreId, randomUUID()));
    const { id } = JSON.parse(contenido) as InformeContenido;
    const hash = sha256(contenido);
    const cierre = await this.prisma.cierreCausa.findUniqueOrThrow({ where: { id: cierreId } });

    // La base vuelve a comprobar que el hash sea el del contenido y que el
    // contenido sea de este fondo y este cierre.
    await this.prisma.informeCierre.create({
      data: { id, cierreId, fondoId: cierre.fondoId, contenido, hashContenido: hash },
    });
    return { id, hash };
  }

  async contenido(
    id: string,
  ): Promise<{ contenido: InformeContenido; hash: string; creadoEn: Date }> {
    const fila = await this.prisma.informeCierre.findUnique({ where: { id } });
    if (!fila) throw new NotFoundException('No encontramos ese informe.');
    return {
      contenido: JSON.parse(fila.contenido) as InformeContenido,
      hash: fila.hashContenido,
      creadoEn: fila.creadoEn,
    };
  }

  private async armar(cierreId: string, id: string): Promise<InformeContenido> {
    const cierre = await this.prisma.cierreCausa.findUniqueOrThrow({
      where: { id: cierreId },
      include: {
        fondo: { include: { campana: { include: { ong: true } } } },
        remanentes: { include: { fondoDestino: true } },
      },
    });
    const { fondo } = cierre;
    const fondoId = fondo.id;

    const [sumas, donaciones, gastos, cierresMensuales, ultimo, movimientos, cadena] =
      await Promise.all([
        this.libro.sumasPorTipo(fondoId, {}),
        this.prisma.donacion.findMany({
          where: { fondoId, estado: 'CONFIRMADA' },
          select: { donanteId: true },
        }),
        this.prisma.gasto.findMany({
          where: { fondoId, estado: 'APROBADO' },
          orderBy: [{ fechaGasto: 'asc' }, { creadoEn: 'asc' }],
          include: { comprobante: true, evidencias: { orderBy: { creadoEn: 'asc' } } },
        }),
        this.prisma.cierreMensual.findMany({
          where: { fondoId },
          orderBy: { periodo: 'asc' },
          select: { periodo: true, hashContenido: true },
        }),
        this.prisma.movimientoContable.findFirst({
          where: { fondoId },
          orderBy: { secuencia: 'desc' },
          select: { secuencia: true, hashActual: true },
        }),
        this.prisma.movimientoContable.count({ where: { fondoId } }),
        this.libro.verificarCadena(fondoId),
      ]);
    const saldos = clasificarSaldos(sumas);

    const evidencias = async (lista: (typeof gastos)[number]['evidencias']) => {
      const salida: Array<{ id: string; sha256: string | null }> = [];
      for (const e of lista) {
        const objeto = objetoPublicable(e);
        if (!objeto) continue;
        try {
          salida.push({ id: e.id, sha256: sha256Bytes(await this.almacen.leer(objeto)) });
        } catch {
          // El informe dice que la foto existia y no se pudo leer, en vez de
          // omitirla en silencio.
          salida.push({ id: e.id, sha256: null });
        }
      }
      return salida;
    };

    const devueltos = cierre.remanentes.filter((r) => r.destino === 'DEVOLUCION');
    const trasladados = cierre.remanentes.filter((r) => r.destino === 'REASIGNACION');
    const suma = (lista: typeof cierre.remanentes) =>
      lista.reduce((t, r) => t.plus(r.monto), new Prisma.Decimal(0));
    const porFondo = new Map<string, { id: string; nombre: string; monto: Prisma.Decimal }>();
    for (const r of trasladados) {
      const actual = porFondo.get(r.fondoDestinoId!) ?? {
        id: r.fondoDestinoId!,
        nombre: r.fondoDestino!.nombre,
        monto: new Prisma.Decimal(0),
      };
      actual.monto = actual.monto.plus(r.monto);
      porFondo.set(actual.id, actual);
    }

    return {
      version: VERSION_INFORME,
      id,
      verificacion: { url: this.urlDeVerificacion(id) },
      cierre: {
        id: cierre.id,
        iniciadoEn: cierre.iniciadoEn.toISOString(),
        venceJustificacionEn: cierre.venceJustificacionEn.toISOString(),
        resueltoEn: (cierre.resueltoEn ?? new Date()).toISOString(),
        politica: {
          diasJustificacion: DIAS_JUSTIFICACION,
          diasEleccion: DIAS_ELECCION,
          destinoPorDefecto: DESTINO_POR_DEFECTO,
          decision: 'D2 de ADR-0007, propuesta sin firma de Derecho ni Contabilidad',
        },
      },
      fondo: {
        id: fondo.id,
        nombre: fondo.nombre,
        categoriaGasto: fondo.categoriaGasto,
        campana: { id: fondo.campana.id, titulo: fondo.campana.titulo },
        ong: {
          id: fondo.campana.ong.id,
          razonSocial: fondo.campana.ong.razonSocial,
          ruc: fondo.campana.ong.ruc,
        },
      },
      resumen: {
        donaciones: donaciones.length,
        donantes: new Set(donaciones.map((d) => d.donanteId)).size,
        gastosAprobados: gastos.length,
        recaudadoBruto: soles(saldos.recaudadoBruto),
        comisiones: soles(saldos.comisiones),
        recibidoPorTraslado: soles(saldos.recibidoPorTraslado),
        liberados: soles(saldos.liberados),
        devuelto: soles(saldos.devuelto),
        trasladado: soles(saldos.trasladado),
        conRestriccion: soles(saldos.conRestriccion),
        particionCuadra: clasificacionCuadra(saldos),
      },
      balanceComprobacion: balanceComprobacion(sumas),
      impacto:
        calcularImpacto(
          gastos.map((g) => ({
            categoria: fondo.categoriaGasto,
            monto: g.montoAprobado ?? g.montoDeclarado,
            unidades: g.unidadesImpacto,
          })),
        )[0] ?? null,
      gastos: await Promise.all(
        gastos.map(async (g) => ({
          id: g.id,
          fecha: g.fechaGasto.toISOString().slice(0, 10),
          concepto: g.concepto,
          proveedor: proveedorPublico(g.comprobante?.tipo, g.proveedorNombre),
          monto: soles(g.montoAprobado ?? g.montoDeclarado),
          unidadesImpacto: g.unidadesImpacto,
          comprobante: g.comprobante
            ? {
                tipo: g.comprobante.tipo,
                serie: g.comprobante.serie,
                numero: g.comprobante.numero,
                rucEmisor:
                  g.comprobante.tipo === 'RECIBO_HONORARIOS' ? null : g.comprobante.rucEmisor,
              }
            : null,
          evidencias: await evidencias(g.evidencias),
        })),
      ),
      remanente: {
        total: soles(cierre.remanenteTotal ?? 0),
        devolucion: {
          monto: soles(suma(devueltos)),
          donaciones: devueltos.length,
          porDefecto: devueltos.filter((r) => r.elegidoPor !== 'DONANTE').length,
        },
        traslado: {
          monto: soles(suma(trasladados)),
          donaciones: trasladados.length,
          fondos: [...porFondo.values()]
            .sort((a, b) => (a.id < b.id ? -1 : 1))
            .map((f) => ({ id: f.id, nombre: f.nombre, monto: soles(f.monto) })),
        },
      },
      cierresMensuales: cierresMensuales.map((c) => ({
        periodo: c.periodo,
        hash: c.hashContenido,
      })),
      libro: {
        movimientos,
        ultimaSecuencia: ultimo ? Number(ultimo.secuencia) : null,
        hashUltimo: ultimo?.hashActual ?? null,
        cadenaIntegra: !cadena.rota,
      },
    };
  }

  /**
   * RF-IN-05 · Lo que la pagina publica comprueba, ahora, frente al libro.
   *
   * No le cree al informe: recalcula su hash, recalcula la cadena del fondo
   * con la funcion de la base y busca en el libro el ultimo movimiento que el
   * informe dice haber visto, con su hash. Si alguien asento despues del
   * cierre, tambien lo dice.
   */
  async verificar(id: string): Promise<Verificacion> {
    const fila = await this.prisma.informeCierre.findUnique({ where: { id } });
    if (!fila) throw new NotFoundException('No encontramos ese informe.');
    const contenido = JSON.parse(fila.contenido) as InformeContenido;
    const fondoId = contenido.fondo.id;

    const [cadena, enLibro, posteriores] = await Promise.all([
      this.libro.verificarCadena(fondoId),
      contenido.libro.ultimaSecuencia === null
        ? null
        : this.prisma.movimientoContable.findUnique({
            where: {
              fondoId_secuencia: { fondoId, secuencia: BigInt(contenido.libro.ultimaSecuencia) },
            },
            select: { hashActual: true },
          }),
      this.prisma.movimientoContable.count({
        where: { fondoId, secuencia: { gt: BigInt(contenido.libro.ultimaSecuencia ?? 0) } },
      }),
    ]);

    const hashRecalculado = sha256(fila.contenido);
    const hashCoincide = hashRecalculado === fila.hashContenido;
    const ultimoCoincide =
      contenido.libro.ultimaSecuencia === null ||
      enLibro?.hashActual === contenido.libro.hashUltimo;
    const sostiene = hashCoincide && !cadena.rota && ultimoCoincide;

    return {
      informe: { id: fila.id, hash: fila.hashContenido, creadoEn: fila.creadoEn },
      fondo: contenido.fondo.nombre,
      ong: contenido.fondo.ong.razonSocial,
      hashRecalculado,
      hashCoincide,
      cadena: { integra: !cadena.rota, movimientos: cadena.movimientos },
      ultimoMovimiento: { secuencia: contenido.libro.ultimaSecuencia, coincide: ultimoCoincide },
      movimientosPosteriores: posteriores,
      sostiene,
      conclusion: sostiene
        ? posteriores > 0
          ? `El informe se sostiene, pero el fondo tiene ${posteriores} movimiento(s) posteriores al cierre.`
          : 'El informe se sostiene: su hash, la cadena del fondo y el libro coinciden.'
        : 'El informe NO se sostiene: el libro ya no dice lo mismo que dijo al cerrar.',
    };
  }

  /** El PDF del informe, con las fotos publicables y el QR de su verificacion. */
  async pdf(id: string): Promise<Buffer> {
    const { contenido: c, hash } = await this.contenido(id);
    const pdf = new DocumentoPdf(`Informe de cierre · ${c.fondo.nombre}`);
    const derecha = DocumentoPdf.ANCHO_UTIL;
    const fila = (concepto: string, monto: string, negrita = false) =>
      pdf.fila([
        { texto: concepto, negrita },
        { texto: enSoles(monto), x: derecha, alineacion: 'derecha', negrita },
      ]);

    pdf.linea('Informe de cierre de la causa', { tamano: 16, negrita: true });
    pdf.linea(`${c.fondo.nombre} · ${c.fondo.campana.titulo}`, { tamano: 11 });
    pdf.linea(`${c.fondo.ong.razonSocial} · RUC ${c.fondo.ong.ruc}`, { gris: true });
    pdf.linea(
      `Cerrada el ${fechaEnLima(new Date(c.cierre.iniciadoEn))}; resuelta el ` +
        `${fechaEnLima(new Date(c.cierre.resueltoEn))}.`,
      { gris: true },
    );
    pdf.espacio(6).raya();

    pdf.linea('Resumen', { tamano: 13, negrita: true });
    pdf.linea(
      `${c.resumen.donaciones} donaciones de ${c.resumen.donantes} donantes; ` +
        `${c.resumen.gastosAprobados} gastos aprobados.`,
    );
    fila('Recaudado (bruto)', c.resumen.recaudadoBruto);
    fila('Recibido del cierre de otras causas', c.resumen.recibidoPorTraslado);
    fila('Comisiones de la pasarela', c.resumen.comisiones);
    fila('Ejecutado contra gasto verificado', c.resumen.liberados, true);
    fila('Devuelto a sus donantes', c.resumen.devuelto);
    fila('Trasladado a otras causas', c.resumen.trasladado);
    fila('Pendiente de justificar', c.resumen.conRestriccion);
    if (c.impacto?.costoPorUnidad) {
      pdf.espacio(4);
      fila(`Costo por unidad de impacto (${c.impacto.unidad})`, c.impacto.costoPorUnidad, true);
      pdf.linea(
        `${c.impacto.unidades} ${c.impacto.unidad}, declarados en ${c.impacto.gastosConUnidades} ` +
          `de ${c.impacto.gastosAprobados} gastos aprobados.`,
        { tamano: 8, gris: true },
      );
    }
    pdf.espacio(10);

    pdf.linea('Remanente y su destino', { tamano: 13, negrita: true });
    fila('Remanente al vencer el plazo', c.remanente.total, true);
    fila(
      `Devuelto (${c.remanente.devolucion.donaciones} aportes, ` +
        `${c.remanente.devolucion.porDefecto} sin elección del donante)`,
      c.remanente.devolucion.monto,
    );
    fila(`Trasladado (${c.remanente.traslado.donaciones} aportes)`, c.remanente.traslado.monto);
    for (const f of c.remanente.traslado.fondos) fila(`    a ${f.nombre}`, f.monto);
    pdf.parrafo(
      `Política aplicada: ${c.cierre.politica.diasJustificacion} días para justificar y ` +
        `${c.cierre.politica.diasEleccion} para que cada donante elija; sin elección, ` +
        `${c.cierre.politica.destinoPorDefecto === 'DEVOLUCION' ? 'devolución' : 'traslado'}. ` +
        `${c.cierre.politica.decision}.`,
      { tamano: 8, gris: true },
    );
    pdf.espacio(10);

    pdf.linea('Gastos verificados', { tamano: 13, negrita: true });
    if (c.gastos.length === 0) pdf.linea('Ningún gasto aprobado.', { gris: true });
    let fotos = 0;
    for (const g of c.gastos) {
      fila(`${g.fecha.split('-').reverse().join('/')} · ${g.concepto}`, g.monto);
      const comprobante = g.comprobante
        ? `${g.comprobante.tipo} ${g.comprobante.serie}-${g.comprobante.numero}` +
          (g.comprobante.rucEmisor ? ` · RUC ${g.comprobante.rucEmisor}` : '')
        : 'sin comprobante';
      pdf.linea(`${g.proveedor} · ${comprobante}`, { tamano: 8, gris: true, x: 12 });

      const foto = g.evidencias.find((e) => e.sha256);
      if (foto && fotos < FOTOS_MAXIMAS) {
        const miniatura = await this.miniatura(foto.id);
        if (miniatura) {
          pdf.imagen(miniatura.jpeg, miniatura, 150, 12);
          fotos += 1;
        }
      }
    }
    pdf.espacio(10);

    pdf.linea('Cómo verificar este informe', { tamano: 13, negrita: true });
    pdf.parrafo(
      'Escanee el código o abra la dirección: la página recalcula ahora el hash de este ' +
        'informe y la cadena de hashes del fondo, sin confiar en lo que dice este papel.',
      { tamano: 9 },
    );
    pdf.qr(modulosQr(c.verificacion.url), 110);
    pdf.linea(c.verificacion.url, { tamano: 7 });
    pdf.linea(`Hash del informe: ${hash}`, { tamano: 7 });
    pdf.linea(
      `Último movimiento del libro: ${c.libro.ultimaSecuencia ?? 'ninguno'} · ${c.libro.hashUltimo ?? ''}`,
      { tamano: 7 },
    );
    pdf.linea(
      `Cierres mensuales encadenados: ${c.cierresMensuales.length}` +
        (c.cierresMensuales.length
          ? `, el último de ${c.cierresMensuales[c.cierresMensuales.length - 1].periodo}`
          : ''),
      { tamano: 7 },
    );

    return pdf.generar();
  }

  /** Miniatura JPEG en sRGB de la version publicable de una evidencia. */
  private async miniatura(
    evidenciaId: string,
  ): Promise<{ jpeg: Buffer; ancho: number; alto: number } | null> {
    const evidencia = await this.prisma.evidencia.findUnique({ where: { id: evidenciaId } });
    const objeto = evidencia ? objetoPublicable(evidencia) : null;
    if (!objeto) return null;
    try {
      const { data, info } = await sharp(await this.almacen.leer(objeto))
        .rotate()
        .resize({ width: 480, height: 360, fit: 'inside', withoutEnlargement: true })
        .toColourspace('srgb')
        .jpeg({ quality: 72 })
        .toBuffer({ resolveWithObject: true });
      return { jpeg: data, ancho: info.width, alto: info.height };
    } catch (e) {
      this.logger.warn(`No se pudo preparar la foto ${evidenciaId}: ${(e as Error).message}`);
      return null;
    }
  }
}

/** SHA-256 de un archivo, sobre sus bytes y no sobre un texto. */
function sha256Bytes(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** La matriz de un QR, fila por fila. Correccion M: aguanta un papel algo gastado. */
export function modulosQr(texto: string): boolean[][] {
  const { modules } = crearQr(texto, { errorCorrectionLevel: 'M' });
  return Array.from({ length: modules.size }, (_, f) =>
    Array.from({ length: modules.size }, (_, c) => modules.get(f, c) === 1),
  );
}
