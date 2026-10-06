import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';

import { CifradoModule } from '../../comun/cifrado/cifrado.module';
import { AccesoGuard } from './guards/acceso.guard';
import { IdentidadController } from './identidad.controller';
import { IdentidadService } from './identidad.service';
import { HashService } from './servicios/hash.service';
import { TokensService } from './servicios/tokens.service';
import { TotpService } from './servicios/totp.service';

/**
 * Identidad y Acceso (Tabla 15 del Entregable 2).
 *
 * Es global porque TokensService lo necesita el guard de acceso, que se
 * registra a nivel de aplicacion. El guard niega por defecto: toda ruta
 * nueva de cualquier modulo nace cerrada salvo que se marque @Publico().
 */
@Global()
@Module({
  imports: [JwtModule.register({}), CifradoModule],
  controllers: [IdentidadController],
  providers: [
    IdentidadService,
    HashService,
    TokensService,
    TotpService,
    { provide: APP_GUARD, useClass: AccesoGuard },
  ],
  exports: [TokensService, HashService, TotpService],
})
export class IdentidadModule {}
