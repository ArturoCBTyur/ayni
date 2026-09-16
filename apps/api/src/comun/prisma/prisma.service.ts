import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Cliente Prisma con verificacion de conexion al arrancar.
 *
 * El chequeo inicial no es ceremonia: el PostgreSQL de desarrollo escucha
 * en el puerto 5433, no en el 5432 por defecto, y un DATABASE_URL con el
 * puerto equivocado produce errores confusos mucho mas tarde.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      // Bajo Jest no se registra nada. Varias pruebas provocan violaciones de
      // restriccion a proposito para comprobar que la base se defiende, y
      // verlas como errores en la salida entrena a ignorar los errores reales.
      log: process.env.JEST_WORKER_ID
        ? []
        : process.env.NODE_ENV === 'development'
          ? [{ emit: 'event', level: 'query' }, 'warn', 'error']
          : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
    } catch (error) {
      this.logger.error(
        'No se pudo conectar a PostgreSQL. Verifique DATABASE_URL en .env ' +
          '(recuerde que el servidor local escucha en el puerto 5433).',
      );
      throw error;
    }

    const [{ version }] = await this.$queryRaw<{ version: string }[]>`SELECT version()`;
    this.logger.log(`Conectado a ${version.split(',')[0]}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  /**
   * Ejecuta una operacion en una transaccion SERIALIZABLE, el nivel que
   * exige el core contable para que dos gastos concurrentes no puedan
   * consumir dos veces el mismo saldo retenido.
   *
   * Reintenta cuando PostgreSQL aborta la transaccion por no poder
   * serializarla. Esto no es opcional: SERIALIZABLE no evita los conflictos,
   * los detecta y aborta a uno de los dos, y es la aplicacion la que tiene
   * que volver a intentarlo. Sin el reintento, dos donantes que aportan al
   * mismo fondo en el mismo segundo terminan con uno de los dos viendo un
   * error despues de que su tarjeta ya fue cobrada.
   *
   * La operacion se ejecuta de nuevo desde cero, asi que tiene que poder
   * repetirse: toda decision que dependa del estado de la base debe leerse
   * **dentro** del callback, no antes. Un dato leido afuera queda viejo en el
   * segundo intento y las guardas que dependan de el dejan de proteger.
   */
  async enTransaccionSerializable<T>(
    operacion: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    let ultimoError: unknown;

    for (let intento = 1; intento <= INTENTOS_SERIALIZACION; intento++) {
      try {
        return await this.$transaction(operacion, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          timeout: 15_000,
        });
      } catch (error) {
        if (!esConflictoDeSerializacion(error)) throw error;

        ultimoError = error;
        if (intento < INTENTOS_SERIALIZACION) {
          // Espera aleatoria creciente. El azar importa: con una espera fija,
          // las dos transacciones que chocaron vuelven a la vez y chocan otra
          // vez, indefinidamente.
          const tope = ESPERA_BASE_MS * 2 ** (intento - 1);
          await new Promise((listo) => setTimeout(listo, Math.random() * tope));
        }
      }
    }

    this.logger.error(
      `Una transaccion contable no pudo serializarse en ${INTENTOS_SERIALIZACION} intentos. ` +
        'Si esto se repite, hay mas concurrencia sobre un mismo fondo de la que el ' +
        'reintento absorbe.',
    );
    throw ultimoError;
  }
}

/** Intentos totales, no reintentos: el primero cuenta. */
const INTENTOS_SERIALIZACION = 5;
const ESPERA_BASE_MS = 25;

/**
 * Distingue un conflicto de serializacion de cualquier otro error.
 *
 * Solo estos dos se reintentan. Reintentar cualquier fallo convertiria un
 * error de logica (un saldo insuficiente, una restriccion violada) en cuatro
 * intentos identicos y un mensaje tardio.
 */
function esConflictoDeSerializacion(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;

  // Como Prisma resume "write conflict or deadlock".
  if (error.code === 'P2034') return true;

  // Las consultas crudas (el trigger de encadenamiento, fn_verificar_cadena)
  // llegan envueltas en P2010 con el codigo real de PostgreSQL adentro:
  // 40001 serialization_failure, 40P01 deadlock_detected.
  if (error.code === 'P2010') {
    const meta = error.meta as { code?: string; message?: string } | undefined;
    if (meta?.code === '40001' || meta?.code === '40P01') return true;
    return /40001|40P01|could not serialize|deadlock detected/i.test(meta?.message ?? '');
  }

  return false;
}
