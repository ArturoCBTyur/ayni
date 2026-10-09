import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { soles } from '../../comun/dinero';
import { esCodigoDePeriodo, periodo } from '../../comun/periodo';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { lineasPle, nombreArchivoPle, type LibroPle } from '../contable/ple';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import { EstadosService } from './estados.service';

/**
 * RF-CF-10 · Borrador del libro diario y mayor de una ONG en formato PLE.
 *
 * El PLE es por contribuyente y por mes, no por fondo: junta los libros de
 * todos los fondos de la ONG. Ver contable/ple.ts para lo que falta validar.
 */
@Injectable()
export class PleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly estados: EstadosService,
  ) {}

  async borrador(
    ongId: string,
    codigo: string,
    libro: LibroPle,
    usuario: CargaAcceso,
  ): Promise<{ nombre: string; texto: string }> {
    if (!esCodigoDePeriodo(codigo)) {
      throw new BadRequestException('El periodo se indica como AAAA-MM, por ejemplo 2026-09.');
    }
    const ong = await this.prisma.ong.findUnique({ where: { id: ongId } });
    if (!ong) throw new NotFoundException('No encontramos esa organizacion.');
    await this.estados.exigirAccesoAOng(ongId, usuario);

    const p = periodo(codigo);
    const movimientos = await this.prisma.movimientoContable.findMany({
      where: { fondo: { campana: { ongId } }, creadoEn: { gte: p.desde, lt: p.hasta } },
      orderBy: [{ creadoEn: 'asc' }, { fondoId: 'asc' }, { secuencia: 'asc' }],
      include: { gasto: { include: { comprobante: true } } },
    });

    const lineas = lineasPle(
      movimientos.map((m) => ({
        fondoId: m.fondoId,
        secuencia: Number(m.secuencia),
        fecha: m.creadoEn,
        tipo: m.tipo,
        monto: soles(m.monto),
        descripcion: m.descripcion,
        comprobante: m.gasto?.comprobante ?? null,
      })),
      p,
      libro,
    );

    return {
      nombre: `BORRADOR-${nombreArchivoPle(ong.ruc, p, libro, lineas.length > 0)}`,
      texto: lineas.length ? `${lineas.join('\r\n')}\r\n` : '',
    };
  }
}
