import { Module } from '@nestjs/common';

import { CampanasModule } from '../campanas/campanas.module';
import { AlertasService } from './alertas.service';
import { AuditoriaController } from './auditoria.controller';
import { AuditoriaService } from './auditoria.service';

/**
 * Auditoria y Alertas (Tabla 15 del Entregable 2).
 *
 * Importa CampanasModule por OngsService: cada decision de auditoria
 * recalcula el puntaje publico de la ONG, porque ese puntaje es una lectura
 * de conducta observada y una revision humana es justamente eso.
 */
@Module({
  imports: [CampanasModule],
  controllers: [AuditoriaController],
  providers: [AuditoriaService, AlertasService],
  exports: [AuditoriaService, AlertasService],
})
export class AuditoriaModule {}
