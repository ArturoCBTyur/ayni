import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type { Configuracion } from '../../config/configuracion';
import { ColaVerificacionService } from './cola.service';
import { FakeSunatService } from './cpe/fake-sunat.service';
import { MotorReglasV0 } from './motores/reglas-v0.motor';
import { MOTOR_VERIFICACION } from './puertos/motor-verificacion.port';
import { SERVICIO_CPE } from './puertos/servicio-cpe.port';
import { VerificacionController } from './verificacion.controller';
import { VerificacionService } from './verificacion.service';

/**
 * Integracion AIni (Tabla 15 del Entregable 2).
 *
 * Aqui esta el seam. `MOTOR_VERIFICACION` se resuelve por configuracion, y
 * hoy solo existe una implementacion: MotorReglasV0, determinista y sin IA.
 *
 * Para incorporar AIni en la sesion siguiente basta con:
 *   1. crear MotorAIni contra la misma interfaz,
 *   2. registrarlo en este switch,
 *   3. poner VERIFICACION_DRIVER=aini,
 *   4. insertar su fila en modelos_ia.
 *
 * Nada mas del sistema cambia. Si el driver pedido no existe todavia, se
 * arranca con el motor de reglas y se avisa: dejar la plataforma sin
 * verificacion seria peor que verificar con reglas.
 */
@Module({
  controllers: [VerificacionController],
  providers: [
    VerificacionService,
    ColaVerificacionService,
    MotorReglasV0,
    FakeSunatService,
    { provide: SERVICIO_CPE, useExisting: FakeSunatService },
    {
      provide: MOTOR_VERIFICACION,
      inject: [ConfigService, MotorReglasV0],
      useFactory: (config: ConfigService<Configuracion, true>, reglas: MotorReglasV0) => {
        const driver = config.get('VERIFICACION_DRIVER', { infer: true });
        if (driver !== 'reglas-v0') {
          new Logger('VerificacionModule').warn(
            `VERIFICACION_DRIVER="${driver}" todavia no esta implementado; se usa ${reglas.version}.`,
          );
        }
        return reglas;
      },
    },
  ],
  exports: [VerificacionService, ColaVerificacionService],
})
export class VerificacionModule {}
