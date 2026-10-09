/**
 * Preparacion de la base antes de que corra cualquier prueba.
 *
 * Varias suites apagan los triggers de inmutabilidad del libro y de los
 * cierres mensuales: unas para simular una manipulacion externa, otras para
 * poder borrar sus propios datos al limpiar. Apagarlos es una operacion de
 * tabla y no de sesion, asi que si una corrida se interrumpe entre el
 * DISABLE y el ENABLE -- un Ctrl-C a destiempo alcanza -- la base se queda
 * sin la garantia que el proyecto promete, en silencio y hasta que alguien
 * lo note.
 *
 * Esto los reactiva una sola vez, antes de todo. Es idempotente y no sustituye
 * al try/finally de cada suite: es la red por si el proceso no llega a
 * ejecutarlo.
 */
import { PrismaClient } from '@prisma/client';

/** Tabla y trigger. Cierres e informes se borran igual que el libro al limpiar. */
const TRIGGERS_INMUTABILIDAD: Array<[string, string]> = [
  ['movimientos_contables', 'tg_movimientos_no_update'],
  ['movimientos_contables', 'tg_movimientos_no_delete'],
  ['cierres_mensuales', 'tg_cierres_no_update'],
  ['cierres_mensuales', 'tg_cierres_no_delete'],
  ['informes_cierre', 'tg_informes_no_update'],
  ['informes_cierre', 'tg_informes_no_delete'],
];

/**
 * Comprueba que no haya un servidor de la API corriendo contra la misma base.
 *
 * Su trabajador de cola consulta `trabajos_verificacion` cada cinco segundos y
 * abre transacciones SERIALIZABLE sobre los mismos fondos que tocan las
 * pruebas. El resultado son fallos intermitentes que cambian de suite entre
 * corridas y no tienen nada que ver con el codigo que se esta probando: ya
 * paso dos veces en este proyecto y las dos costo horas entender por que.
 *
 * Se falla en vez de advertir. Una suite que a veces pasa ensena a desconfiar
 * de la suite, que es peor que no tenerla.
 */
async function exigirQueNadieMasEsteEscribiendo(): Promise<void> {
  const puerto = process.env.PORT ?? '3000';
  const prefijo = process.env.API_PREFIX ?? 'api/v1';

  try {
    const r = await fetch(`http://localhost:${puerto}/${prefijo}/salud`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!r.ok) return;
  } catch {
    // Nadie escuchando, que es lo que se espera. En CI tampoco hay servidor.
    return;
  }

  throw new Error(
    [
      '',
      `Hay un servidor de la API respondiendo en el puerto ${puerto}.`,
      '',
      'Su trabajador de cola escribe en la misma base que estas pruebas y produce',
      'fallos intermitentes ajenos al codigo que se esta probando.',
      '',
      'Detengalo antes de correr la suite (Ctrl+C en su terminal).',
      '',
    ].join('\n'),
  );
}

export default async function prepararPruebas(): Promise<void> {
  await exigirQueNadieMasEsteEscribiendo();

  const prisma = new PrismaClient({ log: [] });
  try {
    for (const [tabla, trigger] of TRIGGERS_INMUTABILIDAD) {
      await prisma.$executeRawUnsafe(`ALTER TABLE ${tabla} ENABLE TRIGGER ${trigger}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}
