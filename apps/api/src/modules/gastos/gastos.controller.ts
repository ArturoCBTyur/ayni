import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Inject,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  type RawBodyRequest,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Publico, Roles, UsuarioActual } from '../identidad/decoradores';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import {
  esquemaAnonimizar,
  esquemaRegistrarGasto,
  esquemaUrlSubida,
  type Anonimizar,
  type RegistrarGasto,
  type UrlSubidaEntrada,
} from './esquemas';
import { GastosService } from './gastos.service';
import { ALMACENAMIENTO, type AlmacenamientoArchivos } from './puertos/almacenamiento.port';

@ApiTags('gastos')
@Controller()
export class GastosController {
  constructor(
    private readonly gastos: GastosService,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoArchivos,
  ) {}

  @Post('gastos/url-subida')
  @ApiOperation({ summary: 'Emitir URL firmada para subir comprobante o evidencia' })
  async urlSubida(
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaUrlSubida)) datos: UrlSubidaEntrada,
  ) {
    return this.gastos.urlDeSubida(usuarioId, datos);
  }

  @Post('gastos')
  @ApiOperation({ summary: 'CU10 · Registrar gasto con comprobante y evidencia' })
  async registrar(
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaRegistrarGasto)) datos: RegistrarGasto,
    @Req() req: Request,
  ) {
    return this.gastos.registrar(usuarioId, datos, BitacoraService.contexto(req));
  }

  @Get('gastos/:id')
  @ApiOperation({ summary: 'Detalle del gasto con su analisis y evidencias' })
  async detalle(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual() usuario: CargaAcceso,
  ) {
    const esAuditor = usuario.roles.includes('AUDITOR') || usuario.roles.includes('ADMIN');
    return this.gastos.detalle(id, usuario.sub, esAuditor);
  }

  @Get('ongs/:id/gastos')
  @ApiOperation({ summary: 'Gastos registrados por una ONG' })
  async listar(
    @Param('id', ParseUUIDPipe) ongId: string,
    @UsuarioActual('sub') usuarioId: string,
  ) {
    return this.gastos.listarPorOng(ongId, usuarioId);
  }

  @Post('evidencias/:id/anonimizar')
  @ApiOperation({ summary: 'RF-DE-04 · Difuminar manualmente los rostros marcados' })
  async anonimizar(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaAnonimizar)) datos: Anonimizar,
    @Req() req: Request,
  ) {
    return this.gastos.anonimizar(id, usuarioId, datos, BitacoraService.contexto(req));
  }

  /**
   * Subida y descarga de archivos por URL firmada.
   *
   * Publico en el sentido de que no exige sesion: lo que autoriza es el token
   * de la URL, que vale para un objeto, una accion y un plazo. Es el mismo
   * modelo de las URLs prefirmadas de S3, y por eso migrar no cambia nada
   * del cliente.
   */
  @Publico()
  @Put('almacenamiento/*ruta')
  @ApiOperation({ summary: 'Subir un archivo con URL firmada' })
  async subir(
    @Param('ruta') ruta: string[],
    @Query('token') token: string,
    @Req() req: RawBodyRequest<Request>,
  ) {
    const objeto = Array.isArray(ruta) ? ruta.join('/') : String(ruta);

    if (!this.almacen.verificarToken(objeto, token, 'subir')) {
      throw new UnauthorizedException('El enlace de subida es invalido o ya expiro.');
    }

    // express.raw deja el binario en req.body; req.rawBody solo lo llenan los
    // parsers que registra Nest (json, urlencoded), que no atienden image/*.
    // Se aceptan los dos para no depender de cual middleware atendio la
    // peticion. Leer solo rawBody hacia que toda subida respondiera "no se
    // recibio ningun archivo", con el archivo entero en el cuerpo.
    const contenido = Buffer.isBuffer(req.body) ? req.body : req.rawBody;
    if (!contenido?.byteLength) {
      throw new BadRequestException('No se recibio ningun archivo.');
    }
    // 25 MB: un video de campo cabe, y evita que una subida enorme agote el
    // disco o la memoria del proceso.
    if (contenido.byteLength > 25 * 1024 * 1024) {
      throw new BadRequestException('El archivo supera el maximo de 25 MB.');
    }

    const guardado = await this.almacen.guardar(
      objeto,
      contenido,
      req.headers['content-type'] ?? 'application/octet-stream',
    );

    return { objeto: guardado.objeto, bytes: guardado.bytes };
  }

  @Publico()
  @Get('almacenamiento/*ruta')
  @Header('Cache-Control', 'private, max-age=300')
  @ApiOperation({ summary: 'Descargar un archivo con URL firmada' })
  async descargar(
    @Param('ruta') ruta: string[],
    @Query('token') token: string,
    @Res() res: Response,
  ) {
    const objeto = Array.isArray(ruta) ? ruta.join('/') : String(ruta);

    if (!this.almacen.verificarToken(objeto, token, 'descargar')) {
      throw new UnauthorizedException('El enlace es invalido o ya expiro.');
    }
    if (!(await this.almacen.existe(objeto))) {
      throw new NotFoundException('El archivo ya no esta disponible.');
    }

    const contenido = await this.almacen.leer(objeto);
    res.type(objeto.endsWith('.pdf') ? 'application/pdf' : 'image/jpeg').send(contenido);
  }

  @Roles('ADMIN')
  @Get('almacenamiento-estado')
  @ApiOperation({ summary: 'Proveedor de almacenamiento activo' })
  estadoAlmacenamiento() {
    return { proveedor: this.almacen.nombre };
  }
}
