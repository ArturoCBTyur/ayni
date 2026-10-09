import { Controller, Get, Header, Param, ParseUUIDPipe, Post, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Roles, UsuarioActual } from '../identidad/decoradores';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import { ConciliacionService } from './conciliacion.service';
import { ExportacionService } from './exportacion.service';
import { IndicadoresService } from './indicadores.service';
import { PanelService } from './panel.service';

@ApiTags('analitica')
@Controller('analitica')
export class AnaliticaController {
  constructor(
    private readonly indicadores: IndicadoresService,
    private readonly conciliacion: ConciliacionService,
    private readonly exportacion: ExportacionService,
    private readonly panelRol: PanelService,
  ) {}

  /** Sin @Roles: cada rol ve su propia seccion, y solo la suya. */
  @Get('panel')
  @ApiOperation({ summary: 'Inicio de cada rol: lo pendiente y como va lo suyo' })
  async panel(@UsuarioActual() usuario: CargaAcceso) {
    return this.panelRol.panel(usuario.sub, usuario.roles);
  }

  @Roles('ADMIN', 'AUDITOR')
  @Get('tablero')
  @ApiOperation({ summary: 'CU20 · Indicadores transdisciplinarios de la Tabla 3' })
  async tablero() {
    const [resumen, tabla3] = await Promise.all([
      this.indicadores.resumen(),
      this.indicadores.tabla3(),
    ]);
    return { resumen, ...tabla3 };
  }

  @Roles('ADMIN', 'AUDITOR')
  @Get('conciliacion')
  @ApiOperation({ summary: 'CU16 · Conciliacion contable entre fuentes independientes' })
  async conciliar() {
    return this.conciliacion.conciliar();
  }

  @Roles('ADMIN')
  @Post('conciliacion/ejecutar')
  @ApiOperation({ summary: 'Forzar la conciliacion diaria fuera de su horario' })
  async ejecutarConciliacion() {
    return this.conciliacion.conciliacionDiaria();
  }

  @Roles('ADMIN', 'AUDITOR')
  @Get('informe/:ongId')
  @ApiOperation({ summary: 'CU17 · Informe de auditoria de una organizacion' })
  async informe(@Param('ongId', ParseUUIDPipe) ongId: string) {
    return this.exportacion.informeAuditoria(ongId);
  }

  // ----- Exportaciones CSV -------------------------------------------------

  @Roles('ADMIN', 'AUDITOR')
  @Get('exportar/libro/:fondoId')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'RF-15 · Extracto del libro de un fondo, con sus hashes' })
  async exportarLibro(
    @Param('fondoId', ParseUUIDPipe) fondoId: string,
    @Res() res: Response,
  ) {
    const { nombre, csv } = await this.exportacion.libroDeFondo(fondoId);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(csv);
  }

  @Roles('ADMIN', 'AUDITOR')
  @Get('exportar/diario/:fondoId')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'RF-CF-05 · Libro diario de un fondo en cuentas del PCGE' })
  async exportarDiario(
    @Param('fondoId', ParseUUIDPipe) fondoId: string,
    @Res() res: Response,
  ) {
    const { nombre, csv } = await this.exportacion.diarioPcge(fondoId);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(csv);
  }

  @Roles('ADMIN', 'AUDITOR')
  @Get('exportar/gastos/:ongId')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'RF-15 · Gastos de una ONG con su verificacion' })
  async exportarGastos(@Param('ongId', ParseUUIDPipe) ongId: string, @Res() res: Response) {
    const { nombre, csv } = await this.exportacion.gastosDeOng(ongId);
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(csv);
  }

  @Roles('ADMIN', 'AUDITOR')
  @Get('exportar/conciliacion')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @ApiOperation({ summary: 'RF-15 · Conciliacion contable en CSV' })
  async exportarConciliacion(@Res() res: Response) {
    const { nombre, csv } = await this.exportacion.conciliacionCsv();
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    res.send(csv);
  }
}
