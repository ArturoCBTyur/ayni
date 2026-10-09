import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Roles, UsuarioActual } from '../identidad/decoradores';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import { CausasService } from './causas.service';

const esquemaEleccion = z
  .object({
    destino: z.enum(['DEVOLUCION', 'REASIGNACION']),
    fondoDestinoId: z.string().uuid().optional(),
  })
  .refine((d) => d.destino === 'DEVOLUCION' || d.fondoDestinoId, {
    message: 'Elija a que fondo pasa su saldo.',
    path: ['fondoDestinoId'],
  });
type Eleccion = z.infer<typeof esquemaEleccion>;

/**
 * Cierre de causa (RF-CF-11): lo que decide el donante sobre su saldo.
 *
 * Bajo /remanentes y no /causas: /causas/:slug es la ficha publica de una
 * campaña, y "saldos" se leeria como un slug.
 */
@ApiTags('causas')
@Controller()
export class CausasController {
  constructor(private readonly causas: CausasService) {}

  @Get('remanentes')
  @ApiOperation({ summary: 'RF-CF-11 · Mis saldos de causas cerradas, por elegir y resueltos' })
  async misSaldos(@UsuarioActual() usuario: CargaAcceso) {
    return this.causas.misSaldos(usuario);
  }

  @Get('remanentes/:id/destinos')
  @ApiOperation({ summary: 'RF-CF-11 · Fondos que pueden recibir mi saldo' })
  async destinos(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() usuario: CargaAcceso) {
    return this.causas.destinosPosibles(usuario, id);
  }

  @Post('remanentes/:id/eleccion')
  @ApiOperation({ summary: 'RF-CF-11 · Elegir devolucion o traslado de mi saldo' })
  async elegir(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: CargaAcceso,
    @Body(new ZodPipe(esquemaEleccion)) datos: Eleccion,
    @Req() req: Request,
  ) {
    return this.causas.elegir(usuario, id, datos, BitacoraService.contexto(req));
  }

  @Roles('ADMIN')
  @Post('cierres-causa/avanzar')
  @ApiOperation({ summary: 'RF-CF-11 · Forzar el paso diario de los cierres de causa' })
  async avanzar() {
    return this.causas.avanzar();
  }
}
