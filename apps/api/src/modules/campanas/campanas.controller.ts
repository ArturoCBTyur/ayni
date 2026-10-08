import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Publico, Roles, UsuarioActual } from '../identidad/decoradores';
import { CampanasService } from './campanas.service';
import {
  esquemaActualizarCampana,
  esquemaActualizarFondo,
  esquemaAgregarMiembro,
  esquemaBuscarCausas,
  esquemaCambiarMiembro,
  esquemaCrearCampana,
  esquemaCrearFondo,
  esquemaRegistrarOng,
  esquemaVerificarOng,
  type ActualizarCampana,
  type ActualizarFondo,
  type AgregarMiembro,
  type BuscarCausas,
  type CambiarMiembro,
  type CrearCampana,
  type CrearFondo,
  type RegistrarOng,
  type VerificarOng,
} from './esquemas';
import { OngsService } from './ongs.service';

@ApiTags('causas')
@Controller()
export class CampanasController {
  constructor(
    private readonly campanas: CampanasService,
    private readonly ongs: OngsService,
  ) {}

  // ----- Publico: lo que ve el donante antes de decidir -------------------

  @Publico()
  @Get('causas')
  @ApiOperation({ summary: 'RF-06 · Buscar causas de ONG verificadas' })
  async buscar(@Query(new ZodPipe(esquemaBuscarCausas)) filtros: BuscarCausas) {
    return this.campanas.buscarCausas(filtros);
  }

  @Publico()
  @Get('causas/:slug')
  @ApiOperation({ summary: 'CU02 · Ficha de una campaña con sus fondos' })
  async detalle(@Param('slug') slug: string) {
    return this.campanas.detalleCampana(slug);
  }

  @Publico()
  @Get('ongs/:id')
  @ApiOperation({ summary: 'RF-SO-01 · Ficha de ONG con su puntaje explicado' })
  async fichaOng(@Param('id', ParseUUIDPipe) id: string) {
    return this.ongs.fichaPublica(id);
  }

  // ----- ONG ---------------------------------------------------------------

  @Post('ongs')
  @ApiOperation({ summary: 'CU08 · Registrar una organizacion y pedir su verificacion' })
  async registrarOng(
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaRegistrarOng)) datos: RegistrarOng,
    @Req() req: Request,
  ) {
    return this.ongs.registrar(usuarioId, datos, BitacoraService.contexto(req));
  }

  @Get('ongs/mias/listado')
  @ApiOperation({ summary: 'Organizaciones a las que pertenezco' })
  async misOngs(@UsuarioActual('sub') usuarioId: string) {
    return this.ongs.misOngs(usuarioId);
  }

  @Get('ongs/:id/fondos')
  @ApiOperation({ summary: 'CU12 · Estado de fondos: recaudado, retenido y ejecutado' })
  async estadoFondos(
    @Param('id', ParseUUIDPipe) ongId: string,
    @UsuarioActual('sub') usuarioId: string,
  ) {
    return this.campanas.estadoFondos(ongId, usuarioId);
  }

  // ----- Equipo de la ONG ---------------------------------------------------

  @Get('ongs/:id/miembros')
  @ApiOperation({ summary: 'Equipo de la organizacion, para su administrador' })
  async miembros(
    @Param('id', ParseUUIDPipe) ongId: string,
    @UsuarioActual('sub') usuarioId: string,
  ) {
    return this.ongs.listarMiembros(ongId, usuarioId);
  }

  @Post('ongs/:id/miembros')
  @ApiOperation({ summary: 'Agregar a una persona con cuenta al equipo de la organizacion' })
  async agregarMiembro(
    @Param('id', ParseUUIDPipe) ongId: string,
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaAgregarMiembro)) datos: AgregarMiembro,
    @Req() req: Request,
  ) {
    return this.ongs.agregarMiembro(ongId, usuarioId, datos, BitacoraService.contexto(req));
  }

  @Patch('ongs/:id/miembros/:usuarioId')
  @ApiOperation({ summary: 'Cambiar el cargo de un miembro o desactivarlo' })
  async cambiarMiembro(
    @Param('id', ParseUUIDPipe) ongId: string,
    @Param('usuarioId', ParseUUIDPipe) miembroId: string,
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaCambiarMiembro)) datos: CambiarMiembro,
    @Req() req: Request,
  ) {
    return this.ongs.cambiarMiembro(
      ongId,
      miembroId,
      usuarioId,
      datos,
      BitacoraService.contexto(req),
    );
  }

  // ----- Auditor -----------------------------------------------------------

  @Roles('AUDITOR', 'ADMIN')
  @Get('verificaciones/pendientes')
  @ApiOperation({ summary: 'CU14 · Expedientes de ONG esperando verificacion' })
  async pendientes() {
    return this.ongs.pendientesDeVerificacion();
  }

  @Roles('AUDITOR', 'ADMIN')
  @Patch('ongs/:id/verificacion')
  @ApiOperation({ summary: 'CU14 · Verificar, rechazar o suspender una ONG' })
  async verificarOng(
    @Param('id', ParseUUIDPipe) ongId: string,
    @UsuarioActual('sub') auditorId: string,
    @Body(new ZodPipe(esquemaVerificarOng)) datos: VerificarOng,
    @Req() req: Request,
  ) {
    return this.ongs.verificar(ongId, auditorId, datos, BitacoraService.contexto(req));
  }

  // ----- Campañas y fondos -------------------------------------------------

  @Post('ongs/:id/campanas')
  @ApiOperation({ summary: 'CU09 · Crear una campaña' })
  async crearCampana(
    @Param('id', ParseUUIDPipe) ongId: string,
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaCrearCampana)) datos: CrearCampana,
    @Req() req: Request,
  ) {
    return this.campanas.crearCampana(ongId, usuarioId, datos, BitacoraService.contexto(req));
  }

  @Patch('campanas/:id')
  @ApiOperation({ summary: 'RF-04 · Editar, publicar, pausar o cerrar una campaña' })
  async actualizarCampana(
    @Param('id', ParseUUIDPipe) campanaId: string,
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaActualizarCampana)) datos: ActualizarCampana,
    @Req() req: Request,
  ) {
    return this.campanas.actualizarCampana(
      campanaId,
      usuarioId,
      datos,
      BitacoraService.contexto(req),
    );
  }

  @Patch('fondos/:id')
  @ApiOperation({ summary: 'RF-05 · Editar, pausar o cerrar un fondo' })
  async actualizarFondo(
    @Param('id', ParseUUIDPipe) fondoId: string,
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaActualizarFondo)) datos: ActualizarFondo,
    @Req() req: Request,
  ) {
    return this.campanas.actualizarFondo(fondoId, usuarioId, datos, BitacoraService.contexto(req));
  }

  @Post('campanas/:id/fondos')
  @ApiOperation({ summary: 'CU09 · Crear un fondo con categoria de gasto y meta' })
  async crearFondo(
    @Param('id', ParseUUIDPipe) campanaId: string,
    @UsuarioActual('sub') usuarioId: string,
    @Body(new ZodPipe(esquemaCrearFondo)) datos: CrearFondo,
    @Req() req: Request,
  ) {
    return this.campanas.crearFondo(campanaId, usuarioId, datos, BitacoraService.contexto(req));
  }
}
