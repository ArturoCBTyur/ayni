import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import { ZodPipe } from '../../comun/validacion/zod.pipe';
import type { Configuracion } from '../../config/configuracion';
import { PermiteMfaPendiente, Publico, UsuarioActual } from './decoradores';
import {
  esquemaConfirmarTotp,
  esquemaLogin,
  esquemaRegistro,
  type ConfirmarTotp,
  type Login,
  type Registro,
} from './esquemas';
import { IdentidadService } from './identidad.service';
import { TokensService, type ParSesion } from './servicios/tokens.service';

/** Nombre de la cookie httpOnly que transporta el refresh token. */
const COOKIE_REFRESH = 'tr_refresh';

@ApiTags('identidad')
@Controller('identidad')
export class IdentidadController {
  constructor(
    private readonly identidad: IdentidadService,
    private readonly tokens: TokensService,
    private readonly config: ConfigService<Configuracion, true>,
  ) {}

  private contexto(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  /**
   * Coloca el refresh en cookie httpOnly y lo quita del cuerpo.
   *
   * Que nunca llegue al JavaScript del cliente es el punto: un XSS podria
   * robar el access token, que dura 15 minutos, pero no la sesion completa.
   */
  private responderConSesion(res: Response, sesion: ParSesion) {
    const enProduccion = this.config.get('NODE_ENV', { infer: true }) === 'production';

    res.cookie(COOKIE_REFRESH, sesion.tokenRefresh, {
      httpOnly: true,
      secure: enProduccion,
      sameSite: enProduccion ? 'none' : 'lax',
      maxAge: this.config.get('JWT_REFRESH_TTL', { infer: true }) * 1000,
      path: '/',
    });

    const { tokenRefresh: _omitido, ...publico } = sesion;
    return publico;
  }

  // 5 por minuto y 30 por hora desde la misma IP. El limite global de 120/min
  // es razonable para navegar el catalogo y ruinoso aqui: permite 7200
  // intentos de contrasena por hora contra una cuenta (ASVS V2.2.1). El
  // segundo tramo es el que importa, porque un ataque no corre a rafagas de
  // un minuto, corre durante horas.
  @Throttle({
    corto: { limit: 5, ttl: 60_000 },
    largo: { limit: 30, ttl: 3_600_000 },
  })
  @Publico()
  @Post('registro')
  @ApiOperation({ summary: 'CU01 · Registrarse y otorgar consentimiento' })
  async registrar(@Body(new ZodPipe(esquemaRegistro)) datos: Registro, @Req() req: Request) {
    return this.identidad.registrar(datos, this.contexto(req));
  }

  @Throttle({
    corto: { limit: 5, ttl: 60_000 },
    largo: { limit: 30, ttl: 3_600_000 },
  })
  @Publico()
  @Post('sesion')
  @HttpCode(200)
  @ApiOperation({ summary: 'Iniciar sesion; exige TOTP a ONG, auditor y administrador' })
  async iniciarSesion(
    @Body(new ZodPipe(esquemaLogin)) datos: Login,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { usuario, ...sesion } = await this.identidad.iniciarSesion(datos, this.contexto(req));
    return { usuario, ...this.responderConSesion(res, sesion) };
  }

  @Throttle({ corto: { limit: 20, ttl: 60_000 } })
  @Publico()
  @Post('sesion/refrescar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Canjear el refresh token por un par nuevo (rotacion)' })
  async refrescar(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = req.cookies as Record<string, string> | undefined;
    const sesion = await this.tokens.rotar(cookies?.[COOKIE_REFRESH], this.contexto(req));
    return this.responderConSesion(res, sesion);
  }

  @Publico()
  @Post('sesion/cerrar')
  @HttpCode(204)
  @ApiOperation({ summary: 'Cerrar sesion y revocar el refresh token' })
  async cerrarSesion(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const cookies = req.cookies as Record<string, string> | undefined;
    await this.tokens.revocar(cookies?.[COOKIE_REFRESH]);
    res.clearCookie(COOKIE_REFRESH, { path: '/' });
  }

  @Get('perfil')
  @ApiOperation({ summary: 'Perfil del usuario en sesion, con roles y consentimientos' })
  async perfil(@UsuarioActual('sub') usuarioId: string) {
    return this.identidad.perfil(usuarioId);
  }

  @PermiteMfaPendiente()
  @Post('mfa/iniciar')
  @ApiOperation({ summary: 'RNF-02 · Generar el QR de enrolamiento TOTP' })
  async iniciarMfa(@UsuarioActual('sub') usuarioId: string) {
    return this.identidad.iniciarEnrolamientoTotp(usuarioId);
  }

  @PermiteMfaPendiente()
  @Post('mfa/confirmar')
  @HttpCode(200)
  @ApiOperation({ summary: 'RNF-02 · Confirmar el enrolamiento con un codigo valido' })
  async confirmarMfa(
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaConfirmarTotp)) datos: ConfirmarTotp,
  ) {
    return this.identidad.confirmarEnrolamientoTotp(usuarioId, datos);
  }
}
