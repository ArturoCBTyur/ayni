import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

import { PrismaService } from '../prisma/prisma.service';

export interface ContextoPeticion {
  ip?: string;
  userAgent?: string;
}

export interface EntradaBitacora extends ContextoPeticion {
  usuarioId?: string | null;
  accion: string;
  entidad: string;
  entidadId?: string | null;
  valorAnterior?: Prisma.InputJsonValue | null;
  valorNuevo?: Prisma.InputJsonValue | null;
}

/**
 * Bitacora de acciones sensibles (RNF-08).
 *
 * Punto de escritura de bitacora_auditoria para todo lo que ocurre fuera de
 * una transaccion. Centralizarlo importa porque la bitacora se audita: si
 * cada modulo diera su propio formato a valorAnterior y valorNuevo, el
 * registro dejaria de ser comparable entre entidades justo cuando se
 * necesita compararlo.
 *
 * La excepcion deliberada son los registros que deben ser atomicos con el
 * cambio que describen, como la creacion de una cuenta con sus
 * consentimientos: esos se escriben con el cliente de la transaccion, para
 * que no pueda existir el hecho sin su rastro.
 *
 * Nunca hace fallar la operacion que registra. Si la escritura de la
 * bitacora falla, se deja constancia en el log del servidor pero no se
 * revierte un movimiento contable ya confirmado: perder el rastro es malo,
 * perder el asiento es peor.
 */
@Injectable()
export class BitacoraService {
  private readonly logger = new Logger(BitacoraService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Extrae IP y agente de una peticion, para no repetirlo en cada modulo. */
  static contexto(req: Request): ContextoPeticion {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  async registrar(entrada: EntradaBitacora): Promise<void> {
    try {
      await this.prisma.bitacoraAuditoria.create({
        data: {
          usuarioId: entrada.usuarioId ?? null,
          accion: entrada.accion,
          entidad: entrada.entidad,
          entidadId: entrada.entidadId ?? null,
          valorAnterior: entrada.valorAnterior ?? undefined,
          valorNuevo: entrada.valorNuevo ?? undefined,
          ip: entrada.ip,
          userAgent: entrada.userAgent,
        },
      });
    } catch (error) {
      this.logger.error(
        `No se pudo registrar en bitacora: ${entrada.accion} sobre ${entrada.entidad}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  /**
   * Registra un cambio comparando antes y despues.
   *
   * Solo guarda los campos que efectivamente cambiaron. Volcar el registro
   * completo llenaria la bitacora de ruido y haria mas dificil ver que se
   * modifico, que es la unica pregunta que esta tabla existe para responder.
   */
  async registrarCambio<T extends Record<string, unknown>>(
    entrada: Omit<EntradaBitacora, 'valorAnterior' | 'valorNuevo'> & {
      antes: T;
      despues: T;
      /** Campos a vigilar. Si se omite, se comparan todos los de `despues`. */
      campos?: Array<keyof T>;
    },
  ): Promise<void> {
    const { antes, despues, campos, ...resto } = entrada;
    const aVigilar = campos ?? Object.keys(despues);

    const anterior: Record<string, unknown> = {};
    const nuevo: Record<string, unknown> = {};

    for (const campo of aVigilar) {
      if (!Object.is(normalizar(antes[campo]), normalizar(despues[campo]))) {
        anterior[String(campo)] = normalizar(antes[campo]);
        nuevo[String(campo)] = normalizar(despues[campo]);
      }
    }

    if (Object.keys(nuevo).length === 0) return;

    await this.registrar({
      ...resto,
      valorAnterior: anterior as Prisma.InputJsonValue,
      valorNuevo: nuevo as Prisma.InputJsonValue,
    });
  }
}

/** Detecta un Decimal de Prisma por su interfaz, sin importar la clase. */
function esDecimal(valor: unknown): valor is { toFixed: () => string } {
  return (
    typeof valor === 'object' &&
    valor !== null &&
    'toFixed' in valor &&
    typeof valor.toFixed === 'function'
  );
}

/**
 * Convierte fechas y Decimal de Prisma a algo comparable y serializable.
 *
 * Sin esto, dos Decimal con el mismo valor se verian como un cambio, y la
 * bitacora reportaria modificaciones que nunca ocurrieron. Los importes se
 * guardan como texto para no perder precision al pasar por JSON.
 */
function normalizar(valor: unknown): unknown {
  if (valor === null || valor === undefined) return null;
  if (valor instanceof Date) return valor.toISOString();
  if (esDecimal(valor)) return valor.toFixed();
  if (typeof valor === 'object') return JSON.parse(JSON.stringify(valor)) as unknown;
  return valor;
}
