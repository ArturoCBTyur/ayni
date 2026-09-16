import { Module } from '@nestjs/common';

import { CumplimientoController } from './cumplimiento.controller';
import { CumplimientoService } from './cumplimiento.service';

/** Privacidad y Cumplimiento (Tabla 15 del Entregable 2). */
@Module({
  controllers: [CumplimientoController],
  providers: [CumplimientoService],
  exports: [CumplimientoService],
})
export class CumplimientoModule {}
