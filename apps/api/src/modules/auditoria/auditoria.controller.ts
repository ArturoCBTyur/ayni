import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Roles, UsuarioActual } from '../identidad/decoradores';
import { AlertasService } from './alertas.service';
import { AuditoriaService } from './auditoria.service';
import {
  esquemaBandeja,
  esquemaReasignar,
  esquemaRevision,
  esquemaSubsanacion,
  type BandejaFiltros,
  type Reasignar,
  type Revision,
  type Subsanacion,
} from './esquemas';

const esquemaDescarte = z.object({
  nota: z.string().trim().min(10, 'Explique por que se descarta la alerta.').max(1000),
});

@ApiTags('auditoria')
@Controller()
export class AuditoriaController {
  constructor(
    private readonly auditoria: AuditoriaService,
    private readonly alertas: AlertasService,
  ) {}

  @Roles('AUDITOR', 'ADMIN')
  @Get('auditoria/bandeja')
  @ApiOperation({ summary: 'CU15 · Casos por revisar, por antiguedad o monto' })
  async bandeja(
    @UsuarioActual('sub') auditorId: string,
    @Query(new ZodPipe(esquemaBandeja)) filtros: BandejaFiltros,
  ) {
    return this.auditoria.bandeja(auditorId, filtros);
  }

  @Roles('AUDITOR', 'ADMIN')
  @Get('auditoria/indicadores')
  @ApiOperation({ summary: 'RN-08 · Falsos aprobados, SLA y reparto de niveles' })
  async indicadores() {
    return this.auditoria.indicadores();
  }

  @Roles('AUDITOR', 'ADMIN')
  @Post('auditoria/gastos/:id/revision')
  @ApiOperation({ summary: 'CU15 · Aprobar, observar o rechazar con comentario obligatorio' })
  async revisar(
    @Param('id', ParseUUIDPipe) gastoId: string,
    @UsuarioActual('sub') auditorId: string,
    @Body(new ZodPipe(esquemaRevision)) datos: Revision,
    @Req() req: Request,
  ) {
    return this.auditoria.revisar(gastoId, auditorId, datos, BitacoraService.contexto(req));
  }

  @Roles('AUDITOR', 'ADMIN')
  @Post('auditoria/gastos/:id/reasignar')
  @ApiOperation({ summary: 'CU15 · Reasignar un caso por conflicto de interes' })
  async reasignar(
    @Param('id', ParseUUIDPipe) gastoId: string,
    @UsuarioActual('sub') auditorId: string,
    @Body(new ZodPipe(esquemaReasignar)) datos: Reasignar,
    @Req() req: Request,
  ) {
    return this.auditoria.reasignar(gastoId, auditorId, datos, BitacoraService.contexto(req));
  }

  @Roles('ADMIN')
  @Post('auditoria/muestreo')
  @ApiOperation({ summary: 'RN-08 · Seleccionar casos ALTO para auditoria por muestreo' })
  async muestreo() {
    const seleccionados = await this.auditoria.seleccionarMuestreo();
    return { seleccionados };
  }

  // ----- Lado de la ONG ----------------------------------------------------

  @Get('ongs/:id/alertas')
  @ApiOperation({ summary: 'Observaciones abiertas de la organizacion' })
  async alertasDeOng(@Param('id', ParseUUIDPipe) ongId: string) {
    return this.alertas.listarPorOng(ongId);
  }

  @Post('alertas/:id/subsanar')
  @ApiOperation({ summary: 'CU11 · Responder una observacion; el gasto vuelve a analisis' })
  async subsanar(
    @Param('id', ParseUUIDPipe) alertaId: string,
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaSubsanacion)) datos: Subsanacion,
    @Req() req: Request,
  ) {
    return this.auditoria.subsanar(
      alertaId,
      usuarioId,
      datos.respuesta,
      BitacoraService.contexto(req),
    );
  }

  @Roles('AUDITOR', 'ADMIN')
  @Post('alertas/:id/descartar')
  @ApiOperation({ summary: 'Cerrar una alerta que no corresponde' })
  async descartar(
    @Param('id', ParseUUIDPipe) alertaId: string,
    @UsuarioActual('sub') auditorId: string,
    @Body(new ZodPipe(esquemaDescarte)) datos: { nota: string },
  ) {
    return this.alertas.descartar(alertaId, auditorId, datos.nota);
  }
}
