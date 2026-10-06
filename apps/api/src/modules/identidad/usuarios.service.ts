import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EstadoUsuario, Prisma } from '@prisma/client';

import type { ContextoPeticion } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import type { CambiarEstado, CambiarRoles, FiltroUsuarios, Motivo } from './esquemas';
import { TotpService } from './servicios/totp.service';

/** Lo que se carga de una cuenta para mostrarla. Nunca el hash ni el secreto. */
const SELECCION_FICHA = {
  id: true,
  correo: true,
  nombres: true,
  apellidos: true,
  estado: true,
  totpHabilitado: true,
  ultimoAccesoEn: true,
  creadoEn: true,
  roles: { select: { rol: { select: { codigo: true } } } },
  membresias: {
    where: { activo: true },
    select: {
      cargo: true,
      ong: { select: { id: true, nombreComercial: true, razonSocial: true } },
    },
  },
} satisfies Prisma.UsuarioSelect;

type FilaFicha = Prisma.UsuarioGetPayload<{ select: typeof SELECCION_FICHA }>;

/**
 * Serializa las operaciones que pueden dejar a la plataforma sin
 * administradores. Dos administradores que se quitan el rol el uno al otro
 * en el mismo segundo leerian, cada uno, que queda el otro.
 */
const LOCK_ADMINISTRADORES = 'identidad.usuarios.administradores';

/**
 * RF-16 · Gestion de usuarios por el administrador de la plataforma.
 *
 * Tres acciones: cambiar roles, bloquear o reactivar, y restablecer el
 * segundo factor. Las tres comparten cuatro reglas:
 *
 * - **Motivo obligatorio**, que queda en la bitacora junto al antes y el
 *   despues, en la misma transaccion que el cambio (RNF-08).
 * - **Nadie actua sobre su propio acceso.** Quitarse el rol de administrador,
 *   bloquearse o reiniciar el propio segundo factor lo pide a otra persona.
 *   Ademas de evitar quedarse fuera por error, es lo que impide que una
 *   sesion robada cambie el dispositivo de MFA de su victima.
 * - **Siempre queda al menos un administrador activo.**
 * - **El cambio cierra las sesiones de la cuenta.** El token de acceso lleva
 *   los roles adentro; revocar los refresh obliga a volver a entrar con los
 *   roles nuevos. El token de acceso ya emitido vale hasta que vence
 *   (JWT_ACCESS_TTL, 15 minutos): es un limite conocido y declarado en la
 *   revision ASVS, no un descuido.
 */
@Injectable()
export class UsuariosService {
  constructor(private readonly prisma: PrismaService) {}

