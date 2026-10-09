import {
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { z } from 'zod';

import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Roles, UsuarioActual } from '../identidad/decoradores';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import { CierresService } from './cierres.service';
import { estadoPdf, estadoXlsx, nombreArchivo } from './estados.render';
import { EstadosService } from './estados.service';
import { PleService } from './ple.service';

const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

const periodoAaaaMm = z
  .string({ required_error: 'Indique el periodo como AAAA-MM, por ejemplo 2026-09.' })
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'El periodo se indica como AAAA-MM, por ejemplo 2026-09.');

const esquemaEstado = z.object({
  periodo: periodoAaaaMm,
  formato: z.enum(['json', 'xlsx', 'pdf']).default('json'),
});
type ConsultaEstado = z.infer<typeof esquemaEstado>;

const esquemaPle = z.object({
  periodo: periodoAaaaMm,
  libro: z.enum(['diario', 'mayor']).default('diario'),
});
type ConsultaPle = z.infer<typeof esquemaPle>;

/**
 * Estados mensuales de cada fondo (RF-CF-07 a RF-CF-10).
 *
 * Sin @Roles en las consultas: las ve el administrador, el auditor y los
 * miembros de la ONG dueña, y lo ultimo depende de la membresia en esa ONG,
 * que se comprueba en el servicio. Un rol no alcanza para eso.
 */
@ApiTags('analitica')
@Controller('analitica')
export class EstadosController {
  constructor(
    private readonly estados: EstadosService,
    private readonly cierres: CierresService,
    private readonly ple: PleService,
  ) {}

  @Get('estados/fondos/:id/periodos')
  @ApiOperation({ summary: 'RF-CF-07 · Meses de vida de un fondo, con su cierre si lo tienen' })
  async periodos(@Param('id', ParseUUIDPipe) id: string, @UsuarioActual() usuario: CargaAcceso) {
    return this.estados.periodos(id, usuario);
  }

  @Get('estados/fondos/:id')
  @ApiOperation({
    summary: 'RF-CF-07, RF-CF-08 · Estado de actividades y situacion de un fondo en un mes',
    description:
      'formato=json (por defecto), xlsx o pdf. Si el mes esta cerrado se entrega el cierre ' +
      'guardado, con su hash, y se indica si el libro lo sigue sosteniendo.',
  })
  async estado(
    @Param('id', ParseUUIDPipe) id: string,
    @Query(new ZodPipe(esquemaEstado)) consulta: ConsultaEstado,
    @UsuarioActual() usuario: CargaAcceso,
    @Res({ passthrough: true }) res: Response,
  ) {
    const resultado = await this.estados.consultar(id, consulta.periodo, usuario);
    if (consulta.formato === 'json') return resultado;

    const [contenido, tipo, extension] =
      consulta.formato === 'xlsx'
        ? [estadoXlsx(resultado), MIME_XLSX, 'xlsx']
        : [estadoPdf(resultado), 'application/pdf', 'pdf'];

    res.setHeader('Content-Type', tipo);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${nombreArchivo(resultado, extension)}"`,
    );
    return new StreamableFile(contenido);
  }

  @Roles('ADMIN')
  @Post('estados/cierres/ejecutar')
  @ApiOperation({ summary: 'RF-CF-09 · Forzar el cierre mensual fuera de su horario' })
  async ejecutarCierre() {
    return this.cierres.cerrarPendientes();
  }

  @Get('ple/ongs/:ongId')
  @ApiOperation({
    summary: 'RF-CF-10 · BORRADOR del libro diario o mayor de una ONG en formato PLE',
    description: 'Estructura pendiente de validacion por un contador. Ver contable/ple.ts.',
  })
  async borradorPle(
    @Param('ongId', ParseUUIDPipe) ongId: string,
    @Query(new ZodPipe(esquemaPle)) consulta: ConsultaPle,
    @UsuarioActual() usuario: CargaAcceso,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { nombre, texto } = await this.ple.borrador(
      ongId,
      consulta.periodo,
      consulta.libro,
      usuario,
    );
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nombre}"`);
    return new StreamableFile(Buffer.from(texto, 'utf8'));
  }
}
