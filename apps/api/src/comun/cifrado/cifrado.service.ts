import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Configuracion } from '../../config/configuracion';
import { abrir, abrirTexto, crearLlavero, sellar, sellarTexto, type Llavero } from './sobre';

/**
 * Cifrado en reposo de evidencias y secretos (RNF-01).
 *
 * Envuelve el sobre de `sobre.ts` con el llavero que sale de la
 * configuracion. Sin CIFRADO_CLAVE no cifra, y lo dice al arrancar: fuera de
 * produccion se admite para no romper un entorno local existente, pero en
 * produccion la configuracion no valida sin la clave.
 */
@Injectable()
export class CifradoService {
  private readonly logger = new Logger(CifradoService.name);
  private readonly llavero: Llavero;

  constructor(config: ConfigService<Configuracion, true>) {
    this.llavero = crearLlavero(
      config.get('CIFRADO_CLAVE', { infer: true }),
      config.get('CIFRADO_CLAVES_ANTERIORES', { infer: true }),
    );

    if (!this.activo) {
      this.logger.warn(
        'CIFRADO_CLAVE no esta definida: las evidencias y los secretos TOTP se guardan ' +
          'sin cifrar. Aceptable solo en desarrollo.',
      );
    }
  }

  get activo(): boolean {
    return this.llavero.actual !== null;
  }

  /** Id de la clave vigente, para la salud del servicio y los respaldos. */
  get idClave(): string | null {
    return this.llavero.actual?.id ?? null;
  }

  sellarBytes(contenido: Buffer, contexto: string): Buffer {
    return this.activo ? sellar(this.llavero, contenido, contexto) : contenido;
  }

  abrirBytes(datos: Buffer, contexto: string): Buffer {
    return abrir(this.llavero, datos, contexto);
  }

  sellarTexto(texto: string, contexto: string): string {
    return this.activo ? sellarTexto(this.llavero, texto, contexto) : texto;
  }

  abrirTexto(valor: string, contexto: string): string {
    return abrirTexto(this.llavero, valor, contexto);
  }
}
