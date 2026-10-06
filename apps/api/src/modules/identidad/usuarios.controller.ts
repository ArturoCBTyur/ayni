import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Roles, UsuarioActual } from './decoradores';
import {
  esquemaCambiarEstado,
  esquemaCambiarRoles,
  esquemaFiltroUsuarios,
  esquemaMotivo,
  type CambiarEstado,
  type CambiarRoles,
  type FiltroUsuarios,
  type Motivo,
} from './esquemas';
import { UsuariosService } from './usuarios.service';

/** RF-16 · Gestion de usuarios. Todo el controlador es del administrador. */
@ApiTags('identidad')
@Roles('ADMIN')
@Controller('identidad/usuarios')
export class UsuariosController {
  constructor(private readonly usuarios: UsuariosService) {}

  @Get()
  @ApiOperation({ summary: 'RF-16 · Buscar cuentas por nombre o correo, rol y estado' })
  async listar(@Query(new ZodPipe(esquemaFiltroUsuarios)) filtro: FiltroUsuarios) {
    return this.usuarios.listar(filtro);
  }

  // Antes de `:id`: si no, "roles" llega a ParseUUIDPipe y responde 400.
  @Get('roles')
  @ApiOperation({ summary: 'RF-02 · Catalogo de roles, con cuales exigen segundo factor' })
  async roles() {
    return this.usuarios.roles();
  }

  @Get(':id')
  @ApiOperation({ summary: 'RF-16 · Ficha de una cuenta con su historial administrativo' })
  async detalle(@Param('id', ParseUUIDPipe) id: string) {
    return this.usuarios.detalle(id);
  }

  @Patch(':id/roles')
  @ApiOperation({ summary: 'RF-02 · Reemplazar los roles de una cuenta, con motivo' })
  async cambiarRoles(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual('sub') adminId: string,
    @Body(new ZodPipe(esquemaCambiarRoles)) datos: CambiarRoles,
    @Req() req: Request,
  ) {
    return this.usuarios.cambiarRoles(id, adminId, datos, BitacoraService.contexto(req));
  }

  @Patch(':id/estado')
  @ApiOperation({ summary: 'RF-16 · Bloquear o reactivar una cuenta, con motivo' })
  async cambiarEstado(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual('sub') adminId: string,
    @Body(new ZodPipe(esquemaCambiarEstado)) datos: CambiarEstado,
    @Req() req: Request,
  ) {
    return this.usuarios.cambiarEstado(id, adminId, datos, BitacoraService.contexto(req));
  }

  @Post(':id/mfa/restablecer')
  @HttpCode(200)
  @ApiOperation({ summary: 'RNF-02 · Restablecer el segundo factor de una cuenta, con motivo' })
  async restablecerMfa(
    @Param('id', ParseUUIDPipe) id: string,
    @UsuarioActual('sub') adminId: string,
    @Body(new ZodPipe(esquemaMotivo)) datos: Motivo,
    @Req() req: Request,
  ) {
    return this.usuarios.restablecerMfa(id, adminId, datos, BitacoraService.contexto(req));
  }
}
