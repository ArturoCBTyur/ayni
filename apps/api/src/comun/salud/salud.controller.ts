import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Publico } from '../../modules/identidad/decoradores';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Criterio de salida de la Fase 0: este endpoint responde desde el
 * frontend Flutter y reporta la version real de PostgreSQL.
 */
@Publico()
@ApiTags('salud')
@Controller('salud')
export class SaludController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @ApiOperation({ summary: 'Estado del servicio y de la base de datos' })
  async estado() {
    const inicio = Date.now();
    const [{ version }] = await this.prisma.$queryRaw<{ version: string }[]>`SELECT version()`;
    const tablas = await this.prisma.$queryRaw<{ total: bigint }[]>`
      SELECT count(*)::bigint AS total
        FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    `;

    return {
      estado: 'ok',
      servicio: 'Ayni API',
      // El sufijo decia "sin-ia" y dejo de ser cierto al entrar AIni. Que
      // motor esta activo lo dice el campo de abajo, que es el dato util.
      version: '0.2.0-mvp',
      motorVerificacion: process.env.VERIFICACION_DRIVER ?? 'reglas-v0',
      baseDatos: {
        conectada: true,
        version: version.split(',')[0],
        tablas: Number(tablas[0]?.total ?? 0),
        latenciaMs: Date.now() - inicio,
      },
      fecha: new Date().toISOString(),
    };
  }
}
