import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { soles } from '../../comun/dinero';
import { periodoDe } from '../../comun/periodo';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { calcularImpacto } from '../gastos/impacto';
import { documentoIati, type ActividadIati } from './iati';

/** Fecha de Lima como AAAA-MM-DD, la forma de las fechas en IATI. */
function isoLima(instante: Date): string {
  return new Date(instante.getTime() - 5 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * RF-IN-06 · Datos abiertos de una ONG en IATI (T7.1).
 *
 * Solo de ONG verificadas y de campañas que alguna vez se publicaron: un
 * borrador no es una actividad. Todo sale de registros que ya son publicos en
 * la ficha de cada causa, sin nombres de donantes ni de proveedores que son
 * personas naturales.
 */
@Injectable()
export class DatosAbiertosService {
  constructor(private readonly prisma: PrismaService) {}

  async iati(ongId: string, ahora = new Date()): Promise<{ nombre: string; xml: string }> {
    const ong = await this.prisma.ong.findUnique({
      where: { id: ongId },
      include: {
        campanas: {
          where: { estado: { not: 'BORRADOR' } },
          orderBy: { creadoEn: 'asc' },
          include: { fondos: { include: { cierreCausa: true } } },
        },
      },
    });
    if (!ong || ong.estadoVerificacion !== 'VERIFICADA') {
      throw new NotFoundException('No hay datos abiertos de esa organizacion.');
    }

    const org = { ref: `PE-RUC-${ong.ruc}`, nombre: ong.razonSocial };
    const actividades: ActividadIati[] = [];

    for (const campana of ong.campanas) {
      const fondoIds = campana.fondos.map((f) => f.id);
      const [movimientos, gastos] = await Promise.all([
        this.prisma.movimientoContable.findMany({
          where: {
            fondoId: { in: fondoIds },
            tipo: { in: ['INGRESO', 'TRASLADO_ENTRADA', 'DEVOLUCION', 'TRASLADO_SALIDA'] },
          },
          select: { tipo: true, monto: true, creadoEn: true, donacionId: true },
          orderBy: { creadoEn: 'asc' },
        }),
        this.prisma.gasto.findMany({
          where: { fondoId: { in: fondoIds }, estado: 'APROBADO' },
          orderBy: { fechaGasto: 'asc' },
          include: { comprobante: true, fondo: { select: { categoriaGasto: true } } },
        }),
      ]);

      // Lo que entra y lo que sale por cierre, sumado por mes y por tipo.
      const porMes = new Map<
        string,
        { tipo: 1 | 3; fecha: Date; monto: Prisma.Decimal; descripcion: string; otro: string }
      >();
      for (const m of movimientos) {
        const mes = periodoDe(m.creadoEn).codigo;
        const [tipo, descripcion, otro] =
          m.tipo === 'INGRESO'
            ? ([1, `Donaciones de ${mes}`, 'Donantes individuales'] as const)
            : m.tipo === 'TRASLADO_ENTRADA'
              ? ([
                  1,
                  `Remanentes recibidos del cierre de otras causas, ${mes}`,
                  'Donantes individuales',
                ] as const)
              : m.tipo === 'DEVOLUCION'
                ? ([
                    3,
                    `Remanente devuelto a sus donantes, ${mes}`,
                    'Donantes individuales',
                  ] as const)
                : ([
                    3,
                    `Remanente trasladado a otras causas por elección de sus donantes, ${mes}`,
                    'Otras causas en Ayni',
                  ] as const);
        const clave = `${mes}:${m.tipo}`;
        const actual = porMes.get(clave) ?? {
          tipo,
          fecha: m.creadoEn,
          monto: new Prisma.Decimal(0),
          descripcion,
          otro,
        };
        actual.monto = actual.monto.plus(m.monto);
        actual.fecha = m.creadoEn;
        porMes.set(clave, actual);
      }

      const cierres = campana.fondos.map((f) => f.cierreCausa);
      const resuelta =
        campana.estado === 'CERRADA' && cierres.every((c) => c === null || c.estado === 'RESUELTO');
      const finReal = cierres
        .map((c) => c?.resueltoEn)
        .filter((f): f is Date => f instanceof Date)
        .sort((a, b) => b.getTime() - a.getTime())[0];

      const hasta = resuelta && finReal ? isoLima(finReal) : isoLima(ahora);
      const inicio = campana.fechaInicio.toISOString().slice(0, 10);

      actividades.push({
        identificador: `${org.ref}-${campana.id}`,
        titulo: campana.titulo,
        descripcion: campana.descripcion,
        estado:
          campana.estado === 'PAUSADA' ? 6 : campana.estado === 'CERRADA' ? (resuelta ? 4 : 3) : 2,
        inicio,
        fin: resuelta
          ? { fecha: hasta, real: true }
          : campana.fechaFin
            ? { fecha: campana.fechaFin.toISOString().slice(0, 10), real: false }
            : null,
        actualizada: campana.actualizadoEn,
        transacciones: [
          ...[...porMes.values()].map((t) =>
            t.tipo === 1
              ? {
                  tipo: 1 as const,
                  fecha: isoLima(t.fecha),
                  monto: soles(t.monto),
                  descripcion: t.descripcion,
                  proveedor: t.otro,
                }
              : {
                  tipo: 3 as const,
                  fecha: isoLima(t.fecha),
                  monto: soles(t.monto),
                  descripcion: t.descripcion,
                  receptor: t.otro,
                },
          ),
          ...gastos.map((g) => ({
            tipo: 4 as const,
            fecha: g.fechaGasto.toISOString().slice(0, 10),
            monto: soles(g.montoAprobado ?? g.montoDeclarado),
            descripcion: g.concepto,
            receptor:
              g.comprobante?.tipo === 'RECIBO_HONORARIOS'
                ? 'Persona natural (recibo por honorarios)'
                : g.proveedorNombre,
          })),
        ].sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0)),
        resultados: calcularImpacto(
          gastos.map((g) => ({
            categoria: g.fondo.categoriaGasto,
            monto: g.montoAprobado ?? g.montoDeclarado,
            unidades: g.unidadesImpacto,
          })),
        )
          .filter((i) => i.unidades > 0)
          .map((i) => ({ unidad: i.unidad, valor: i.unidades, desde: inicio, hasta })),
      });
    }

    return {
      nombre: `iati-${org.ref}.xml`,
      xml: documentoIati(org, actividades, ahora),
    };
  }
}
