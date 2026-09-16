import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../comun/prisma/prisma.service';
import { soles } from '../../comun/dinero';
import { ASIENTOS } from './cuentas';

type Tx = Prisma.TransactionClient;

export interface RegistroIngreso {
  fondoId: string;
  donacionId: string;
  /** Monto bruto que el donante entrego. */
  montoBruto: Prisma.Decimal | number;
  /** Comision de la pasarela; puede ser cero. */
  comision: Prisma.Decimal | number;
  creadoPor?: string | null;
}

export interface VerificacionCadena {
  fondoId: string;
  movimientos: number;
  rota: boolean;
  secuenciaRota: number | null;
}

/**
 * Core Contable (Tabla 15): el libro de movimientos.
 *
 * Toda entrada y salida de dinero pasa por aqui. El servicio no calcula
 * secuencias ni hashes: los asigna la base en un trigger, de modo que ni un
 * error de este codigo ni un backend comprometido puedan falsificar la
 * cadena. Lo que si garantiza es que los asientos sean los correctos y que
 * ocurran dentro de una transaccion.
 */
@Injectable()
export class LibroService {
  private readonly logger = new Logger(LibroService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Asienta una donacion confirmada: INGRESO, COMISION y RETENCION.
   *
   * RN-02 exige que la comision sea un movimiento separado, para que el
   * donante pueda ver cuanto de su aporte llego realmente al fondo en lugar
   * de un neto ya mezclado.
   *
   * Recibe el cliente de transaccion en lugar de abrir una propia: estos tres
   * asientos y la confirmacion del pago tienen que ocurrir juntos o no
   * ocurrir. Un INGRESO sin su RETENCION dejaria dinero sin condicionar.
   */
  async asentarIngresoDonacion(tx: Tx, datos: RegistroIngreso) {
    const bruto = new Prisma.Decimal(datos.montoBruto);
    const comision = new Prisma.Decimal(datos.comision);
    const neto = bruto.minus(comision);

    if (neto.lessThanOrEqualTo(0)) {
      throw new Error(
        `La comision (${soles(comision)}) deja sin monto neto a la donacion ${datos.donacionId}.`,
      );
    }

    const movimientos = [];

    movimientos.push(
      await tx.movimientoContable.create({
        data: {
          fondoId: datos.fondoId,
          donacionId: datos.donacionId,
          tipo: 'INGRESO',
          ...this.asiento('INGRESO'),
          monto: bruto,
          descripcion: 'Ingreso de donacion',
          creadoPor: datos.creadoPor,
        },
      }),
    );

    if (comision.greaterThan(0)) {
      movimientos.push(
        await tx.movimientoContable.create({
          data: {
            fondoId: datos.fondoId,
            donacionId: datos.donacionId,
            tipo: 'COMISION',
            ...this.asiento('COMISION'),
            monto: comision,
            descripcion: 'Comision de la pasarela de pago',
            creadoPor: datos.creadoPor,
          },
        }),
      );
    }

    movimientos.push(
      await tx.movimientoContable.create({
        data: {
          fondoId: datos.fondoId,
          donacionId: datos.donacionId,
          tipo: 'RETENCION',
          ...this.asiento('RETENCION'),
          monto: neto,
          descripcion: 'Retencion condicionada a evidencia de gasto',
          creadoPor: datos.creadoPor,
        },
      }),
    );

    return { movimientos, neto };
  }

  /**
   * Asienta la ejecucion de un gasto aprobado.
   *
   * Libera la retencion y reconoce el gasto. Se invoca desde la aprobacion,
   * en la misma transaccion que la aplicacion FIFO a las donaciones, porque
   * el trigger de cuadre (RN-04) valida ambas cosas juntas al hacer commit.
   */
  async asentarEjecucionGasto(
    tx: Tx,
    datos: { fondoId: string; gastoId: string; monto: Prisma.Decimal | number; creadoPor?: string },
  ) {
    return tx.movimientoContable.create({
      data: {
        fondoId: datos.fondoId,
        gastoId: datos.gastoId,
        tipo: 'EJECUCION',
        ...this.asiento('EJECUCION'),
        monto: new Prisma.Decimal(datos.monto),
        descripcion: 'Ejecucion de gasto verificado',
        creadoPor: datos.creadoPor,
      },
    });
  }

  /**
   * Revierte un movimiento anterior.
   *
   * RN-03: los movimientos no se editan ni se eliminan. Una correccion es
   * siempre un asiento nuevo que apunta al que corrige, de modo que el
   * historial conserve tanto el error como su enmienda.
   */
  async asentarReverso(
    tx: Tx,
    datos: {
      movimientoId: string;
      motivo: string;
      creadoPor?: string;
    },
  ) {
    const original = await tx.movimientoContable.findUniqueOrThrow({
      where: { id: datos.movimientoId },
    });

    return tx.movimientoContable.create({
      data: {
        fondoId: original.fondoId,
        gastoId: original.gastoId,
        donacionId: original.donacionId,
        movimientoReversadoId: original.id,
        tipo: 'REVERSO',
        ...this.asiento('REVERSO'),
        monto: original.monto,
        descripcion: `Reverso del movimiento ${original.secuencia}: ${datos.motivo}`,
        creadoPor: datos.creadoPor,
      },
    });
  }

  /** Extracto del libro de un fondo, en el orden en que ocurrio. */
  async extracto(fondoId: string) {
    const movimientos = await this.prisma.movimientoContable.findMany({
      where: { fondoId },
      orderBy: { secuencia: 'asc' },
    });

    return movimientos.map((m) => ({
      secuencia: Number(m.secuencia),
      fecha: m.creadoEn,
      tipo: m.tipo,
      debe: m.cuentaDebe,
      haber: m.cuentaHaber,
      monto: soles(m.monto),
      descripcion: m.descripcion,
      donacionId: m.donacionId,
      gastoId: m.gastoId,
      // Los hashes permiten a un tercero recalcular la cadena por su cuenta.
      hashPrevio: m.hashPrevio,
      hashActual: m.hashActual,
    }));
  }

  /**
   * Verifica la cadena de hashes de un fondo (RNF-07).
   *
   * Delega en la funcion de la base: recalcular en TypeScript lo que calcula
   * PostgreSQL abriria la puerta a que ambas implementaciones difieran y a
   * que la verificacion pase cuando no deberia.
   */
  async verificarCadena(fondoId: string): Promise<VerificacionCadena> {
    const [fila] = await this.prisma.$queryRaw<
      { fondo_id: string; movimientos: bigint; rota: boolean; secuencia_rota: bigint | null }[]
    >`SELECT * FROM fn_verificar_cadena(${fondoId}::uuid)`;

    return {
      fondoId,
      movimientos: Number(fila.movimientos),
      rota: fila.rota,
      secuenciaRota: fila.secuencia_rota === null ? null : Number(fila.secuencia_rota),
    };
  }

  /** Verifica la cadena de todos los fondos; lo usa el job diario. */
  async verificarTodasLasCadenas(): Promise<VerificacionCadena[]> {
    const fondos = await this.prisma.fondo.findMany({ select: { id: true } });
    const resultados = await Promise.all(fondos.map((f) => this.verificarCadena(f.id)));

    const rotas = resultados.filter((r) => r.rota);
    if (rotas.length > 0) {
      this.logger.error(
        `Cadena de hashes rota en ${rotas.length} fondo(s): ${rotas.map((r) => r.fondoId).join(', ')}`,
      );
    }

    return resultados;
  }

  private asiento(tipo: keyof typeof ASIENTOS) {
    return { cuentaDebe: ASIENTOS[tipo].debe, cuentaHaber: ASIENTOS[tipo].haber };
  }
}
