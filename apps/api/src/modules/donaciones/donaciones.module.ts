import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Configuracion } from '../../config/configuracion';
import { GastosModule } from '../gastos/gastos.module';
import { DonacionesController } from './donaciones.controller';
import { DonacionesService } from './donaciones.service';
import { FakeGateway } from './pasarelas/fake.gateway';
import { PASARELA_PAGO } from './puertos/pasarela-pago.port';

/**
 * Donaciones y Pagos (Tabla 15 del Entregable 2).
 *
 * La pasarela se resuelve por token: hoy solo existe FakeGateway, y cuando
 * haya credenciales de Culqi se agrega CulqiGateway aqui sin que el servicio
 * de donaciones se entere. El `default` es deliberado: si alguien configura
 * un driver que aun no existe, es mejor arrancar con el simulado y avisarlo
 * que fallar el arranque del sistema completo.
 */
@Module({
  // Para firmar la evidencia publicable de los gastos que financio un aporte.
  imports: [GastosModule],
  controllers: [DonacionesController],
  providers: [
    DonacionesService,
    FakeGateway,
    {
      provide: PASARELA_PAGO,
      inject: [ConfigService, FakeGateway],
      useFactory: (config: ConfigService<Configuracion, true>, fake: FakeGateway) => {
        const driver = config.get('PASARELA_DRIVER', { infer: true });
        switch (driver) {
          case 'fake':
            return fake;
          default:
            console.warn(
              `PASARELA_DRIVER="${driver}" todavia no esta implementado; se usa la simulada.`,
            );
            return fake;
        }
      },
    },
  ],
  exports: [DonacionesService],
})
export class DonacionesModule {}
