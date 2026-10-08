import { Module } from '@nestjs/common';

import { AnaliticaController } from './analitica.controller';
import { ConciliacionService } from './conciliacion.service';
import { ExportacionService } from './exportacion.service';
import { IndicadoresService } from './indicadores.service';
import { PanelService } from './panel.service';

/**
 * Analitica de Impacto (Tabla 15 del Entregable 2).
 *
 * Reune lo que permite responder las preguntas de auditoria de la Tabla 14 y
 * medir los indicadores de la Tabla 3. La conciliacion corre sola cada
 * madrugada; el resto se consulta.
 */
@Module({
  controllers: [AnaliticaController],
  providers: [IndicadoresService, ConciliacionService, ExportacionService, PanelService],
  exports: [IndicadoresService, ConciliacionService, ExportacionService],
})
export class AnaliticaModule {}
