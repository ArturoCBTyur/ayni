import { Module } from '@nestjs/common';

import { AnaliticaController } from './analitica.controller';
import { CierresService } from './cierres.service';
import { ConciliacionService } from './conciliacion.service';
import { EstadosController } from './estados.controller';
import { EstadosService } from './estados.service';
import { ExportacionService } from './exportacion.service';
import { IndicadoresService } from './indicadores.service';
import { PanelService } from './panel.service';
import { PleService } from './ple.service';

/**
 * Analitica de Impacto (Tabla 15 del Entregable 2).
 *
 * Reune lo que permite responder las preguntas de auditoria de la Tabla 14 y
 * medir los indicadores de la Tabla 3. La conciliacion corre sola cada
 * madrugada y el cierre mensual el dia 1; el resto se consulta.
 */
@Module({
  controllers: [AnaliticaController, EstadosController],
  providers: [
    IndicadoresService,
    ConciliacionService,
    ExportacionService,
    PanelService,
    EstadosService,
    CierresService,
    PleService,
  ],
  exports: [IndicadoresService, ConciliacionService, ExportacionService],
})
export class AnaliticaModule {}
