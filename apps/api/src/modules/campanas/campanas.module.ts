import { Module } from '@nestjs/common';

import { CampanasController } from './campanas.controller';
import { CampanasService } from './campanas.service';
import { OngsService } from './ongs.service';

/**
 * Campañas y Fondos (Tabla 15 del Entregable 2).
 *
 * Incluye el alta y la verificacion de ONG porque una campaña no existe sin
 * la organizacion que la sostiene, y el sello de verificacion es lo que
 * decide si esa campaña llega siquiera al buscador.
 */
@Module({
  controllers: [CampanasController],
  providers: [CampanasService, OngsService],
  exports: [CampanasService, OngsService],
})
export class CampanasModule {}
