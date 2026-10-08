import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { BitacoraService, type ContextoPeticion } from '../../comun/bitacora/bitacora.service';
import { soles } from '../../comun/dinero';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { urlPublicable } from '../gastos/evidencia-publica';
import { ALMACENAMIENTO, type AlmacenamientoArchivos } from '../gastos/puertos/almacenamiento.port';
import { NarrativaService, type ContextoNarrativa } from './narrativa.service';

export interface ResultadoRetorno {
  gastoId: string;
  notificaciones: number;
  omitidas: Array<{ donanteId: string; motivo: string }>;
}

@Injectable()
export class RetornoService {
  private readonly logger = new Logger(RetornoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly narrativa: NarrativaService,
    private readonly bitacora: BitacoraService,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoArchivos,
  ) {}

  /**
   * CU06 · Genera una notificacion por cada donante que financio el gasto.
   *
   * Una por donante y no una general: el valor del mensaje esta en que dice
   * "S/ 40 de TU aporte pagaron esto", no "se compro alimento". Ese monto
   * sale de aplicaciones_donacion, que es el registro que hace posible la
   * trazabilidad a nivel de persona.
   *
   * Se marca transaccional: informa sobre el destino del dinero de esa
   * persona, no es una comunicacion promocional. Aun asi, la evidencia solo
   * se adjunta si esta anonimizada, y de eso se encarga la base de datos.
   */
  async notificarImpacto(gastoId: string): Promise<ResultadoRetorno> {
    const gasto = await this.prisma.gasto.findUnique({
      where: { id: gastoId },
      include: {
        ong: true,
        fondo: { include: { campana: true } },
        comprobante: true,
        evidencias: true,
        aplicaciones: {
          include: { donacion: { include: { donante: { include: { usuario: true } } } } },
        },
      },
    });

    if (!gasto) throw new NotFoundException('No encontramos ese gasto.');
    if (gasto.estado !== 'APROBADO') {
      throw new BadRequestException(
        'Solo se notifica el impacto de un gasto aprobado y verificado.',
      );
    }

    // Solo evidencias publicables. Si ninguna lo es, la narrativa se envia
    // sin foto en lugar de retrasar el aviso al donante.
    const evidencia = gasto.evidencias.find((e) => e.anonimizada) ?? null;
    const plantilla = this.narrativa.elegirPlantilla(gasto.fondo.categoriaGasto);
    const ong = gasto.ong.nombreComercial ?? gasto.ong.razonSocial;

    // El borrador del ultimo analisis: si la ONG subsano, el anterior describe
    // otro comprobante. Se revisa una vez por gasto, no por donante, porque
    // habla del gasto y no de quien lo financio.
    const analisis = await this.prisma.analisisAini.findFirst({
      where: { gastoId },
      orderBy: { creadoEn: 'desc' },
      select: { narrativaBorrador: true },
    });
    const borrador = analisis?.narrativaBorrador ?? null;
    const revision = borrador
      ? NarrativaService.revisarBorrador(borrador, [
          gasto.comprobante?.rucEmisor ?? '',
          gasto.comprobante?.serie ?? '',
          gasto.comprobante?.numero ?? '',
          gasto.comprobante ? soles(gasto.comprobante.subtotal) : '',
          gasto.comprobante ? soles(gasto.comprobante.igv) : '',
          gasto.comprobante ? soles(gasto.comprobante.total) : '',
          soles(gasto.montoDeclarado),
          gasto.proveedorNombre,
          gasto.concepto,
          ong,
        ])
      : null;
    const usaBorrador = revision?.aceptado === true;
    if (revision && !revision.aceptado) {
      this.logger.warn(
        `Gasto ${gastoId}: se descarta el borrador de AIni. ${revision.motivos.join(' ')}`,
      );
    }
    // El registro dice si el texto lleva el borrador: dos años despues tiene
    // que poder saberse quien escribio cada parrafo que leyo el donante.
    const firma = `${plantilla.codigo}@${plantilla.version}${usaBorrador ? '+aini' : ''}`;

    const notificaciones: string[] = [];
    const omitidas: ResultadoRetorno['omitidas'] = [];

    for (const aplicacion of gasto.aplicaciones) {
      const donante = aplicacion.donacion.donante;

      const yaNotificado = await this.prisma.notificacion.findFirst({
        where: { aplicacionId: aplicacion.id, tipo: 'IMPACTO' },
      });
      if (yaNotificado) {
        omitidas.push({ donanteId: donante.id, motivo: 'ya notificado' });
        continue;
      }

      // RF-PS-04: quien pidio resumen semanal o mensual no recibe un aviso
      // por cada gasto. La notificacion se crea igual, para que aparezca en
      // su historial, pero no se envia por correo.
      const inmediata = donante.frecuenciaNotificacion === 'CADA_GASTO';

      const contexto: ContextoNarrativa = {
        donante: donante.alias ?? donante.usuario.nombres,
        monto: soles(aplicacion.monto),
        concepto: gasto.concepto,
        proveedor: gasto.proveedorNombre,
        fecha: gasto.fechaGasto.toLocaleDateString('es-PE'),
        ong,
        fondo: gasto.fondo.nombre,
        campana: gasto.fondo.campana.titulo,
      };

      const { asunto, cuerpo } = this.narrativa.redactar(
        plantilla,
        contexto,
        usaBorrador ? borrador : null,
      );

      const notificacion = await this.prisma.notificacion.create({
        data: {
          usuarioId: donante.usuarioId,
          tipo: 'IMPACTO',
          canal: 'IN_APP',
          asunto,
          cuerpo,
          narrativa: cuerpo,
          gastoId: gasto.id,
          donacionId: aplicacion.donacionId,
          aplicacionId: aplicacion.id,
          evidenciaId: evidencia?.id ?? null,
          montoAplicado: aplicacion.monto,
          plantilla: firma,
          // Informa sobre el destino del dinero de esta persona: no es
          // comunicacion promocional.
          transaccional: true,
          estado: inmediata ? 'ENVIADA' : 'PENDIENTE',
          enviadaEn: inmediata ? new Date() : null,
        },
      });

      notificaciones.push(notificacion.id);
    }

    await this.bitacora.registrar({
      accion: 'RETORNO_NOTIFICADO',
      entidad: 'gastos',
      entidadId: gastoId,
      valorNuevo: {
        notificaciones: notificaciones.length,
        plantilla: firma,
        borrador: usaBorrador ? 'usado' : revision ? 'rechazado' : 'ausente',
        ...(revision && !revision.aceptado ? { motivosRechazo: revision.motivos } : {}),
        conEvidencia: evidencia !== null,
      },
    });

    this.logger.log(
      `Gasto ${gastoId}: ${notificaciones.length} donante(s) notificados con ${firma}.`,
    );

    return { gastoId, notificaciones: notificaciones.length, omitidas };
  }

