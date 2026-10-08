import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';

import { PrismaService } from '../../../comun/prisma/prisma.service';
import type { Configuracion } from '../../../config/configuracion';
import { TotpService } from './totp.service';

export interface CargaAcceso {
  sub: string;
  correo: string;
  roles: string[];
  /** ONG a las que pertenece, con su cargo: evita consultar en cada request. */
  ongs: Array<{ ongId: string; cargo: string }>;
  /**
   * El rol exige MFA (RNF-02) pero la cuenta aun no lo configuro.
   *
   * Existe para resolver un circulo vicioso: un auditor necesita sesion para
   * enrolar su segundo factor, pero sin segundo factor no deberia tener
   * sesion. Con esta marca, el guard concede un token que solo abre las
   * rutas de enrolamiento y nada mas.
   */
  mfaPendiente?: boolean;
}

export interface ParSesion {
  tokenAcceso: string;
  /** Se entrega en cookie httpOnly, nunca en el cuerpo de la respuesta. */
  tokenRefresh: string;
  expiraEnSegundos: number;
}

/**
 * Emision y rotacion de tokens de sesion (RNF-02).
 *
 * Dos decisiones que importan para la seguridad en web:
 *
 * 1. El access token es corto y vive en memoria del cliente. En Flutter Web
 *    no existe almacenamiento seguro: localStorage es legible por cualquier
 *    script inyectado, asi que guardarlo ahi anularia el beneficio.
 *
 * 2. El refresh token viaja en cookie httpOnly y en la base **solo se guarda
 *    su hash**. Si alguien copia la tabla sesiones, no obtiene sesiones
 *    utilizables. Cada uso rota el token y revoca el anterior, de modo que un
 *    refresh robado deja de servir en cuanto el titular vuelve a entrar.
 */
@Injectable()
export class TokensService {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Configuracion, true>,
  ) {}

  private hashRefresh(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  async emitir(
    carga: CargaAcceso,
    contexto: { ip?: string; userAgent?: string } = {},
  ): Promise<ParSesion> {
    const ttlAcceso = this.config.get('JWT_ACCESS_TTL', { infer: true });
    const ttlRefresh = this.config.get('JWT_REFRESH_TTL', { infer: true });

    const tokenAcceso = await this.jwt.signAsync(carga, {
      secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      expiresIn: ttlAcceso,
    });

    // El refresh es un valor opaco, no un JWT: no necesita transportar datos
    // y ser opaco impide que su contenido se lea desde el cliente.
    const tokenRefresh = randomBytes(48).toString('base64url');

    await this.prisma.sesion.create({
      data: {
        usuarioId: carga.sub,
        refreshHash: this.hashRefresh(tokenRefresh),
        ip: contexto.ip,
        userAgent: contexto.userAgent,
        expiraEn: new Date(Date.now() + ttlRefresh * 1000),
      },
    });

    return { tokenAcceso, tokenRefresh, expiraEnSegundos: ttlAcceso };
  }

  /**
   * Canjea un refresh por un par nuevo y revoca el usado (rotacion).
   *
   * Un token expirado, revocado o inexistente devuelve el mismo error para
   * los tres casos: distinguirlos le diria a un atacante si acerto.
   */
  async rotar(
    tokenRefresh: string | undefined,
    contexto: { ip?: string; userAgent?: string } = {},
  ): Promise<ParSesion & { mfaPendiente: boolean }> {
    if (!tokenRefresh) {
      throw new UnauthorizedException('Su sesion expiro. Vuelva a iniciar sesion.');
    }

    const sesion = await this.prisma.sesion.findUnique({
      where: { refreshHash: this.hashRefresh(tokenRefresh) },
      include: {
        usuario: {
          include: {
            roles: { include: { rol: true } },
            membresias: { where: { activo: true } },
          },
        },
      },
    });

    const invalida =
      !sesion ||
      sesion.revocadaEn !== null ||
      sesion.expiraEn < new Date() ||
      sesion.usuario.estado !== 'ACTIVO';

    if (invalida) {
      throw new UnauthorizedException('Su sesion expiro. Vuelva a iniciar sesion.');
    }

    await this.prisma.sesion.update({
      where: { id: sesion.id },
      data: { revocadaEn: new Date() },
    });

    const roles = sesion.usuario.roles.map((r) => r.rol.codigo);

    // La misma regla que al iniciar sesion. Sin esto, quien entraba solo con
    // la contraseña y aun no configuraba el segundo factor recibia un token
    // de enrolamiento, y al refrescar obtenia uno pleno: el MFA quedaba a
    // una recarga de pagina. Igual para quien gana un rol que lo exige
    // estando ya en sesion, como el donante que registra una ONG.
    const mfaPendiente = TotpService.exigeMfa(roles) && !sesion.usuario.totpHabilitado;

    const par = await this.emitir(
      {
        sub: sesion.usuario.id,
        correo: sesion.usuario.correo,
        roles,
        ongs: sesion.usuario.membresias.map((m) => ({ ongId: m.ongId, cargo: m.cargo })),
        ...(mfaPendiente ? { mfaPendiente: true } : {}),
      },
      contexto,
    );
    return { ...par, mfaPendiente };
  }

  async revocar(tokenRefresh: string | undefined): Promise<void> {
    if (!tokenRefresh) return;
    await this.prisma.sesion.updateMany({
      where: { refreshHash: this.hashRefresh(tokenRefresh), revocadaEn: null },
      data: { revocadaEn: new Date() },
    });
  }

  /** Cierra todas las sesiones del usuario: bloqueo o cambio de contraseña. */
  async revocarTodas(usuarioId: string): Promise<number> {
    const { count } = await this.prisma.sesion.updateMany({
      where: { usuarioId, revocadaEn: null },
      data: { revocadaEn: new Date() },
    });
    return count;
  }

  async verificarAcceso(token: string): Promise<CargaAcceso> {
    try {
      return await this.jwt.verifyAsync<CargaAcceso>(token, {
        secret: this.config.get('JWT_ACCESS_SECRET', { infer: true }),
      });
    } catch {
      throw new UnauthorizedException('Su sesion expiro. Vuelva a iniciar sesion.');
    }
  }
}