  async listar(filtro: FiltroUsuarios) {
    // `contains` arma un ILIKE '%...%' sin escapar los comodines del propio
    // texto: buscar "_" o "%" devolvia todas las cuentas. Se buscan literal.
    const q = filtro.q?.replace(/[\\%_]/g, '\\$&');
    const where: Prisma.UsuarioWhereInput = {
      ...(filtro.estado ? { estado: filtro.estado } : {}),
      ...(filtro.rol ? { roles: { some: { rol: { codigo: filtro.rol } } } } : {}),
      ...(q
        ? {
            OR: [
              { correo: { contains: q, mode: 'insensitive' } },
              { nombres: { contains: q, mode: 'insensitive' } },
              { apellidos: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [total, filas] = await this.prisma.$transaction([
      this.prisma.usuario.count({ where }),
      this.prisma.usuario.findMany({
        where,
        select: SELECCION_FICHA,
        orderBy: [{ apellidos: 'asc' }, { nombres: 'asc' }, { id: 'asc' }],
        skip: (filtro.pagina - 1) * filtro.porPagina,
        take: filtro.porPagina,
      }),
    ]);

    return {
      total,
      pagina: filtro.pagina,
      porPagina: filtro.porPagina,
      usuarios: filas.map(ficha),
    };
  }

  /** Catalogo de roles, para que la interfaz no lo repita a mano. */
  async roles() {
    const roles = await this.prisma.rol.findMany({
      select: { codigo: true, nombre: true, descripcion: true },
      orderBy: { creadoEn: 'asc' },
    });
    return roles.map((r) => ({ ...r, exigeMfa: TotpService.exigeMfa([r.codigo]) }));
  }

  /** La ficha, con lo que la bitacora dice que se hizo sobre la cuenta. */
  async detalle(id: string) {
    const fila = await this.prisma.usuario.findUnique({ where: { id }, select: SELECCION_FICHA });
    if (!fila) throw new NotFoundException('No encontramos esa cuenta.');

    const historial = await this.prisma.bitacoraAuditoria.findMany({
      where: { entidad: 'usuarios', entidadId: id },
      orderBy: { creadoEn: 'desc' },
      take: 20,
      select: {
        accion: true,
        valorAnterior: true,
        valorNuevo: true,
        creadoEn: true,
        usuario: { select: { id: true, nombres: true, apellidos: true } },
      },
    });

    return {
      ...ficha(fila),
      historial: historial.map((h) => ({
        accion: h.accion,
        valorAnterior: h.valorAnterior,
        valorNuevo: h.valorNuevo,
        creadoEn: h.creadoEn,
        actor: h.usuario
          ? { id: h.usuario.id, nombre: `${h.usuario.nombres} ${h.usuario.apellidos}` }
          : null,
      })),
    };
  }

  async cambiarRoles(id: string, adminId: string, datos: CambiarRoles, ctx: ContextoPeticion) {
    if (id === adminId && !datos.roles.includes('ADMIN')) {
      throw new BadRequestException(
        'No puede quitarse su propio rol de administrador. Pidalo a otra persona administradora.',
      );
    }

    const catalogo = await this.prisma.rol.findMany({ where: { codigo: { in: datos.roles } } });
    if (catalogo.length !== datos.roles.length) {
      throw new BadRequestException('Alguno de los roles indicados no existe en el catalogo.');
    }

    return this.prisma.$transaction(async (tx) => {
      await bloquearAdministradores(tx);

      const actual = await cargar(tx, id);
      const antes = codigosDe(actual);
      const pedidos: readonly string[] = datos.roles;
      const quitar = antes.filter((r) => !pedidos.includes(r));
      const agregar = pedidos.filter((r) => !antes.includes(r));

      if (quitar.length === 0 && agregar.length === 0) {
        return { ...ficha(actual), sinCambios: true };
      }

      if (quitar.includes('ADMIN') && actual.estado === 'ACTIVO') {
        await exigirOtroAdministrador(tx, id);
      }

      if (quitar.length) {
        await tx.usuarioRol.deleteMany({
          where: { usuarioId: id, rol: { codigo: { in: quitar } } },
        });
      }
      if (agregar.length) {
        await tx.usuarioRol.createMany({
          data: catalogo
            .filter((r) => agregar.includes(r.codigo))
            .map((r) => ({ usuarioId: id, rolId: r.id, asignadoPor: adminId })),
        });
      }

      const sesionesCerradas = await cerrarSesiones(tx, id);

      await tx.bitacoraAuditoria.create({
        data: {
          usuarioId: adminId,
          accion: 'ROLES_ACTUALIZADOS',
          entidad: 'usuarios',
          entidadId: id,
          valorAnterior: { roles: antes },
          valorNuevo: { roles: datos.roles, motivo: datos.motivo, sesionesCerradas },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
      });

      const despues = ficha(await cargar(tx, id));
      return {
        ...despues,
        sesionesCerradas,
        advertencias: advertenciasDeRoles(despues, agregar),
      };
    });
  }

  async cambiarEstado(id: string, adminId: string, datos: CambiarEstado, ctx: ContextoPeticion) {
    if (id === adminId && datos.estado === 'BLOQUEADO') {
      throw new BadRequestException('No puede bloquear su propia cuenta.');
    }

    return this.prisma.$transaction(async (tx) => {
      await bloquearAdministradores(tx);

      const actual = await cargar(tx, id);
      if (actual.estado === datos.estado) return { ...ficha(actual), sinCambios: true };

      if (datos.estado === 'BLOQUEADO' && codigosDe(actual).includes('ADMIN')) {
        await exigirOtroAdministrador(tx, id);
      }

      await tx.usuario.update({ where: { id }, data: { estado: datos.estado } });

      // Bloquear sin cerrar las sesiones dejaria a la cuenta operando hasta
      // que su refresh venza, que son siete dias.
      const sesionesCerradas = datos.estado === 'BLOQUEADO' ? await cerrarSesiones(tx, id) : 0;

      await tx.bitacoraAuditoria.create({
        data: {
          usuarioId: adminId,
          accion: datos.estado === 'BLOQUEADO' ? 'USUARIO_BLOQUEADO' : 'USUARIO_ACTIVADO',
          entidad: 'usuarios',
          entidadId: id,
          valorAnterior: { estado: actual.estado },
          valorNuevo: { estado: datos.estado, motivo: datos.motivo, sesionesCerradas },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
      });

      return { ...ficha(await cargar(tx, id)), sesionesCerradas };
    });
  }

  /**
   * Restablece el segundo factor de una cuenta que perdio su dispositivo.
   *
   * Es la "escriba a soporte" del inicio de sesion: sin esto, a quien se le
   * perdia el celular no le quedaba forma de volver a entrar. No entrega
   * acceso: borra el secreto, y en el siguiente ingreso la persona tiene que
   * demostrar su contrasena y enrolar un dispositivo nuevo.
   */
  async restablecerMfa(id: string, adminId: string, datos: Motivo, ctx: ContextoPeticion) {
    if (id === adminId) {
      throw new BadRequestException(
        'No puede restablecer su propio segundo factor. Pidalo a otra persona administradora.',
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const actual = await tx.usuario.findUnique({
        where: { id },
        select: { totpHabilitado: true, totpSecreto: true },
      });
      if (!actual) throw new NotFoundException('No encontramos esa cuenta.');
      if (!actual.totpHabilitado && !actual.totpSecreto) {
        throw new ConflictException('Esta cuenta no tiene un segundo factor que restablecer.');
      }

      await tx.usuario.update({
        where: { id },
        data: { totpSecreto: null, totpHabilitado: false },
      });
      const sesionesCerradas = await cerrarSesiones(tx, id);

      await tx.bitacoraAuditoria.create({
        data: {
          usuarioId: adminId,
          accion: 'MFA_RESTABLECIDO',
          entidad: 'usuarios',
          entidadId: id,
          valorAnterior: { totpHabilitado: actual.totpHabilitado },
          valorNuevo: { totpHabilitado: false, motivo: datos.motivo, sesionesCerradas },
          ip: ctx.ip,
          userAgent: ctx.userAgent,
        },
      });

      return { ...ficha(await cargar(tx, id)), sesionesCerradas };
    });
  }
}

// ---------------------------------------------------------------------------

function ficha(u: FilaFicha) {
  const roles = codigosDe(u);
  const exigeMfa = TotpService.exigeMfa(roles);
  return {
    id: u.id,
    correo: u.correo,
    nombres: u.nombres,
    apellidos: u.apellidos,
    estado: u.estado,
    roles,
    totpHabilitado: u.totpHabilitado,
    exigeMfa,
    // El proximo ingreso lo llevara a enrolar el segundo factor.
    mfaPendiente: exigeMfa && !u.totpHabilitado,
    ultimoAccesoEn: u.ultimoAccesoEn,
    creadoEn: u.creadoEn,
    ongs: u.membresias.map((m) => ({
      id: m.ong.id,
      nombre: m.ong.nombreComercial ?? m.ong.razonSocial,
      cargo: m.cargo,
    })),
  };
}

function codigosDe(u: Pick<FilaFicha, 'roles'>): string[] {
  return u.roles.map((r) => r.rol.codigo);
}

/** Lo que conviene que sepa quien acaba de asignar un rol. */
function advertenciasDeRoles(despues: ReturnType<typeof ficha>, agregados: string[]): string[] {
  const avisos: string[] = [];

  // Lo que autoriza a operar una ONG es la membresia, no el rol: es lo que
  // impide que un operador vea los gastos de otra organizacion (IDOR).
  if (agregados.some((r) => r === 'ONG_ADMIN' || r === 'ONG_OPERADOR') && !despues.ongs.length) {
    avisos.push(
      'El rol de ONG no da acceso a ninguna organizacion hasta que la cuenta sea miembro de una.',
    );
  }
  if (despues.mfaPendiente) {
    avisos.push(
      'En su proximo ingreso la cuenta tendra que configurar la verificacion en dos pasos.',
    );
  }
  return avisos;
}

async function cargar(tx: Prisma.TransactionClient, id: string): Promise<FilaFicha> {
  const fila = await tx.usuario.findUnique({ where: { id }, select: SELECCION_FICHA });
  if (!fila) throw new NotFoundException('No encontramos esa cuenta.');
  return fila;
}

async function bloquearAdministradores(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${LOCK_ADMINISTRADORES}))`;
}

async function exigirOtroAdministrador(tx: Prisma.TransactionClient, id: string): Promise<void> {
  const otros = await tx.usuario.count({
    where: {
      id: { not: id },
      estado: 'ACTIVO' satisfies EstadoUsuario,
      roles: { some: { rol: { codigo: 'ADMIN' } } },
    },
  });
  if (otros === 0) {
    throw new ConflictException(
      'Es la unica cuenta administradora activa. Asigne el rol a otra persona antes de quitarlo.',
    );
  }
}

async function cerrarSesiones(tx: Prisma.TransactionClient, usuarioId: string): Promise<number> {
  const { count } = await tx.sesion.updateMany({
    where: { usuarioId, revocadaEn: null },
    data: { revocadaEn: new Date() },
  });
  return count;
}
