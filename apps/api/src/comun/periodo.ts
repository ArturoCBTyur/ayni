/**
 * Periodos contables mensuales, en hora de Lima.
 *
 * Un estado de septiembre es lo que paso en septiembre para la ONG, que esta
 * en Lima, no para el servidor, que corre en UTC. La diferencia importa justo
 * en el borde: una donacion del 30 de septiembre a las 21:00 de Lima ya es
 * 1 de octubre en UTC, y en un estado calculado en UTC caeria en el mes
 * equivocado.
 *
 * El Peru no tiene horario de verano desde 1994, asi que el desfase es fijo
 * y se resuelve con aritmetica, sin una base de zonas horarias.
 */

export const ZONA_LIMA = 'America/Lima';

const DESFASE_LIMA_MS = 5 * 60 * 60 * 1000;

const FORMATO = /^(\d{4})-(0[1-9]|1[0-2])$/;

const MESES = [
  'enero',
  'febrero',
  'marzo',
  'abril',
  'mayo',
  'junio',
  'julio',
  'agosto',
  'septiembre',
  'octubre',
  'noviembre',
  'diciembre',
];

export interface Periodo {
  /** AAAA-MM */
  codigo: string;
  anio: number;
  /** 1 a 12 */
  mes: number;
  /** Primer instante del mes en Lima. */
  desde: Date;
  /** Primer instante del mes siguiente: el periodo es [desde, hasta). */
  hasta: Date;
}

function construir(anio: number, mes: number): Periodo {
  return {
    codigo: `${anio}-${String(mes).padStart(2, '0')}`,
    anio,
    mes,
    desde: new Date(Date.UTC(anio, mes - 1, 1) + DESFASE_LIMA_MS),
    hasta: new Date(Date.UTC(anio, mes, 1) + DESFASE_LIMA_MS),
  };
}

export function esCodigoDePeriodo(codigo: string): boolean {
  return FORMATO.test(codigo);
}

/** El periodo de un codigo AAAA-MM. Lanza si el codigo no tiene esa forma. */
export function periodo(codigo: string): Periodo {
  const m = FORMATO.exec(codigo);
  if (!m) throw new Error(`"${codigo}" no es un periodo AAAA-MM.`);
  return construir(Number(m[1]), Number(m[2]));
}

/** El periodo al que pertenece un instante, visto desde Lima. */
export function periodoDe(instante: Date): Periodo {
  const enLima = new Date(instante.getTime() - DESFASE_LIMA_MS);
  return construir(enLima.getUTCFullYear(), enLima.getUTCMonth() + 1);
}

export function siguiente(p: Periodo): Periodo {
  return p.mes === 12 ? construir(p.anio + 1, 1) : construir(p.anio, p.mes + 1);
}

export function anterior(p: Periodo): Periodo {
  return p.mes === 1 ? construir(p.anio - 1, 12) : construir(p.anio, p.mes - 1);
}

/** "septiembre de 2026" */
export function nombreDelPeriodo(p: Periodo): string {
  return `${MESES[p.mes - 1]} de ${p.anio}`;
}

/** La fecha de Lima de un instante, como dd/mm/aaaa. */
export function fechaEnLima(instante: Date): string {
  const enLima = new Date(instante.getTime() - DESFASE_LIMA_MS);
  const dd = String(enLima.getUTCDate()).padStart(2, '0');
  const mm = String(enLima.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${enLima.getUTCFullYear()}`;
}
