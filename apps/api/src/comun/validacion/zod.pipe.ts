import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { ZodError, ZodSchema } from 'zod';

/**
 * Valida el cuerpo, los parametros o la consulta contra un esquema Zod.
 *
 * Se usa Zod en lugar del ValidationPipe de NestJS, que depende de
 * class-validator y de DTO decorados. Con una sola libreria de validacion,
 * la configuracion del arranque y los contratos de la API se describen igual,
 * y el tipo de TypeScript se deriva del esquema en vez de declararse dos
 * veces.
 *
 * Uso:
 *   @Post()
 *   crear(@Body(new ZodPipe(esquemaCrearDonacion)) dto: CrearDonacion) { ... }
 */
@Injectable()
export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly esquema: ZodSchema<T>) {}

  transform(valor: unknown): T {
    try {
      return this.esquema.parse(valor);
    } catch (error) {
      if (error instanceof ZodError) {
        // RF-PS-05: el error dice que campo esta mal y por que, para que la
        // interfaz pueda senalarlo sin tener que interpretar un mensaje.
        throw new BadRequestException({
          message: 'Algunos datos no son validos. Revise los campos senalados.',
          errores: error.issues.map((i) => ({
            campo: i.path.join('.') || '(raiz)',
            mensaje: i.message,
          })),
        });
      }
      throw error;
    }
  }
}
