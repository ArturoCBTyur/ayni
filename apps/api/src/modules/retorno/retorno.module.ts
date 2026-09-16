import { Global, Module } from '@nestjs/common';

import { NarrativaService } from './narrativa.service';
import { RetornoController } from './retorno.controller';
import { RetornoService } from './retorno.service';

/**
 * Motor de Retorno (Tabla 15 del Entregable 2).
 *
 * Global porque la verificacion y la auditoria lo invocan al aprobar un
 * gasto: es el paso que cierra el ciclo de confianza, y encadenarlo al
 * momento de la aprobacion evita que un gasto quede verificado sin que su
 * donante llegue a enterarse.
 */
@Global()
@Module({
  controllers: [RetornoController],
  providers: [RetornoService, NarrativaService],
  exports: [RetornoService, NarrativaService],
})
export class RetornoModule {}
