import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import {
  CLAVE_MFA_PENDIENTE,
  CLAVE_PUBLICO,
  CLAVE_ROLES,
  type PeticionAutenticada,
} from '../decoradores';
import { TokensService } from '../servicios/tokens.service';

/**
 * Guard global de acceso y roles.
 *
 * Niega por defecto: una ruta sin @Publico() y sin sesion valida se rechaza.
 * Es lo contrario a permitir salvo prohibicion, y en una plataforma que
 * maneja dinero de terceros y datos de beneficiarios esa asimetria importa:
 * el olvido de un decorador deja una ruta cerrada, no abierta.
 */
@Injectable()
export class AccesoGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokensService,
  ) {}

  async canActivate(contexto: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(CLAVE_PUBLICO, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (esPublico) return true;

    const peticion = contexto.switchToHttp().getRequest<PeticionAutenticada>();
    const cabecera = peticion.headers.authorization;

    if (!cabecera?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Debe iniciar sesion para realizar esta accion.');
    }

    peticion.usuario = await this.tokens.verificarAcceso(cabecera.slice(7));

    // Un token de MFA pendiente solo sirve para terminar el enrolamiento.
    if (peticion.usuario.mfaPendiente) {
      const permitido = this.reflector.getAllAndOverride<boolean>(CLAVE_MFA_PENDIENTE, [
        contexto.getHandler(),
        contexto.getClass(),
      ]);
      if (!permitido) {
        throw new ForbiddenException(
          'Complete la configuracion de verificacion en dos pasos para usar su cuenta.',
        );
      }
      return true;
    }

    const rolesRequeridos = this.reflector.getAllAndOverride<string[]>(CLAVE_ROLES, [
      contexto.getHandler(),
      contexto.getClass(),
    ]);
    if (!rolesRequeridos?.length) return true;

    const tiene = peticion.usuario.roles.some((r) => rolesRequeridos.includes(r));
    if (!tiene) {
      throw new ForbiddenException('Su rol no tiene permiso para esta accion.');
    }

    return true;
  }
}
