import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';

import { cargarConfiguracion } from './config/configuracion';
import { BitacoraModule } from './comun/bitacora/bitacora.module';
import { PrismaModule } from './comun/prisma/prisma.module';
import { SaludModule } from './comun/salud/salud.module';
import { CampanasModule } from './modules/campanas/campanas.module';
import { ContableModule } from './modules/contable/contable.module';
import { DonacionesModule } from './modules/donaciones/donaciones.module';
import { GastosModule } from './modules/gastos/gastos.module';
import { CumplimientoModule } from './modules/cumplimiento/cumplimiento.module';
import { IdentidadModule } from './modules/identidad/identidad.module';

/**
 * Modulo raiz. Los modulos de dominio se registran aqui en el orden de las
 * fases del plan; cada uno corresponde 1:1 a una fila de la Tabla 15 del
 * Entregable 2.
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [() => cargarConfiguracion()],
    }),
    // RNF-03: proteccion frente a abuso de la API.
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    // Jobs programados: cola de verificacion, conciliacion diaria y
    // verificacion de la cadena de hashes (ADR-002, RF-CF-04, RNF-07).
    ScheduleModule.forRoot(),
    PrismaModule,
    BitacoraModule,
    SaludModule,

    // Fase 2 - Identidad y Acceso. Registra el guard global de acceso, que
    // niega por defecto: toda ruta nace cerrada salvo @Publico().
    IdentidadModule,
    CumplimientoModule,

    // Fase 3 - Campanas y Fondos, incluida el alta y verificacion de ONG.
    CampanasModule,

    // Fase 4 - Core Contable y Donaciones y Pagos.
    ContableModule,
    DonacionesModule,

    // Fase 5 - Gastos y Evidencias.
    GastosModule,

    // Fase 6  - VerificacionModule   (Integracion AIni)
    // Fase 7  - AuditoriaModule      (Auditoria y Alertas)
    // Fase 8  - RetornoModule        (Motor de Retorno)
    // Fase 9  - AnaliticaModule      (Analitica de Impacto)
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
