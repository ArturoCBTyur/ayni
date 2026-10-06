import {
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import { CifradoService } from '../../../comun/cifrado/cifrado.service';
import { contextoArchivo, ErrorCifrado } from '../../../comun/cifrado/sobre';
import type { Configuracion } from '../../../config/configuracion';
import type {
  AccionArchivo,
  AlmacenamientoArchivos,
  ArchivoGuardado,
  UrlFirmada,
} from '../puertos/almacenamiento.port';

/**
 * Almacenamiento en disco con URLs firmadas (ADR-0003).
 *
 * Imita el contrato de las URLs prefirmadas de S3: cada URL vale para un
 * objeto, una accion y un plazo. Asi el codigo de dominio y el frontend se
 * escriben una sola vez, y migrar a S3 en el despliegue es cambiar una
 * variable de entorno.
 *
 * El contenido se guarda cifrado (RNF-01) y atado a su clave de objeto: quien
 * copie la carpeta no ve las fotos de los beneficiarios, y quien cambie un
 * archivo por otro deja una evidencia que no abre. La huella SHA-256 se
 * calcula sobre el contenido original, no sobre el sobre, porque es la
 * identidad de la evidencia y no debe depender de la clave con que se guardo.
 */
@Injectable()
export class AlmacenamientoDisco implements AlmacenamientoArchivos {
  readonly nombre = 'disco';

  private readonly logger = new Logger(AlmacenamientoDisco.name);
  private readonly raiz: string;
  private readonly secreto: string;
  private readonly ttl: number;

  constructor(
    private readonly config: ConfigService<Configuracion, true>,
    private readonly cifrado: CifradoService,
  ) {
    this.raiz = resolve(process.cwd(), this.config.get('STORAGE_DIR', { infer: true }));
    this.secreto = this.config.get('STORAGE_URL_SECRET', { infer: true });
    this.ttl = this.config.get('STORAGE_URL_TTL', { infer: true });
  }

  async emitirUrlSubida(opciones: {
    carpeta: string;
    extension: string;
    mime: string;
  }): Promise<UrlFirmada> {
    const objeto = `${opciones.carpeta}/${randomUUID()}.${opciones.extension.replace(/^\./, '')}`;
    return Promise.resolve(this.firmarUrl(objeto, 'subir', this.ttl));
  }

  async guardar(objeto: string, contenido: Buffer, mime: string): Promise<ArchivoGuardado> {
    const ruta = this.rutaDe(objeto);
    await mkdir(dirname(ruta), { recursive: true });
    await writeFile(ruta, this.cifrado.sellarBytes(contenido, contextoArchivo(objeto)));

    return {
      objeto,
      bytes: contenido.byteLength,
      hashSha256: createHash('sha256').update(contenido).digest('hex'),
      mime,
    };
  }

  async leer(objeto: string): Promise<Buffer> {
    let guardado: Buffer;
    try {
      guardado = await readFile(this.rutaDe(objeto));
    } catch {
      throw new NotFoundException('El archivo ya no esta disponible.');
    }

    try {
      return this.cifrado.abrirBytes(guardado, contextoArchivo(objeto));
    } catch (error) {
      if (!(error instanceof ErrorCifrado)) throw error;
      // No es un 404: el archivo esta, y lo que no cuadra es su contenido.
      // Una evidencia alterada es un incidente, no un enlace roto.
      this.logger.error(`Evidencia ${objeto} no abre (${error.motivo}): ${error.message}`);
      throw new InternalServerErrorException(
        'El archivo no supera la verificacion de integridad. Se registro el incidente.',
      );
    }
  }

  emitirUrlDescarga(objeto: string, segundos = this.ttl): UrlFirmada {
    return this.firmarUrl(objeto, 'descargar', segundos);
  }

  verificarToken(objeto: string, token: string | undefined, accion: AccionArchivo): boolean {
    if (!token) return false;

    const [expiraTexto, firma] = token.split('.');
    if (!expiraTexto || !firma) return false;

    const expira = Number(expiraTexto);
    if (!Number.isFinite(expira) || expira < Date.now()) return false;

    const esperada = Buffer.from(this.firmar(objeto, accion, expira), 'utf8');
    const recibida = Buffer.from(firma, 'utf8');
    if (esperada.length !== recibida.length) return false;

    return timingSafeEqual(esperada, recibida);
  }

  async eliminar(objeto: string): Promise<void> {
    try {
      await rm(this.rutaDe(objeto));
    } catch {
      this.logger.warn(`No se pudo eliminar ${objeto}; puede que ya no existiera.`);
    }
  }

  async existe(objeto: string): Promise<boolean> {
    try {
      await stat(this.rutaDe(objeto));
      return true;
    } catch {
      return false;
    }
  }

  private firmarUrl(objeto: string, accion: AccionArchivo, segundos: number): UrlFirmada {
    const expira = Date.now() + segundos * 1000;
    const token = `${expira}.${this.firmar(objeto, accion, expira)}`;
    const prefijo = this.config.get('API_PREFIX', { infer: true });

    return {
      objeto,
      url: `/${prefijo}/almacenamiento/${objeto}?token=${token}`,
      expiraEn: new Date(expira),
    };
  }

  private firmar(objeto: string, accion: AccionArchivo, expira: number): string {
    return createHmac('sha256', this.secreto)
      .update(`${accion}:${objeto}:${expira}`)
      .digest('hex');
  }

  /**
   * Resuelve la ruta en disco de un objeto.
   *
   * Rechaza cualquier clave que escape de la carpeta raiz. Sin esta
   * comprobacion, un objeto llamado "../../.env" permitiria leer archivos
   * del servidor a traves de una URL de descarga legitima.
   */
  private rutaDe(objeto: string): string {
    const limpio = normalize(objeto).replace(/^([/\\])+/, '');
    const ruta = resolve(join(this.raiz, limpio));

    if (ruta !== this.raiz && !ruta.startsWith(this.raiz + sep)) {
      throw new NotFoundException('Ruta de archivo invalida.');
    }
    return ruta;
  }
}
