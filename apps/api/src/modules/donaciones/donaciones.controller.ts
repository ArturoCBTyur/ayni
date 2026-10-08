import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  type RawBodyRequest,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Publico, Roles, UsuarioActual } from '../identidad/decoradores';
import { DonacionesService } from './donaciones.service';
import {
  esquemaCambiarSuscripcion,
  esquemaDonar,
  esquemaEventoWebhook,
  esquemaSuscribir,
  type CambiarSuscripcion,
  type Donar,
  type Suscribir,
} from './esquemas';
import { PASARELA_PAGO, type PasarelaPago } from './puertos/pasarela-pago.port';

@ApiTags('donaciones')
@Controller()
export class DonacionesController {
  constructor(
    private readonly donaciones: DonacionesService,
    @Inject(PASARELA_PAGO) private readonly pasarela: PasarelaPago,
  ) {}

  // Solo quien tiene perfil de donante aporta. Antes cualquier sesion veia el
  // boton y la API contestaba "complete su perfil", que a un operador de ONG
  // no le dice nada: el permiso se declara aqui, donde se lee.
  @Roles('DONANTE')
  @Post('donaciones')
  @ApiOperation({ summary: 'CU03 · Donar a un fondo especifico' })
  async donar(
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaDonar)) datos: Donar,
    @Req() req: Request,
  ) {
    return this.donaciones.donar(usuarioId, datos, BitacoraService.contexto(req));
  }

  @Get('donaciones/historial')
  @ApiOperation({ summary: 'RF-13 · Historial con la linea de tiempo de cada aporte' })
  async historial(@UsuarioActual('sub') usuarioId: string) {
    return this.donaciones.historial(usuarioId);
  }

  // Despues de 'historial': con :id primero, ParseUUIDPipe rechazaria la
  // palabra "historial" antes de llegar a su ruta.
  @Get('donaciones/:id')
  @ApiOperation({ summary: 'RF-13 · Un aporte: en que gastos se uso, con su evidencia' })
  async detalle(
    @Param('id', ParseUUIDPipe) donacionId: string,
    @UsuarioActual('sub') usuarioId: string,
  ) {
    return this.donaciones.detalle(donacionId, usuarioId);
  }

  @Roles('DONANTE')
  @Post('suscripciones')
  @ApiOperation({ summary: 'CU04 · Suscribir una donacion recurrente' })
  async suscribir(
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaSuscribir)) datos: Suscribir,
    @Req() req: Request,
  ) {
    return this.donaciones.suscribir(usuarioId, datos, BitacoraService.contexto(req));
  }

  @Get('suscripciones')
  @ApiOperation({ summary: 'Mis donaciones recurrentes' })
  async misSuscripciones(@UsuarioActual('sub') usuarioId: string) {
    return this.donaciones.misSuscripciones(usuarioId);
  }

  @Patch('suscripciones/:id')
  @ApiOperation({ summary: 'RF-08 · Pausar, reanudar o cancelar en un clic' })
  async cambiarSuscripcion(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaCambiarSuscripcion)) datos: CambiarSuscripcion,
    @Req() req: Request,
  ) {
    return this.donaciones.cambiarSuscripcion(
      id,
      usuarioId,
      datos,
      BitacoraService.contexto(req),
    );
  }

  /**
   * Webhook de la pasarela.
   *
   * Es publico porque quien llama es la pasarela, no un usuario con sesion.
   * Lo que autentica la peticion es la firma HMAC sobre el cuerpo crudo. Se
   * responde 200 incluso cuando el evento no aplica: un error haria que la
   * pasarela reintente indefinidamente algo que ya esta resuelto.
   */
  @Publico()
  @Post('webhooks/pasarela')
  @HttpCode(200)
  @ApiOperation({ summary: 'Confirmacion de cobro firmada por la pasarela' })
  async webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-pasarela-firma') firma?: string,
  ) {
    const cuerpoCrudo = req.rawBody?.toString('utf8');

    if (!cuerpoCrudo) {
      throw new BadRequestException('Falta el cuerpo del evento.');
    }
    if (!this.pasarela.verificarFirma(cuerpoCrudo, firma)) {
      throw new UnauthorizedException('Firma del webhook invalida.');
    }

    // La firma prueba el origen, no que el contenido sea coherente.
    const evento = esquemaEventoWebhook.parse(JSON.parse(cuerpoCrudo));
    return this.donaciones.procesarWebhook(evento);
  }
}
