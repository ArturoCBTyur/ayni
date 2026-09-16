import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';

import { BitacoraService, type ContextoPeticion } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import type { RegistrarOng, VerificarOng } from './esquemas';
import {
  calcularPuntajeConfianza,
  PUNTAJE_NEUTRO,
  type PuntajeConfianza,
  type SenalesPuntaje,
} from './puntaje-confianza';

/**
 * Alta y verificacion de ONG (CU08, CU14) y su puntaje publico (RF-SO-01).
 *
 * Vive en el modulo de Campañas y Fondos porque una campaña no existe sin la
 * organizacion que la sostiene. La accion del auditor es un endpoint con rol
 * restringido, no un modulo aparte.
 */
@Injectable()
export class OngsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bitacora: BitacoraService,
  ) {}

  /**
   * Registra la ONG y deja al solicitante como su administrador.
   *
   * Nace en estado PENDIENTE: puede prepararse, pero no aparece en el
   * buscador ni puede recibir donaciones hasta que un auditor la verifique.
   * Esa es la señal sobre la que descansa toda la confianza del donante.
   */
  async registrar(usuarioId: string, datos: RegistrarOng, contexto: ContextoPeticion) {
    const existente = await this.prisma.ong.findUnique({ where: { ruc: datos.ruc } });
    if (existente) {
      throw new ConflictException(
        'Ya existe una organizacion registrada con ese RUC. Si es la suya, ' +
          'pida a su administrador que lo agregue como miembro.',
      );
    }

    const rolOngAdmin = await this.prisma.rol.findUniqueOrThrow({ where: { codigo: 'ONG_ADMIN' } });

    const ong = await this.prisma.$transaction(async (tx) => {
      const creada = await tx.ong.create({
        data: {
          ruc: datos.ruc,
          razonSocial: datos.razonSocial,
          nombreComercial: datos.nombreComercial,
          representanteLegal: datos.representanteLegal,
          documentoRepresentante: datos.documentoRepresentante,
          direccion: datos.direccion,
          departamento: datos.departamento,
          provincia: datos.provincia,
          distrito: datos.distrito,
          correoContacto: datos.correoContacto,
          telefono: datos.telefono,
          sitioWeb: datos.sitioWeb,
          descripcion: datos.descripcion,
          cuentaRecaudacion: datos.cuentaRecaudacion,
          banco: datos.banco,
          estadoVerificacion: 'PENDIENTE',
          puntajeConfianza: PUNTAJE_NEUTRO,
          terminosAceptadosEn: new Date(),
          versionTerminos: datos.versionTerminos,
          miembros: { create: { usuarioId, cargo: 'ADMINISTRADOR' } },
        },
      });

      // El solicitante pasa a ser administrador de ONG sin perder su rol de
      // donante: una misma persona puede aportar y gestionar.
      await tx.usuarioRol.upsert({
        where: { usuarioId_rolId: { usuarioId, rolId: rolOngAdmin.id } },
        update: {},
        create: { usuarioId, rolId: rolOngAdmin.id },
      });

      return creada;
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: 'ONG_REGISTRADA',
      entidad: 'ongs',
      entidadId: ong.id,
      valorNuevo: { ruc: ong.ruc, razonSocial: ong.razonSocial, estado: ong.estadoVerificacion },
      ...contexto,
    });

    return {
      id: ong.id,
      ruc: ong.ruc,
      razonSocial: ong.razonSocial,
      estadoVerificacion: ong.estadoVerificacion,
      siguientePaso:
        'Un auditor revisara la documentacion. Mientras tanto puede crear campañas en ' +
        'borrador, pero no recibir donaciones.',
    };
  }

  /** Bandeja del auditor: expedientes esperando revision (CU14). */
  async pendientesDeVerificacion() {
    const filas = await this.prisma.ong.findMany({
      where: { estadoVerificacion: { in: ['PENDIENTE', 'EN_REVISION'] } },
      orderBy: { creadoEn: 'asc' },
      include: {
        miembros: {
          where: { cargo: 'ADMINISTRADOR' },
          include: { usuario: { select: { correo: true, nombres: true, apellidos: true } } },
        },
      },
    });

    return filas.map((o) => ({
      id: o.id,
      ruc: o.ruc,
      razonSocial: o.razonSocial,
      representanteLegal: o.representanteLegal,
      departamento: o.departamento,
      estadoVerificacion: o.estadoVerificacion,
      terminosAceptadosEn: o.terminosAceptadosEn,
      solicitadoEn: o.creadoEn,
      contacto: o.miembros[0]?.usuario ?? null,
    }));
  }

  /**
   * Decision del auditor sobre la verificacion (CU14).
   *
   * El motivo es obligatorio incluso al aprobar. Una verificacion sin
   * fundamento registrado no es auditable, y es justamente lo que un
   * revisor externo preguntaria primero.
   */
  async verificar(
    ongId: string,
    auditorId: string,
    datos: VerificarOng,
    contexto: ContextoPeticion,
  ) {
    const ong = await this.prisma.ong.findUnique({ where: { id: ongId } });
    if (!ong) throw new NotFoundException('No encontramos esa organizacion.');

    if (ong.estadoVerificacion === datos.decision) {
      throw new BadRequestException(`La organizacion ya esta en estado ${datos.decision}.`);
    }

    const actualizada = await this.prisma.ong.update({
      where: { id: ongId },
      data: {
        estadoVerificacion: datos.decision,
        verificadaEn: datos.decision === 'VERIFICADA' ? new Date() : null,
        verificadaPor: auditorId,
        motivoRechazo: datos.decision === 'VERIFICADA' ? null : datos.motivo,
      },
    });

    await this.bitacora.registrar({
      usuarioId: auditorId,
      accion: 'ONG_VERIFICACION',
      entidad: 'ongs',
      entidadId: ongId,
      valorAnterior: { estadoVerificacion: ong.estadoVerificacion },
      valorNuevo: { estadoVerificacion: actualizada.estadoVerificacion, motivo: datos.motivo },
      ...contexto,
    });

    return {
      id: actualizada.id,
      estadoVerificacion: actualizada.estadoVerificacion,
      verificadaEn: actualizada.verificadaEn,
    };
  }

  /** Ficha publica de la ONG con el desglose de su puntaje (RF-SO-01). */
  async fichaPublica(ongId: string) {
    const ong = await this.prisma.ong.findUnique({
      where: { id: ongId },
      include: {
        campanas: {
          where: { estado: 'ACTIVA' },
          include: { fondos: { where: { estado: 'ACTIVO' } } },
        },
      },
    });

    if (!ong || ong.estadoVerificacion === 'RECHAZADA') {
      throw new NotFoundException('No encontramos esa organizacion.');
    }

    const puntaje = await this.calcularPuntaje(ongId);

    return {
      id: ong.id,
      ruc: ong.ruc,
      razonSocial: ong.razonSocial,
      nombreComercial: ong.nombreComercial,
      descripcion: ong.descripcion,
      departamento: ong.departamento,
      sitioWeb: ong.sitioWeb,
      logoUrl: ong.logoUrl,
      // El sello es la señal visible que sostiene la confianza institucional.
      verificada: ong.estadoVerificacion === 'VERIFICADA',
      verificadaEn: ong.verificadaEn,
      confianza: puntaje,
      campanas: ong.campanas.map((c) => ({
        id: c.id,
        slug: c.slug,
        titulo: c.titulo,
        causa: c.causa,
        fondos: c.fondos.map((f) => ({
          id: f.id,
          nombre: f.nombre,
          categoriaGasto: f.categoriaGasto,
          meta: f.meta.toString(),
          recaudado: f.saldoRecaudado.toString(),
          avance: calcularAvance(f.saldoRecaudado.toNumber(), f.meta.toNumber()),
        })),
      })),
    };
  }

  /**
   * Recalcula el puntaje a partir de la conducta observada (RF-IA-12).
   *
   * Las señales salen de la base, no de una tabla de reputacion editable:
   * el puntaje es una lectura de lo que la ONG hizo, no una nota que alguien
   * le pone.
   */
  async calcularPuntaje(ongId: string): Promise<PuntajeConfianza> {
    const [gastosAprobados, gastosConRespaldoCompleto, alertas] = await Promise.all([
      this.prisma.gasto.count({ where: { ongId, estado: 'APROBADO' } }),
      this.prisma.gasto.count({
        where: {
          ongId,
          estado: 'APROBADO',
          comprobante: { isNot: null },
          evidencias: { some: {} },
        },
      }),
      this.prisma.alerta.findMany({
        // RF-SO-04: solo las que ya vencieron su plazo de subsanacion.
        where: { ongId, afectaReputacion: true },
        select: { estado: true, creadoEn: true, resueltaEn: true },
      }),
    ]);

    const resueltas = alertas.filter((a) => a.estado === 'RESUELTA' && a.resueltaEn !== null);
    const horas = resueltas.map(
      (a) => (a.resueltaEn!.getTime() - a.creadoEn.getTime()) / 3_600_000,
    );

    const senales: SenalesPuntaje = {
      gastosAprobados,
      gastosConRespaldoCompleto,
      alertasQueAfectan: alertas.length,
      alertasResueltas: resueltas.length,
      horasPromedioRespuesta:
        horas.length > 0 ? horas.reduce((a, b) => a + b, 0) / horas.length : null,
    };

    const puntaje = calcularPuntajeConfianza(senales);

    await this.prisma.ong.update({
      where: { id: ongId },
      data: {
        puntajeConfianza: puntaje.puntaje,
        desglosePuntaje: {
          componentes: puntaje.componentes,
          historialInsuficiente: puntaje.historialInsuficiente,
          calculadoEn: new Date().toISOString(),
        },
      },
    });

    return puntaje;
  }

  /** ONG a las que pertenece el usuario, para el selector de la interfaz. */
  async misOngs(usuarioId: string) {
    const filas = await this.prisma.ongMiembro.findMany({
      where: { usuarioId, activo: true },
      include: { ong: true },
    });

    return filas.map((m) => ({
      id: m.ong.id,
      ruc: m.ong.ruc,
      razonSocial: m.ong.razonSocial,
      nombreComercial: m.ong.nombreComercial,
      estadoVerificacion: m.ong.estadoVerificacion,
      puntajeConfianza: m.ong.puntajeConfianza.toString(),
      cargo: m.cargo,
    }));
  }
}

export function calcularAvance(recaudado: number, meta: number): number {
  if (meta <= 0) return 0;
  return Math.round(Math.min((recaudado / meta) * 100, 100) * 100) / 100;
}
