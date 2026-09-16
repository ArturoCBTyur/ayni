/**
 * Contrato de almacenamiento de archivos (ADR-0003).
 *
 * El dominio pide una URL de subida y recibe una; no sabe si detras hay
 * disco local o S3. Las URLs se firman y caducan desde el primer dia para
 * que el control de acceso a las evidencias sea correcto en desarrollo y no
 * algo que se arregla al desplegar.
 */
export type AccionArchivo = 'subir' | 'descargar';

export interface UrlFirmada {
  /** Clave del objeto dentro del almacen. */
  objeto: string;
  url: string;
  expiraEn: Date;
}

export interface ArchivoGuardado {
  objeto: string;
  bytes: number;
  /** SHA-256 del contenido: identidad exacta del archivo. */
  hashSha256: string;
  mime: string;
}

export interface AlmacenamientoArchivos {
  readonly nombre: string;

  /** Emite una URL de subida para un objeto que aun no existe. */
  emitirUrlSubida(opciones: {
    carpeta: string;
    extension: string;
    mime: string;
  }): Promise<UrlFirmada>;

  /** Persiste el contenido y devuelve su huella. */
  guardar(objeto: string, contenido: Buffer, mime: string): Promise<ArchivoGuardado>;

  leer(objeto: string): Promise<Buffer>;

  /** URL de descarga temporal; es lo unico que se entrega al cliente. */
  emitirUrlDescarga(objeto: string, segundos?: number): UrlFirmada;

  verificarToken(objeto: string, token: string | undefined, accion: AccionArchivo): boolean;

  eliminar(objeto: string): Promise<void>;

  existe(objeto: string): Promise<boolean>;
}

export const ALMACENAMIENTO = Symbol('ALMACENAMIENTO');
