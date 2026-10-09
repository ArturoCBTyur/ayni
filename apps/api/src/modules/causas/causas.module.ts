import { Module } from '@nestjs/common';

import { DonacionesModule } from '../donaciones/donaciones.module';
import { GastosModule } from '../gastos/gastos.module';
import { CausasController } from './causas.controller';
import { CausasService } from './causas.service';
import { InformesCierreService } from './informes-cierre.service';
import { PublicoController } from './publico.controller';

/**
 * Cierre de causa (Fase 3 del plan transdisciplinario): el plazo para
 * justificar, el destino del remanente, el informe de cierre y su
 * verificacion publica.
 */
@Module({
  // La pasarela, para devolver; el almacen, para las fotos del informe.
  imports: [DonacionesModule, GastosModule],
  controllers: [CausasController, PublicoController],
  providers: [CausasService, InformesCierreService],
  exports: [CausasService],
})
export class CausasModule {}
