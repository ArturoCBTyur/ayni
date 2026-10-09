import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Roles, UsuarioActual } from '../identidad/decoradores';
import { CumplimientoService } from './cumplimiento.service';
import {
  esquemaActualizarConsentimiento,
  esquemaCrearArco,
  esquemaInformeCumplimiento,
  esquemaResponderArco,
  type ActualizarConsentimiento,
  type CrearArco,
  type InformeCumplimientoConsulta,
  type ResponderArco,
} from './esquemas';
import { informeCumplimientoPdf, informeCumplimientoXlsx } from './informe';

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
  @Get('informe')
  @ApiOperation({
    summary: 'RF-DE-08 · Informe de cumplimiento de la Ley 29733 (json, xlsx o pdf)',
  })
  async informe(
    @Query(new ZodPipe(esquemaInformeCumplimiento)) consulta: InformeCumplimientoConsulta,
    @Res({ passthrough: true }) res: Response,
  ) {
    // hasta es inclusivo para quien lo pide: se cuenta hasta el final de ese dia.
    const hasta = new Date(consulta.hasta.getTime() + 24 * 60 * 60 * 1000);
    const informe = await this.cumplimiento.informeCumplimiento(consulta.desde, hasta);
    if (consulta.formato === 'json') return informe;

    const pdf = consulta.formato === 'pdf';
    res.setHeader(
      'Content-Type',
      pdf ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="cumplimiento-ley-29733.${pdf ? 'pdf' : 'xlsx'}"`,
    );
    return new StreamableFile(pdf ? informeCumplimientoPdf(informe) : informeCumplimientoXlsx(informe));
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
