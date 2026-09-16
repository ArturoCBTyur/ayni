import type { TipoArco } from '@prisma/client';

import { sumarDiasHabiles } from '../../comun/fechas';

export { sumarDiasHabiles };

/**
 * Plazos de atencion de los derechos ARCO.
 *
 * El Reglamento de la Ley N.o 29733 (D.S. 003-2013-JUS) distingue el derecho
 * de acceso, con un plazo mayor, de los de rectificacion, cancelacion y
 * oposicion. Los valores viven aqui y no dispersos en el codigo para que,
 * si la asesoria legal del equipo los corrige, el cambio sea de una linea.
 *
 * Se cuentan en dias habiles: contar corridos acortaria el plazo real y
 * podria hacer que el sistema reporte un incumplimiento inexistente.
 */
export const DIAS_HABILES_ARCO: Record<TipoArco, number> = {
  ACCESO: 20,
  RECTIFICACION: 10,
  CANCELACION: 10,
  OPOSICION: 10,
};

export function calcularPlazoArco(tipo: TipoArco, desde = new Date()): Date {
  return sumarDiasHabiles(desde, DIAS_HABILES_ARCO[tipo]);
}
