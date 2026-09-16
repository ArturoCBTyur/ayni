import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Roles, UsuarioActual } from '../identidad/decoradores';
import { RetornoService } from './retorno.service';

const esquemaFeedback = z
  .object({
    notificacionId: z.string().uuid().optional(),
    gastoId: z.string().uuid().optional(),
    valoracion: z.coerce.number().int().min(1).max(5).optional(),
    comentario: z.string().trim().max(1000).optional(),
    reportaInconsistencia: z.boolean().default(false),
  })
  .superRefine((datos, ctx) => {
    if (!datos.notificacionId && !datos.gastoId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Indique sobre que notificacion o gasto es su comentario.',
      });
    }
    if (!datos.reportaInconsistencia && datos.valoracion === undefined && !datos.comentario) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Agregue una valoracion o un comentario.',
      });
    }
  });
type FeedbackEntrada = z.infer<typeof esquemaFeedback>;

@ApiTags('retorno')
@Controller()
export class RetornoController {
  constructor(private readonly retorno: RetornoService) {}

  @Get('notificaciones')
  @ApiOperation({ summary: 'CU06 · Narrativas de impacto recibidas' })
  async bandeja(
    @UsuarioActual('sub') usuarioId: string,
    @Query('noLeidas') noLeidas?: string,
  ) {
    return this.retorno.bandeja(usuarioId, noLeidas === 'true');
  }

  @Post('notificaciones/:id/leida')
  @ApiOperation({ summary: 'Marcar una notificacion como leida' })
  async marcarLeida(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual('sub') usuarioId: string,
  ) {
    return this.retorno.marcarLeida(id, usuarioId);
  }

  @Post('feedback')
  @ApiOperation({ summary: 'CU07 · Valorar la evidencia o reportar una inconsistencia' })
  async feedback(
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaFeedback)) datos: FeedbackEntrada,
    @Req() req: Request,
  ) {
    return this.retorno.registrarFeedback(usuarioId, datos, BitacoraService.contexto(req));
  }

  @Get('recomendaciones')
  @ApiOperation({ summary: 'RF-IA-10 · Fondos afines al historial, sin presion comercial' })
  async recomendaciones(@UsuarioActual('sub') usuarioId: string) {
    return this.retorno.recomendarFondos(usuarioId);
  }

  @Roles('ADMIN')
  @Post('gastos/:id/notificar')
  @ApiOperation({ summary: 'Reenviar las narrativas de un gasto ya aprobado' })
  async notificar(@Param('id', ParseUUIDPipe) gastoId: string) {
    return this.retorno.notificarImpacto(gastoId);
  }
}
