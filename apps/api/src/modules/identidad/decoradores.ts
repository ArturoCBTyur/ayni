import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

import type { CargaAcceso } from './servicios/tokens.service';

export const CLAVE_PUBLICO = 'es_publico';
export const CLAVE_ROLES = 'roles_requeridos';
export const CLAVE_MFA_PENDIENTE = 'permite_mfa_pendiente';

/**
 * Marca una ruta como accesible sin sesion.
 *
 * El guard de acceso es global y niega por defecto (RNF-02: minimo
 * privilegio). Que abrir una ruta requiera un acto explicito evita el error
 * mas comun en este tipo de sistema: exponer un endpoint por olvido.
 */
export const Publico = () => SetMetadata(CLAVE_PUBLICO, true);

/**
 * Permite el acceso con un token marcado como mfaPendiente.
 *
 * Solo las rutas de enrolamiento del segundo factor la llevan. Cualquier
 * otra ruta rechaza ese token, de modo que una cuenta con MFA exigido y sin
 * configurar no puede hacer nada mas que terminar de configurarlo.
 */
export const PermiteMfaPendiente = () => SetMetadata(CLAVE_MFA_PENDIENTE, true);

/** Exige que el usuario tenga al menos uno de los roles indicados. */
export const Roles = (...roles: string[]) => SetMetadata(CLAVE_ROLES, roles);

export interface PeticionAutenticada extends Request {
  usuario?: CargaAcceso;
}

/** Inyecta la carga del token en el handler. */
export const UsuarioActual = createParamDecorator(
  (campo: keyof CargaAcceso | undefined, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<PeticionAutenticada>();
    return campo ? req.usuario?.[campo] : req.usuario;
  },
);
