/**
 * Calculo de plazos en dias habiles.
 *
 * Lo usan dos reglas del entregable con plazos distintos: la atencion de
 * derechos ARCO (RF-DE-02) y el tiempo maximo de resolucion de auditoria
 * (RN-07, 48 horas habiles). Vive aqui para que ambas cuenten igual.
 *
 * No contempla feriados nacionales: incorporarlos exige un calendario
 * mantenido y actualizado cada año. Al no restarlos, el plazo calculado es
 * mas corto que el legal, de modo que el sistema se exige a si mismo antes
 * de tiempo. Es el lado seguro del error.
 */

const SABADO = 6;
const DOMINGO = 0;

export function esDiaHabil(fecha: Date): boolean {
  const dia = fecha.getDay();
  return dia !== SABADO && dia !== DOMINGO;
}

export function sumarDiasHabiles(desde: Date, dias: number): Date {
  const fecha = new Date(desde);
  let restantes = dias;

  while (restantes > 0) {
    fecha.setDate(fecha.getDate() + 1);
    if (esDiaHabil(fecha)) restantes -= 1;
  }

  return fecha;
}

/**
 * Suma horas habiles saltando los fines de semana.
 *
 * Se cuenta en dias de 24 horas habiles, no de jornada laboral: el sistema
 * no sabe en que horario trabaja cada auditor, y asumir una jornada de ocho
 * horas alargaria el plazo real casi al triple sin fundamento.
 */
export function sumarHorasHabiles(desde: Date, horas: number): Date {
  const fecha = new Date(desde);
  let restantes = horas;

  while (restantes > 0) {
    fecha.setHours(fecha.getHours() + 1);
    if (esDiaHabil(fecha)) restantes -= 1;
  }

  return fecha;
}

/** Horas habiles transcurridas entre dos instantes. */
export function horasHabilesEntre(desde: Date, hasta: Date): number {
  if (hasta <= desde) return 0;

  const cursor = new Date(desde);
  let horas = 0;

  while (cursor < hasta) {
    cursor.setHours(cursor.getHours() + 1);
    if (esDiaHabil(cursor)) horas += 1;
  }

  return horas;
}
