import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { CifradoModule } from '../../comun/cifrado/cifrado.module';
import type { Configuracion } from '../../config/configuracion';
import { AlmacenamientoDisco } from './almacenamiento/disco.storage';
import { GastosController } from './gastos.controller';
import { GastosService } from './gastos.service';
import { ALMACENAMIENTO } from './puertos/almacenamiento.port';

/**
 * Gastos y Evidencias (Tabla 15 del Entregable 2).
 *
 * El almacenamiento se resuelve por token, igual que la pasarela de pago: en
 * desarrollo escribe en disco y en el despliegue pasara a S3 cambiando una
 * variable de entorno, sin que el dominio note la diferencia (ADR-0003).
 */
@Module({
  imports: [CifradoModule],
  controllers: [GastosController],
  providers: [
    GastosService,
    AlmacenamientoDisco,
    {
      provide: ALMACENAMIENTO,
      inject: [ConfigService, AlmacenamientoDisco],
      useFactory: (config: ConfigService<Configuracion, true>, disco: AlmacenamientoDisco) => {
        const driver = config.get('STORAGE_DRIVER', { infer: true });
        if (driver !== 'disco') {
          console.warn(`STORAGE_DRIVER="${driver}" todavia no esta implementado; se usa disco.`);
        }
        return disco;
      },
    },
  ],
  exports: [GastosService, ALMACENAMIENTO],
})
export class GastosModule {}
