import { Global, Module } from '@nestjs/common';

import { LibroService } from './libro.service';

/**
 * Core Contable (Tabla 15 del Entregable 2).
 *
 * Global porque el libro lo necesitan donaciones, gastos y auditoria: es el
 * punto por donde pasa todo el dinero, y tenerlo disponible en todas partes
 * evita que alguien escriba asientos por su cuenta.
 */
@Global()
@Module({
  providers: [LibroService],
  exports: [LibroService],
})
export class ContableModule {}