  /** Bandeja de notificaciones del donante. */
  async bandeja(usuarioId: string, soloNoLeidas = false) {
    const notificaciones = await this.prisma.notificacion.findMany({
      where: { usuarioId, ...(soloNoLeidas ? { leidaEn: null } : {}) },
      orderBy: { creadoEn: 'desc' },
      take: 50,
      include: {
        gasto: { include: { ong: true, fondo: true } },
        evidencia: true,
      },
    });

    return notificaciones.map((n) => ({
      id: n.id,
      tipo: n.tipo,
      asunto: n.asunto,
      narrativa: n.narrativa ?? n.cuerpo,
      montoAplicado: n.montoAplicado ? soles(n.montoAplicado) : null,
      leida: n.leidaEn !== null,
      creadoEn: n.creadoEn,
      ong: n.gasto?.ong.nombreComercial ?? n.gasto?.ong.razonSocial ?? null,
      fondo: n.gasto?.fondo.nombre ?? null,
      // Solo se expone la version anonimizada; el original no sale de aqui.
      // La base ya impide asociar una evidencia sin anonimizar (RNF-06).
      evidencia: n.evidencia
        ? {
            id: n.evidencia.id,
            anonimizada: n.evidencia.anonimizada,
            url: urlPublicable(this.almacen, n.evidencia),
          }
        : null,
      gastoId: n.gastoId,
    }));
  }

  async marcarLeida(notificacionId: string, usuarioId: string) {
    const { count } = await this.prisma.notificacion.updateMany({
      where: { id: notificacionId, usuarioId, leidaEn: null },
      data: { leidaEn: new Date() },
    });
    return { actualizada: count > 0 };
  }

