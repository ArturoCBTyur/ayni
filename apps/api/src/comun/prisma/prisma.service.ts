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
      log:
        process.env.NODE_ENV === 'development'
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
   */
  async enTransaccionSerializable<T>(
    operacion: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.$transaction(operacion, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      timeout: 15_000,
    });
  }
}
