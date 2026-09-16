import { Injectable } from '@nestjs/common';
import { hash, verify } from '@node-rs/argon2';

/**
 * Hash de contraseñas con Argon2id.
 *
 * Se usa @node-rs/argon2 y no bcrypt ni la implementacion en C: publica
 * binarios precompilados, asi que no hace falta un compilador de C++ en
 * Windows para instalar el proyecto. Para un equipo pequeño que desarrolla en
 * Windows, eso es la diferencia entre `npm install` y una tarde perdida.
 *
 * Argon2id es la recomendacion actual de OWASP frente a bcrypt: resiste tanto
 * ataques con GPU como los de canal lateral.
 */
@Injectable()
export class HashService {
  /**
   * Parametros de OWASP para Argon2id: 19 MiB de memoria, 2 iteraciones y
   * 1 hilo. El costo de memoria es lo que encarece el ataque en paralelo.
   */
  private readonly opciones = {
    memoryCost: 19_456,
    timeCost: 2,
    parallelism: 1,
  } as const;

  async generar(clave: string): Promise<string> {
    return hash(clave, this.opciones);
  }

  /**
   * Verifica una contraseña. Devuelve false ante un hash corrupto o de otro
   * algoritmo en lugar de lanzar: un registro dañado en la base no debe
   * convertirse en un error 500 que revele que la cuenta existe.
   */
  async verificar(hashAlmacenado: string, clave: string): Promise<boolean> {
    try {
      return await verify(hashAlmacenado, clave);
    } catch {
      return false;
    }
  }
}
