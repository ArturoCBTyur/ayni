import { Module } from '@nestjs/common';

import { DatosAbiertosController } from './datos-abiertos.controller';
import { DatosAbiertosService } from './datos-abiertos.service';

/** Datos abiertos (Fase 7 del plan transdisciplinario): IATI 2.03. */
@Module({
  controllers: [DatosAbiertosController],
  providers: [DatosAbiertosService],
})
export class DatosAbiertosModule {}