  /**
   * CU07 · El donante valora la evidencia o reporta una inconsistencia.
   *
   * RF-SO-02 convierte al donante en agente de fiscalizacion: reportar abre
   * un caso real de auditoria, no un buzon de quejas. Es lo que sostiene el
   * "control social" que la dimension sociologica del proyecto propone.
   */
  async registrarFeedback(
    usuarioId: string,
    datos: {
      notificacionId?: string;
      gastoId?: string;
      valoracion?: number;
      comentario?: string;
      reportaInconsistencia: boolean;
    },
    contexto: ContextoPeticion,
  ) {
    const donante = await this.prisma.donante.findUnique({ where: { usuarioId } });
    if (!donante) throw new NotFoundException('No encontramos su perfil de donante.');

    if (datos.reportaInconsistencia && !datos.comentario?.trim()) {
      throw new BadRequestException(
        'Para reportar una inconsistencia necesitamos que describa que observo.',
      );
    }

    // Se resuelve el gasto desde la notificacion si no vino explicito.
    let gastoId = datos.gastoId ?? null;
    if (!gastoId && datos.notificacionId) {
      const n = await this.prisma.notificacion.findFirst({
        where: { id: datos.notificacionId, usuarioId },
      });
      gastoId = n?.gastoId ?? null;
    }

    let alertaId: string | null = null;

    if (datos.reportaInconsistencia && gastoId) {
      const gasto = await this.prisma.gasto.findUniqueOrThrow({ where: { id: gastoId } });

      const alerta = await this.prisma.alerta.create({
        data: {
          ongId: gasto.ongId,
          gastoId,
          tipo: 'REPORTE_DONANTE',
          severidad: 'MEDIA',
          titulo: 'Un donante reporto una inconsistencia',
          descripcion: datos.comentario!.trim(),
          estado: 'ABIERTA',
          plazoSubsanacion: new Date(Date.now() + 5 * 86_400_000),
          // Un reporte no comprobado no puede manchar a la ONG: primero se
          // revisa, igual que cualquier otra observacion (RF-SO-04).
          afectaReputacion: false,
        },
      });
      alertaId = alerta.id;

      // El gasto vuelve a revision humana: lo reporto una persona, asi que
      // lo resuelve una persona.
      await this.prisma.gasto.updateMany({
        where: { id: gastoId, estado: 'APROBADO' },
        data: { estado: 'EN_REVISION' },
      });
    }

    const feedback = await this.prisma.feedbackDonante.create({
      data: {
        donanteId: donante.id,
        notificacionId: datos.notificacionId,
        gastoId,
        valoracion: datos.valoracion,
        comentario: datos.comentario,
        reportaInconsistencia: datos.reportaInconsistencia,
        alertaGeneradaId: alertaId,
      },
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: datos.reportaInconsistencia ? 'DONANTE_REPORTA' : 'DONANTE_VALORA',
      entidad: 'feedback_donante',
      entidadId: feedback.id,
      valorNuevo: { gastoId, valoracion: datos.valoracion ?? null, alertaId },
      ...contexto,
    });

    return {
      id: feedback.id,
      alertaGenerada: alertaId,
      mensaje: alertaId
        ? 'Gracias. Un auditor revisara el caso y le informaremos del resultado.'
        : 'Gracias por su valoracion.',
    };
  }

  /**
   * RF-IA-10 · Recomienda fondos, sin ML y sin presion comercial.
   *
   * Por afinidad simple: causas y categorias a las que esta persona ya
   * aporto, en ONG verificadas y con campañas activas. Se excluyen los
   * fondos en los que ya participa, porque recomendarle lo que ya hace no
   * le aporta nada.
   */
  async recomendarFondos(usuarioId: string, limite = 4) {
    const donante = await this.prisma.donante.findUnique({ where: { usuarioId } });
    if (!donante) return [];

    const historial = await this.prisma.donacion.findMany({
      where: { donanteId: donante.id, estado: 'CONFIRMADA' },
      include: { fondo: { include: { campana: true } } },
    });

    if (historial.length === 0) return [];

    const causas = [...new Set(historial.map((d) => d.fondo.campana.causa))];
    const categorias = [...new Set(historial.map((d) => d.fondo.categoriaGasto))];
    const yaApoyados = historial.map((d) => d.fondoId);

    const candidatos = await this.prisma.fondo.findMany({
      where: {
        id: { notIn: yaApoyados },
        estado: 'ACTIVO',
        campana: {
          estado: 'ACTIVA',
          ong: { estadoVerificacion: 'VERIFICADA' },
          OR: [{ causa: { in: causas } }],
        },
        OR: [{ categoriaGasto: { in: categorias } }, {}],
      },
      include: { campana: { include: { ong: true } } },
      orderBy: { creadoEn: 'desc' },
      take: limite,
    });

    return candidatos.map((f) => ({
      id: f.id,
      nombre: f.nombre,
      categoriaGasto: f.categoriaGasto,
      meta: soles(f.meta),
      recaudado: soles(f.saldoRecaudado),
      campana: { titulo: f.campana.titulo, slug: f.campana.slug },
      ong: f.campana.ong.nombreComercial ?? f.campana.ong.razonSocial,
      // Se dice por que se recomienda: una sugerencia sin motivo se parece
      // demasiado a publicidad.
      motivo: causas.includes(f.campana.causa)
        ? `Ya apoyaste causas de ${f.campana.causa}.`
        : `Coincide con el tipo de gasto que sueles financiar.`,
    }));
  }
}
