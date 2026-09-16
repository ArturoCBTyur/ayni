import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Roles, UsuarioActual } from '../identidad/decoradores';
import { CumplimientoService } from './cumplimiento.service';
import {
  esquemaActualizarConsentimiento,
  esquemaCrearArco,
  esquemaResponderArco,
  type ActualizarConsentimiento,
  type CrearArco,
  type ResponderArco,
} from './esquemas';

@ApiTags('cumplimiento')
@Controller('cumplimiento')
export class CumplimientoController {
  constructor(private readonly cumplimiento: CumplimientoService) {}

  @Get('consentimientos')
  @ApiOperation({ summary: 'RF-DE-01 · Consentimientos vigentes por finalidad' })
  async consentimientos(@UsuarioActual('sub') usuarioId: string) {
    return this.cumplimiento.consentimientos(usuarioId);
  }

  @Patch('consentimientos')
  @ApiOperation({ summary: 'RF-DE-01 · Otorgar o revocar un consentimiento' })
  async actualizarConsentimiento(
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaActualizarConsentimiento)) datos: ActualizarConsentimiento,
    @Req() req: Request,
  ) {
    return this.cumplimiento.actualizarConsentimiento(
      usuarioId,
      datos,
      BitacoraService.contexto(req),
    );
  }

  @Post('arco')
  @ApiOperation({ summary: 'CU21 · Presentar una solicitud ARCO' })
  async crearArco(
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaCrearArco)) datos: CrearArco,
    @Req() req: Request,
  ) {
    return this.cumplimiento.crearSolicitudArco(usuarioId, datos, BitacoraService.contexto(req));
  }

  @Get('arco')
  @ApiOperation({ summary: 'Mis solicitudes ARCO y su estado' })
  async misSolicitudes(@UsuarioActual('sub') usuarioId: string) {
    return this.cumplimiento.misSolicitudes(usuarioId);
  }

  @Get('arco/exportacion')
  @ApiOperation({ summary: 'Derecho de acceso · Exportar mis datos personales' })
  async exportar(@UsuarioActual('sub') usuarioId: string) {
    return this.cumplimiento.exportarDatos(usuarioId);
  }

  @Roles('ADMIN')
  @Get('arco/bandeja')
  @ApiOperation({ summary: 'CU21 · Bandeja de solicitudes ARCO, las mas urgentes primero' })
  async bandeja(@Query('todas') todas?: string) {
    return this.cumplimiento.bandejaArco(todas !== 'true');
  }

  @Roles('ADMIN')
  @Patch('arco/:id')
  @ApiOperation({ summary: 'CU21 · Responder una solicitud ARCO' })
  async responder(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual('sub') adminId: string,
    @Body(new ZodPipe(esquemaResponderArco)) datos: ResponderArco,
    @Req() req: Request,
  ) {
    return this.cumplimiento.responderArco(id, adminId, datos, BitacoraService.contexto(req));
  }
}
