import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { EstadoArco, FinalidadConsentimiento } from '@prisma/client';

import { BitacoraService, type ContextoPeticion } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import type { ActualizarConsentimiento, CrearArco, ResponderArco } from './esquemas';
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

    await this.prisma.$transaction(async (tx) => {
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
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: datos.otorgado ? 'CONSENTIMIENTO_OTORGADO' : 'CONSENTIMIENTO_REVOCADO',
      entidad: 'consentimientos',
      entidadId: usuarioId,
      valorAnterior: { finalidad: datos.finalidad, otorgado: anterior?.otorgado ?? null },
      valorNuevo: { finalidad: datos.finalidad, otorgado: datos.otorgado },
      ...contexto,
    });

    return { finalidad: datos.finalidad, otorgado: datos.otorgado, sinCambios: false };
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
