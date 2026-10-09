import { Module } from '@nestjs/common';

import { EncuestasController } from './encuestas.controller';
import { EncuestasService } from './encuestas.service';

/**
 * Encuestas e indicadores que dependen de lo que opinan las personas
 * (Fase 4 del plan transdisciplinario): la confianza del donante (SOC-1) y la
 * usabilidad percibida (PSI-1).
 */
@Module({
  controllers: [EncuestasController],
  providers: [EncuestasService],
  exports: [EncuestasService],
})
export class EncuestasModule {}
