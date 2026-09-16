import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { ZodPipe } from '../../comun/validacion/zod.pipe';
import { Roles, UsuarioActual } from '../identidad/decoradores';
import { ColaVerificacionService } from './cola.service';
import { MOTOR_VERIFICACION, type MotorVerificacion } from './puertos/motor-verificacion.port';
import { VerificacionService } from './verificacion.service';
import { Inject } from '@nestjs/common';

/**
 * CU18 · Umbrales y pesos configurables.
 *
 * Cambiar la regla no reescribe el pasado: cada analisis guarda el id de la
 * regla con la que se evaluo (RN-06), asi que un gasto aprobado con los
 * umbrales de ayer sigue siendo auditable con los umbrales de ayer.
 */
const esquemaRegla = z
  .object({
    umbralAlto: z.coerce.number().int().min(1).max(100),
    umbralMedio: z.coerce.number().int().min(0).max(99),
    pesoDocumental: z.coerce.number().min(0).max(1),
    pesoVisual: z.coerce.number().min(0).max(1),
    pesoAnomalia: z.coerce.number().min(0).max(1),
  })
  .superRefine((datos, ctx) => {
    if (datos.umbralAlto <= datos.umbralMedio) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['umbralAlto'],
        message: 'El umbral ALTO debe ser mayor que el MEDIO.',
      });
    }
    const suma = datos.pesoDocumental + datos.pesoVisual + datos.pesoAnomalia;
    if (Math.abs(suma - 1) > 0.001) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pesoDocumental'],
        message: `Los tres pesos deben sumar 1; suman ${suma.toFixed(3)}.`,
      });
    }
  });
type ReglaEntrada = z.infer<typeof esquemaRegla>;

@ApiTags('verificacion')
@Controller('verificacion')
export class VerificacionController {
  constructor(
    private readonly verificacion: VerificacionService,
    private readonly cola: ColaVerificacionService,
    private readonly prisma: PrismaService,
    private readonly bitacora: BitacoraService,
    @Inject(MOTOR_VERIFICACION) private readonly motor: MotorVerificacion,
  ) {}

  @Roles('ADMIN', 'AUDITOR')
  @Get('estado')
  @ApiOperation({ summary: 'Motor activo, regla vigente y estado de la cola' })
  async estado() {
    const [regla, cola, modelos] = await Promise.all([
      this.prisma.reglaConfianza.findFirst({ where: { activa: true } }),
      this.cola.estado(),
      this.prisma.modeloIa.findMany({ where: { estado: 'ACTIVO' } }),
    ]);

    return {
      motor: this.motor.version,
      // Deja explicito que esta version no usa IA, que es justo lo que un
      // revisor del curso querra confirmar.
      usaInteligenciaArtificial: modelos.some((m) => m.tipo !== 'REGLAS'),
      regla: regla && {
        id: regla.id,
        umbralAlto: regla.umbralAlto,
        umbralMedio: regla.umbralMedio,
        pesos: {
          documental: regla.pesoDocumental.toNumber(),
          visual: regla.pesoVisual.toNumber(),
          anomalia: regla.pesoAnomalia.toNumber(),
        },
        vigenteDesde: regla.vigenteDesde,
      },
      cola,
    };
  }

  @Roles('ADMIN')
  @Post('regla')
  @ApiOperation({ summary: 'CU18 · Configurar umbrales y pesos de confianza' })
  async configurarRegla(
    @UsuarioActual('sub') adminId: string,
    @Body(new ZodPipe(esquemaRegla)) datos: ReglaEntrada,
    @Req() req: Request,
  ) {
    const anterior = await this.prisma.reglaConfianza.findFirst({ where: { activa: true } });

    const nueva = await this.prisma.$transaction(async (tx) => {
      if (anterior) {
        // La anterior no se borra: se cierra. Los analisis que la usaron
        // siguen apuntando a ella y pueden explicarse con sus umbrales.
        await tx.reglaConfianza.update({
          where: { id: anterior.id },
          data: { activa: false, vigenteHasta: new Date() },
        });
      }
      return tx.reglaConfianza.create({
        data: { ...datos, activa: true, configuradoPor: adminId },
      });
    });

    await this.bitacora.registrar({
      usuarioId: adminId,
      accion: 'REGLA_CONFIANZA_ACTUALIZADA',
      entidad: 'reglas_confianza',
      entidadId: nueva.id,
      valorAnterior: anterior
        ? { umbralAlto: anterior.umbralAlto, umbralMedio: anterior.umbralMedio }
        : null,
      valorNuevo: { umbralAlto: nueva.umbralAlto, umbralMedio: nueva.umbralMedio },
      ...BitacoraService.contexto(req),
    });

    return { id: nueva.id, umbralAlto: nueva.umbralAlto, umbralMedio: nueva.umbralMedio };
  }

  @Roles('ADMIN', 'AUDITOR')
  @Post('gastos/:id/reanalizar')
  @ApiOperation({ summary: 'Volver a analizar un gasto con la regla vigente' })
  async reanalizar(@Param('id', ParseUUIDPipe) gastoId: string) {
    return this.verificacion.analizarGasto(gastoId);
  }

  @Roles('ADMIN')
  @Post('cola/procesar')
  @ApiOperation({ summary: 'Forzar una pasada de la cola de verificacion' })
  async procesarCola() {
    const atendidos = await this.cola.procesarLote();
    return { atendidos };
  }
}
