import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Configuracion } from '../../../config/configuracion';
import type {
  EntradaAnalisis,
  ResultadoAnalisis,
} from '../contrato/analisis.contrato';
import type { MotorVerificacion } from '../puertos/motor-verificacion.port';
import { MotorReglasV0 } from './reglas-v0.motor';

/**
 * Cliente del servicio AIni (apps/aini).
 *
 * Es la segunda implementacion de MotorVerificacion, y entra sin que nada mas
 * del sistema lo note: misma interfaz, mismo contrato de datos, mismo lugar
 * donde se persiste el resultado. Para eso se construyo el seam.
 *
 * **El respaldo no es una cortesia, es parte del diseño.** Si el servicio de
 * analisis no responde, el gasto NO queda sin verificar: lo resuelve el motor
 * determinista, y el analisis guardado dice cual de los dos lo hizo. Una ONG
 * esperando que se libere su dinero no puede quedar bloqueada porque un
 * proceso de Python se cayo, y un auditor tiene que poder saber despues con
 * que motor se tomo cada decision.
 */
@Injectable()
export class MotorAIni implements MotorVerificacion {
  private readonly logger = new Logger(MotorAIni.name);

  /**
   * Se declara la del respaldo hasta hablar con el servicio.
   *
   * La version es lo que queda escrito en `analisis_aini.version_modelo` y es
   * la unica forma de auditar despues que motor decidio cada caso. Afirmar
   * "aini" antes de que AIni haya respondido falsearia ese registro.
   */
  get version(): string {
    return this.ultimaVersion;
  }

  private ultimaVersion: string;

  constructor(
    private readonly config: ConfigService<Configuracion, true>,
    @Inject(MotorReglasV0) private readonly respaldo: MotorReglasV0,
  ) {
    this.ultimaVersion = respaldo.version;
  }

  async analizar(entrada: EntradaAnalisis): Promise<ResultadoAnalisis> {
    const url = this.config.get('AINI_URL', { infer: true });
    if (!url) {
      this.logger.warn('AINI_URL no esta configurada; se analiza con el motor de reglas.');
      return this.conRespaldo(entrada, 'sin configurar');
    }

    const inicio = Date.now();

    try {
      const resultado = await this.pedirAnalisis(url, entrada);
      this.ultimaVersion = `motor-verificacion@${resultado.versionModelo}`;
      return { ...resultado, versionModelo: this.ultimaVersion, duracionMs: Date.now() - inicio };
    } catch (error) {
      const motivo = error instanceof Error ? error.message : String(error);
      this.logger.error(`AIni no pudo analizar el gasto ${entrada.gastoId}: ${motivo}`);
      return this.conRespaldo(entrada, motivo);
    }
  }

  private async pedirAnalisis(url: string, entrada: EntradaAnalisis): Promise<ResultadoAnalisis> {
    const token = this.config.get('AINI_TOKEN', { infer: true });
    const tiempoLimite = this.config.get('AINI_TIMEOUT_MS', { infer: true });

    // El timeout es obligatorio y no opcional: sin el, un servicio que acepta
    // la conexion pero nunca responde deja al trabajador de la cola colgado y
    // detiene la verificacion de todos los demas gastos.
    const corte = AbortSignal.timeout(tiempoLimite);

    const respuesta = await fetch(`${url.replace(/\/$/, '')}/analizar`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(entrada),
      signal: corte,
    });

    if (!respuesta.ok) {
      const cuerpo = await respuesta.text().catch(() => '');
      throw new Error(`respondio ${respuesta.status} ${cuerpo.slice(0, 200)}`);
    }

    const datos: unknown = await respuesta.json();
    return this.validar(datos);
  }

  /**
   * Comprueba la forma de la respuesta antes de confiar en ella.
   *
   * El servicio es nuestro, pero eso no lo vuelve confiable por decreto: una
   * version desplegada a destiempo o un cambio de contrato a medias llegarian
   * aqui como un objeto con campos faltantes, y guardarlo sin mirar meteria
   * datos invalidos en el registro de analisis. Mejor caer al respaldo.
   */
  private validar(datos: unknown): ResultadoAnalisis {
    if (typeof datos !== 'object' || datos === null) {
      throw new Error('la respuesta no es un objeto');
    }

    const r = datos as Partial<ResultadoAnalisis>;
    const numericos = ['scoreDocumental', 'scoreVisual', 'scoreAnomalia', 'scoreFinal'] as const;

    for (const campo of numericos) {
      const valor = r[campo];
      if (typeof valor !== 'number' || Number.isNaN(valor) || valor < 0 || valor > 100) {
        throw new Error(`${campo} invalido: ${String(valor)}`);
      }
    }

    if (r.nivel !== 'ALTO' && r.nivel !== 'MEDIO' && r.nivel !== 'BAJO') {
      throw new Error(`nivel invalido: ${String(r.nivel)}`);
    }
    if (!r.explicacion || !Array.isArray(r.explicacion.motivos)) {
      throw new Error('falta la explicacion, que el RNF-09 exige');
    }
    if (!r.datosExtraidos || typeof r.versionModelo !== 'string') {
      throw new Error('faltan datosExtraidos o versionModelo');
    }

    return {
      ...(r as ResultadoAnalisis),
      alertas: Array.isArray(r.alertas) ? r.alertas : [],
      narrativaBorrador: r.narrativaBorrador ?? null,
    };
  }

  /**
   * Resuelve con el motor determinista y lo deja escrito en la explicacion.
   *
   * El motivo adicional no es ruido: un auditor que ve un gasto resuelto por
   * reglas cuando el sistema deberia estar usando AIni necesita saber que no
   * fue una decision de diseño sino una caida, y poder preguntarse si conviene
   * revisarlo a mano.
   */
  private async conRespaldo(entrada: EntradaAnalisis, motivo: string): Promise<ResultadoAnalisis> {
    const resultado = await this.respaldo.analizar(entrada);
    this.ultimaVersion = resultado.versionModelo;

    return {
      ...resultado,
      explicacion: {
        ...resultado.explicacion,
        motivos: [
          {
            regla: 'aini.respaldo',
            senal: 'documental',
            resultado: 'advertencia',
            mensaje:
              'El servicio de analisis no estuvo disponible; este gasto se evaluo con el ' +
              'motor de reglas deterministas.',
            valor: motivo.slice(0, 120),
            penalizacion: 0,
          },
          ...resultado.explicacion.motivos,
        ],
      },
    };
  }
}
