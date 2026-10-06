import { Module } from '@nestjs/common';

import { CifradoService } from './cifrado.service';

/**
 * No es global a proposito: lo importan explicitamente los modulos que
 * guardan algo cifrado (gastos e identidad). Asi se ve en el propio modulo
 * que datos salen de el cifrados, y las pruebas que montan uno de esos
 * modulos no dependen de que alguien recuerde registrar este.
 */
@Module({
  providers: [CifradoService],
  exports: [CifradoService],
})
export class CifradoModule {}
