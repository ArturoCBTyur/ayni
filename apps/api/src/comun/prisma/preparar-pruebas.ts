/**
 * Preparacion de la base antes de que corra cualquier prueba.
 *
 * Ocho suites apagan los triggers de inmutabilidad del libro: unas para
 * simular una manipulacion externa, otras para poder borrar sus propios
 * asientos al limpiar. Apagarlos es una operacion de tabla y no de sesion,
 * asi que si una corrida se interrumpe entre el DISABLE y el ENABLE -- un
 * Ctrl-C a destiempo alcanza -- la base se queda sin la garantia que el
 * proyecto promete, en silencio y hasta que alguien lo note.
 *
 * Esto los reactiva una sola vez, antes de todo. Es idempotente y no sustituye
 * al try/finally de cada suite: es la red por si el proceso no llega a
 * ejecutarlo.
 */
import { PrismaClient } from '@prisma/client';

const TRIGGERS_INMUTABILIDAD = ['tg_movimientos_no_update', 'tg_movimientos_no_delete'];

export default async function prepararPruebas(): Promise<void> {
  const prisma = new PrismaClient({ log: [] });
  try {
    for (const trigger of TRIGGERS_INMUTABILIDAD) {
      await prisma.$executeRawUnsafe(
        `ALTER TABLE movimientos_contables ENABLE TRIGGER ${trigger}`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}
