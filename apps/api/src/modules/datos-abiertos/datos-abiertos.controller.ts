import { Controller, Get, Param, ParseUUIDPipe, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';

import { Publico } from '../identidad/decoradores';
import { DatosAbiertosService } from './datos-abiertos.service';

@ApiTags('publico')
@Controller('publico/iati')
export class DatosAbiertosController {
  constructor(private readonly datos: DatosAbiertosService) {}

  @Publico()
  @Get('ongs/:ongId')
  @ApiOperation({ summary: 'RF-IN-06 · Actividades de una ONG en el estandar IATI 2.03 (XML)' })
  async iati(@Param('ongId', ParseUUIDPipe) ongId: string, @Res() res: Response) {
    const { nombre, xml } = await this.datos.iati(ongId);
    res.setHeader('Content-Type', 'application/xml; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="${nombre}"`);
    res.send(xml);
  }
}
