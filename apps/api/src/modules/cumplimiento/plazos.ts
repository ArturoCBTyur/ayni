import type { TipoArco } from '@prisma/client';

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

/**
 * Suma dias habiles a una fecha, saltando sabados y domingos.
 *
 * No contempla feriados nacionales: incorporarlos exige un calendario
 * mantenido. Al no restarlos, el plazo calculado es mas corto que el legal,
 * asi que el sistema se exige a si mismo antes de tiempo. Es el lado seguro
 * del error.
 */
export function sumarDiasHabiles(desde: Date, dias: number): Date {
  const fecha = new Date(desde);
  let restantes = dias;

  while (restantes > 0) {
    fecha.setDate(fecha.getDate() + 1);
    const dia = fecha.getDay();
    if (dia !== 0 && dia !== 6) restantes -= 1;
  }

  return fecha;
}

export function calcularPlazoArco(tipo: TipoArco, desde = new Date()): Date {
  return sumarDiasHabiles(desde, DIAS_HABILES_ARCO[tipo]);
}
