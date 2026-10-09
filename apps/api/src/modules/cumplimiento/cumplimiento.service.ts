import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { EstadoArco, FinalidadConsentimiento } from '@prisma/client';

import { BitacoraService, type ContextoPeticion } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { seudonimoDe } from '../../comun/seudonimo';
import type { Configuracion } from '../../config/configuracion';
import { EncuestasService } from '../encuestas/encuestas.service';
import type { ActualizarConsentimiento, CrearArco, ResponderArco } from './esquemas';
import type { InformeCumplimiento } from './informe';
import { calcularPlazoArco, DIAS_HABILES_ARCO } from './plazos';

/**
 * Privacidad y Cumplimiento (Tabla 15).
 *
 * Reune lo que la Ley N.o 29733 obliga a poder demostrar: que se pidio
 * consentimiento por finalidad, que se puede revocar, y que las solicitudes
 * ARCO se atienden dentro de plazo.
 */
@Injectable()
export class CumplimientoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bitacora: BitacoraService,
    private readonly config: ConfigService<Configuracion, true>,
  ) {}

  /** Consentimientos vigentes del usuario, uno por finalidad. */
  async consentimientos(usuarioId: string) {
    const filas = await this.prisma.consentimiento.findMany({
      where: { usuarioId, revocadoEn: null },
      orderBy: { otorgadoEn: 'desc' },
    });

    // Puede haber historico; vale el mas reciente de cada finalidad.
    const vigentes = new Map<FinalidadConsentimiento, (typeof filas)[number]>();
    for (const fila of filas) {
      if (!vigentes.has(fila.finalidad)) vigentes.set(fila.finalidad, fila);
    }

    return [...vigentes.values()].map((c) => ({
      finalidad: c.finalidad,
      otorgado: c.otorgado,
      versionPolitica: c.versionPolitica,
      otorgadoEn: c.otorgadoEn,
    }));
  }

  /**
   * Otorga o revoca un consentimiento (RF-DE-01).
   *
   * Revocar no borra: marca el registro anterior como revocado y crea uno
   * nuevo con la decision actual. La historia completa es justamente lo que
   * hay que poder mostrar ante una fiscalizacion, y borrar el rastro dejaria
   * a la plataforma sin forma de probar que el tratamiento previo fue licito.
   */
  async actualizarConsentimiento(
    usuarioId: string,
    datos: ActualizarConsentimiento,
    contexto: ContextoPeticion,
  ) {
    if (datos.finalidad === 'TRATAMIENTO_DATOS' && !datos.otorgado) {
      throw new BadRequestException(
        'No puede revocar el tratamiento de datos sin cerrar su cuenta. ' +
          'Use una solicitud de cancelacion (ARCO) para pedir la eliminacion de sus datos.',
      );
    }

    const anterior = await this.prisma.consentimiento.findFirst({
      where: { usuarioId, finalidad: datos.finalidad, revocadoEn: null },
      orderBy: { otorgadoEn: 'desc' },
    });

    if (anterior && anterior.otorgado === datos.otorgado) {
      return { finalidad: datos.finalidad, otorgado: datos.otorgado, sinCambios: true };
    }

    const desvinculadas = await this.prisma.$transaction(async (tx) => {
      if (anterior) {
        await tx.consentimiento.update({
          where: { id: anterior.id },
          data: { revocadoEn: new Date() },
        });
      }
      await tx.consentimiento.create({
        data: {
          usuarioId,
          finalidad: datos.finalidad,
          otorgado: datos.otorgado,
          versionPolitica: datos.versionPolitica,
          ip: contexto.ip,
          userAgent: contexto.userAgent,
        },
      });

      // D6 · Revocar la investigacion desvincula lo que ya respondio, en la
      // misma transaccion: no puede quedar un instante revocado y vinculado.
      if (datos.finalidad === 'INVESTIGACION' && !datos.otorgado) {
        return EncuestasService.desvincular(
          tx,
          seudonimoDe(usuarioId, this.config.get('ENCUESTAS_CLAVE', { infer: true })),
        );
      }
      return 0;
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: datos.otorgado ? 'CONSENTIMIENTO_OTORGADO' : 'CONSENTIMIENTO_REVOCADO',
      entidad: 'consentimientos',
      entidadId: usuarioId,
      valorAnterior: { finalidad: datos.finalidad, otorgado: anterior?.otorgado ?? null },
      valorNuevo: {
        finalidad: datos.finalidad,
        otorgado: datos.otorgado,
        ...(desvinculadas > 0 ? { respuestasDesvinculadas: desvinculadas } : {}),
      },
      ...contexto,
    });

    return { finalidad: datos.finalidad, otorgado: datos.otorgado, sinCambios: false };
  }

  /**
   * RF-DE-08 · Cifras de cumplimiento de la Ley N.o 29733 en un periodo
   * [desde, hasta). Lo que estaba vigente se mide al cierre del periodo.
   */
  async informeCumplimiento(desde: Date, hasta: Date): Promise<InformeCumplimiento> {
    const enRango = { gte: desde, lt: hasta };
    const [recibidas, resueltas, vencidas, consentimientos, conEvidencia, sinAnonimizar] =
      await Promise.all([
        this.prisma.solicitudArco.findMany({ where: { creadoEn: enRango }, select: { tipo: true } }),
        this.prisma.solicitudArco.findMany({
          where: { respondidoEn: enRango, estado: { in: ['ATENDIDA', 'RECHAZADA'] } },
          select: { creadoEn: true, respondidoEn: true, plazoLimite: true },
        }),
        this.prisma.solicitudArco.count({
          where: {
            creadoEn: { lt: hasta },
            plazoLimite: { lt: hasta },
            OR: [
              { estado: { in: ['RECIBIDA', 'EN_PROCESO'] } },
              { respondidoEn: { gte: hasta } },
            ],
          },
        }),
        this.prisma.consentimiento.findMany({
          where: { otorgadoEn: { lt: hasta } },
          select: { finalidad: true, otorgado: true, otorgadoEn: true, revocadoEn: true },
        }),
        this.prisma.notificacion.count({
          where: { evidenciaId: { not: null }, creadoEn: enRango },
        }),
        this.prisma.notificacion.count({
          where: { evidencia: { anonimizada: false }, creadoEn: enRango },
        }),
      ]);

    const porTipo: Record<string, number> = {};
    for (const r of recibidas) porTipo[r.tipo] = (porTipo[r.tipo] ?? 0) + 1;
    const enPlazo = resueltas.filter((r) => r.respondidoEn! <= r.plazoLimite).length;
    const dias = resueltas.map(
      (r) => (r.respondidoEn!.getTime() - r.creadoEn.getTime()) / 86_400_000,
    );

    const finalidades: FinalidadConsentimiento[] = [
      'TRATAMIENTO_DATOS',
      'COMUNICACIONES',
      'USO_IMAGEN',
      'INVESTIGACION',
    ];
    const enElRango = (f: Date | null) => f !== null && f >= desde && f < hasta;

    return {
      periodo: { desde, hasta },
      arco: {
        recibidas: recibidas.length,
        porTipo,
        resueltas: resueltas.length,
        resueltasEnPlazo: enPlazo,
        porcentajeEnPlazo:
          resueltas.length === 0 ? null : Math.round((enPlazo / resueltas.length) * 1000) / 10,
        diasPromedioDeRespuesta:
          dias.length === 0
            ? null
            : Math.round((dias.reduce((t, d) => t + d, 0) / dias.length) * 10) / 10,
        vencidasSinResolver: vencidas,
      },
      consentimientos: finalidades.map((finalidad) => {
        const deEsta = consentimientos.filter((c) => c.finalidad === finalidad && c.otorgado);
        return {
          finalidad,
          otorgados: deEsta.filter((c) => enElRango(c.otorgadoEn)).length,
          revocados: deEsta.filter((c) => enElRango(c.revocadoEn)).length,
          vigentesAlCierre: deEsta.filter((c) => c.revocadoEn === null || c.revocadoEn >= hasta)
            .length,
        };
      }),
      der1: {
        notificacionesConEvidencia: conEvidencia,
        sinAnonimizar,
        cumple: sinAnonimizar === 0,
      },
    };
  }

  /** Registra una solicitud ARCO con su plazo legal (RF-DE-02). */
  async crearSolicitudArco(usuarioId: string, datos: CrearArco, contexto: ContextoPeticion) {
    const abierta = await this.prisma.solicitudArco.findFirst({
      where: { usuarioId, tipo: datos.tipo, estado: { in: ['RECIBIDA', 'EN_PROCESO'] } },
    });

    if (abierta) {
      throw new BadRequestException(
        `Ya tiene una solicitud de ${datos.tipo.toLowerCase()} en tramite, ` +
          `con plazo hasta el ${abierta.plazoLimite.toLocaleDateString('es-PE')}.`,
      );
    }

    const solicitud = await this.prisma.solicitudArco.create({
      data: {
        usuarioId,
        tipo: datos.tipo,
        detalle: datos.detalle,
        plazoLimite: calcularPlazoArco(datos.tipo),
      },
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: 'ARCO_SOLICITADO',
      entidad: 'solicitudes_arco',
      entidadId: solicitud.id,
      valorNuevo: { tipo: solicitud.tipo, plazoLimite: solicitud.plazoLimite.toISOString() },
      ...contexto,
    });

    return {
      id: solicitud.id,
      tipo: solicitud.tipo,
      estado: solicitud.estado,
      plazoLimite: solicitud.plazoLimite,
      diasHabiles: DIAS_HABILES_ARCO[solicitud.tipo],
    };
  }

  async misSolicitudes(usuarioId: string) {
    const filas = await this.prisma.solicitudArco.findMany({
      where: { usuarioId },
      orderBy: { creadoEn: 'desc' },
    });

    return filas.map((s) => ({
      id: s.id,
      tipo: s.tipo,
      detalle: s.detalle,
      estado: s.estado,
      plazoLimite: s.plazoLimite,
      respuesta: s.respuesta,
      respondidoEn: s.respondidoEn,
      vencida: this.estaVencida(s.estado, s.plazoLimite),
    }));
  }

  /** Bandeja del administrador, con las mas urgentes primero (CU21). */
  async bandejaArco(soloPendientes = true) {
    const filas = await this.prisma.solicitudArco.findMany({
      where: soloPendientes ? { estado: { in: ['RECIBIDA', 'EN_PROCESO'] } } : {},
      orderBy: [{ plazoLimite: 'asc' }],
      include: { usuario: { select: { correo: true, nombres: true, apellidos: true } } },
    });

    return filas.map((s) => ({
      id: s.id,
      tipo: s.tipo,
      detalle: s.detalle,
      estado: s.estado,
      plazoLimite: s.plazoLimite,
      vencida: this.estaVencida(s.estado, s.plazoLimite),
      solicitante: {
        correo: s.usuario.correo,
        nombre: `${s.usuario.nombres} ${s.usuario.apellidos}`,
      },
      creadoEn: s.creadoEn,
    }));
  }

  async responderArco(
    solicitudId: string,
    adminId: string,
    datos: ResponderArco,
    contexto: ContextoPeticion,
  ) {
    const solicitud = await this.prisma.solicitudArco.findUnique({ where: { id: solicitudId } });
    if (!solicitud) {
      throw new NotFoundException('No encontramos esa solicitud.');
    }
    if (solicitud.estado === 'ATENDIDA' || solicitud.estado === 'RECHAZADA') {
      throw new BadRequestException('Esa solicitud ya fue resuelta.');
    }

    const cierra = datos.estado === 'ATENDIDA' || datos.estado === 'RECHAZADA';

    const actualizada = await this.prisma.solicitudArco.update({
      where: { id: solicitudId },
      data: {
        estado: datos.estado,
        respuesta: datos.respuesta,
        atendidoPor: adminId,
        respondidoEn: cierra ? new Date() : null,
      },
    });

    await this.bitacora.registrar({
      usuarioId: adminId,
      accion: 'ARCO_RESPONDIDO',
      entidad: 'solicitudes_arco',
      entidadId: solicitudId,
      valorAnterior: { estado: solicitud.estado },
      valorNuevo: { estado: actualizada.estado, dentroDePlazo: !this.estaVencida('ATENDIDA', solicitud.plazoLimite, actualizada.respondidoEn) },
      ...contexto,
    });

    return {
      id: actualizada.id,
      estado: actualizada.estado,
      respondidoEn: actualizada.respondidoEn,
    };
  }

  /**
   * Exporta los datos personales del usuario (derecho de acceso).
   *
   * Incluye lo que la plataforma guarda sobre la persona, no lo que la
   * persona puede ver. Se excluyen a proposito los hashes de contraseña y
   * el secreto TOTP: son credenciales, no datos personales, y entregarlos
   * convertiria el derecho de acceso en una via de robo de cuenta.
   */
  async exportarDatos(usuarioId: string) {
    const usuario = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      include: {
        roles: { include: { rol: true } },
        consentimientos: true,
        solicitudesArco: true,
        donante: { include: { donaciones: { include: { fondo: true } }, feedback: true } },
        membresias: { include: { ong: { select: { razonSocial: true, ruc: true } } } },
      },
    });

    return {
      generadoEn: new Date().toISOString(),
      aviso:
        'Exportacion de datos personales solicitada en ejercicio del derecho de acceso ' +
        '(Ley N.o 29733). No incluye credenciales de acceso.',
      cuenta: {
        correo: usuario.correo,
        nombres: usuario.nombres,
        apellidos: usuario.apellidos,
        telefono: usuario.telefono,
        estado: usuario.estado,
        creadoEn: usuario.creadoEn,
        ultimoAccesoEn: usuario.ultimoAccesoEn,
        roles: usuario.roles.map((r) => r.rol.codigo),
      },
      consentimientos: usuario.consentimientos.map((c) => ({
        finalidad: c.finalidad,
        otorgado: c.otorgado,
        versionPolitica: c.versionPolitica,
        otorgadoEn: c.otorgadoEn,
        revocadoEn: c.revocadoEn,
      })),
      solicitudesArco: usuario.solicitudesArco.map((s) => ({
        tipo: s.tipo,
        detalle: s.detalle,
        estado: s.estado,
        creadoEn: s.creadoEn,
        respondidoEn: s.respondidoEn,
      })),
      donaciones:
        usuario.donante?.donaciones.map((d) => ({
          monto: d.monto.toString(),
          fondo: d.fondo.nombre,
          estado: d.estado,
          anonima: d.anonima,
          creadoEn: d.creadoEn,
        })) ?? [],
      organizaciones: usuario.membresias.map((m) => ({
        razonSocial: m.ong.razonSocial,
        ruc: m.ong.ruc,
        cargo: m.cargo,
      })),
    };
  }

  private estaVencida(estado: EstadoArco, plazo: Date, respondidoEn?: Date | null): boolean {
    const referencia = respondidoEn ?? new Date();
    if (estado === 'ATENDIDA' || estado === 'RECHAZADA') {
      return respondidoEn ? respondidoEn > plazo : false;
    }
    return referencia > plazo;
  }
}
