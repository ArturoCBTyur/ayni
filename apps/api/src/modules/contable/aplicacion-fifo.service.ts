import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { soles } from '../../comun/dinero';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { LibroService } from './libro.service';

export interface ResultadoAplicacion {
  gastoId: string;
  montoAprobado: string;
  aplicaciones: Array<{
    donacionId: string;
    donanteId: string;
    monto: string;
  }>;
}

/**
 * Aplicacion de un gasto aprobado a las donaciones que lo financian.
 *
 * Es el eslabon que hace posible la trazabilidad "a nivel de sol y de
 * persona" (RF-CF-03): sin esto, el sistema sabria que se gasto dinero del
 * fondo, pero no de quien era ese dinero, y la narrativa al donante no
 * podria decir "su aporte financio esto".
 *
 * El criterio es FIFO, declarado en el Anexo A del entregable: los gastos
 * consumen primero las donaciones mas antiguas del fondo. Es simple,
 * predecible y explicable al donante, que es lo que importa cuando hay que
 * justificar por que el dinero de una persona y no el de otra pago una
 * compra concreta.
 */
@Injectable()
export class AplicacionFifoService {
  private readonly logger = new Logger(AplicacionFifoService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly libro: LibroService,
  ) {}

  /**
   * Aprueba el gasto, lo aplica a las donaciones y asienta la ejecucion.
   *
   * Todo ocurre en una transaccion SERIALIZABLE. No es precaucion excesiva:
   * dos gastos aprobados a la vez sobre el mismo fondo podrian, con un nivel
   * de aislamiento menor, consumir ambos la misma donacion y dejar el libro
   * descuadrado. Serializable hace que uno de los dos falle y reintente, que
   * es exactamente lo que se quiere cuando se trata de dinero.
   */
  async aprobarYAplicar(datos: {
    gastoId: string;
    montoAprobado: Prisma.Decimal | number;
    aprobadoPor?: string;
  }): Promise<ResultadoAplicacion> {
    const monto = new Prisma.Decimal(datos.montoAprobado);

    return this.prisma.enTransaccionSerializable(async (tx) => {
      const gasto = await tx.gasto.findUniqueOrThrow({
        where: { id: datos.gastoId },
        include: { fondo: true },
      });

      if (gasto.estado === 'APROBADO') {
        throw new BadRequestException('Ese gasto ya fue aprobado.');
      }
      if (monto.greaterThan(gasto.fondo.saldoRetenido)) {
        throw new BadRequestException(
          `El fondo tiene S/ ${soles(gasto.fondo.saldoRetenido)} retenidos y el gasto aprobado ` +
            `es de S/ ${soles(monto)}.`,
        );
      }

      // Donaciones confirmadas del fondo con saldo por aplicar, de la mas
      // antigua a la mas reciente. El FOR UPDATE bloquea las filas para que
      // otra aprobacion simultanea no las consuma en paralelo.
      const disponibles = await tx.$queryRaw<
        { id: string; donante_id: string; disponible: Prisma.Decimal }[]
      >`
        SELECT id, donante_id, (monto_neto - monto_aplicado) AS disponible
          FROM donaciones
         WHERE fondo_id = ${gasto.fondoId}::uuid
           AND estado = 'CONFIRMADA'
           AND monto_neto > monto_aplicado
         ORDER BY confirmada_en ASC, creado_en ASC
           FOR UPDATE
      `;

      const aplicaciones: ResultadoAplicacion['aplicaciones'] = [];
      let restante = monto;

      for (const donacion of disponibles) {
        if (restante.lessThanOrEqualTo(0)) break;

        const disponible = new Prisma.Decimal(donacion.disponible);
        const aplicar = Prisma.Decimal.min(restante, disponible);

        await tx.aplicacionDonacion.create({
          data: { gastoId: gasto.id, donacionId: donacion.id, monto: aplicar },
        });

        aplicaciones.push({
          donacionId: donacion.id,
          donanteId: donacion.donante_id,
          monto: soles(aplicar),
        });
        restante = restante.minus(aplicar);
      }

      if (restante.greaterThan(0)) {
        // Puede ocurrir si el saldo retenido del fondo y las donaciones
        // disponibles no coinciden; es un descuadre y debe frenar aqui.
        throw new BadRequestException(
          `No hay donaciones suficientes para cubrir S/ ${soles(monto)}; ` +
            `faltan S/ ${soles(restante)}. Revise la conciliacion del fondo.`,
        );
      }

      await this.libro.asentarEjecucionGasto(tx, {
        fondoId: gasto.fondoId,
        gastoId: gasto.id,
        monto,
        creadoPor: datos.aprobadoPor,
      });

      // El UPDATE va al final: el trigger de coherencia exige que exista ya
      // un analisis ALTO o una revision aprobatoria, y el de cuadre valida
      // al hacer commit que la suma aplicada iguale este monto (RN-04).
      await tx.gasto.update({
        where: { id: gasto.id },
        data: { estado: 'APROBADO', montoAprobado: monto, aprobadoEn: new Date() },
      });

      this.logger.log(
        `Gasto ${gasto.id} aprobado por S/ ${soles(monto)} y aplicado a ${aplicaciones.length} donacion(es).`,
      );

      return { gastoId: gasto.id, montoAprobado: soles(monto), aplicaciones };
    });
  }
}
