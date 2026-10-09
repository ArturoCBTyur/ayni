import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';

import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { UsuarioActual } from '../identidad/decoradores';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import { EncuestasService } from './encuestas.service';

const esquemaRespuesta = z.object({
  codigo: z.string().min(1),
  version: z.number().int().positive(),
  momento: z.enum(['LINEA_BASE', 'SEGUIMIENTO', 'UNICA']),
  valores: z.array(z.number().int()).min(1).max(50),
});
type Respuesta = z.infer<typeof esquemaRespuesta>;

/**
 * Encuestas de SOC-1 y PSI-1 (RF-SO-05, RF-SO-06, RF-PS-06).
 *
 * Sin @Roles: a quien le toca responder lo decide el servicio por lo que la
 * persona hizo (donar, registrar un gasto), no por el rol de su cuenta.
 */
@ApiTags('encuestas')
@Controller('encuestas')
export class EncuestasController {
  constructor(private readonly encuestas: EncuestasService) {}

  @Get('pendientes')
  @ApiOperation({ summary: 'RF-SO-05 · Encuestas que le corresponde responder hoy' })
  async pendientes(@UsuarioActual() usuario: CargaAcceso) {
    return this.encuestas.pendientes(usuario);
  }

  @Get('instrumentos/:codigo')
  @ApiOperation({ summary: 'RF-SO-05 · Version activa de un instrumento, con su hash' })
  async instrumento(@Param('codigo') codigo: string) {
    return this.encuestas.instrumento(codigo);
  }

  @Post('respuestas')
  @ApiOperation({ summary: 'RF-SO-05 · Responder; exige la finalidad INVESTIGACION (RF-DE-06)' })
  async responder(
    @UsuarioActual() usuario: CargaAcceso,
    @Body(new ZodPipe(esquemaRespuesta)) datos: Respuesta,
  ) {
    return this.encuestas.responder(usuario, datos);
  }
}
