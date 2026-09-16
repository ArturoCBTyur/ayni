import { Global, Module } from '@nestjs/common';

import { BitacoraService } from './bitacora.service';

/**
 * Bitacora global: casi todos los modulos de dominio necesitan registrar
 * cambios sensibles, y hacerla global evita importarla en cada uno.
 */
@Global()
@Module({
  providers: [BitacoraService],
  exports: [BitacoraService],
})
export class BitacoraModule {}
