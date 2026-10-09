import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';

import { jsonCanonico, sha256 } from '../../comun/canonico';
import {
  ZONA_LIMA,
  anterior,
  nombreDelPeriodo,
  periodo,
  periodoDe,
  siguiente,
  type Periodo,
} from '../../comun/periodo';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { EstadosService, VERSION_ESTADO, type ReferenciaCierre } from './estados.service';

export interface ResumenCierre {
  /** Ultimo mes terminado, el que se esta cerrando. */
  hasta: string;
  cierres: number;
  fondos: number;
  avisos: number;
  /** Fondos que no se pudieron cerrar, con el motivo. No detienen a los demas. */
  fallidos: Array<{ fondoId: string; motivo: string }>;
}

interface CierreNuevo {
  ongId: string;
  fondoId: string;
  periodo: string;
}

/**
 * Cierre mensual automatico (RF-CF-09, T2.3).
 *
 * El dia 1 de cada mes congela el estado del mes anterior de cada fondo, con
 * el hash de su contenido, para que el informe de un mes no cambie despues.
 * Si un mes quedo sin cerrar (el servidor estaba caido, o el fondo es
 * anterior a esta funcion), lo cierra tambien, en orden: la base exige que
 * cada cierre apunte al anterior.
 */
@Injectable()
export class CierresService {
  private readonly logger = new Logger(CierresService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly estados: EstadosService,
  ) {}

  /**
   * A las 2:00 de Lima del dia 1, antes de la conciliacion de las 3:00.
   *
   * Con la zona horaria explicita: el servidor corre en UTC, y sin ella el
   * cierre de septiembre ocurriria el 30 a las 21:00 de Lima, con el mes
   * todavia abierto.
   */
  @Cron('0 2 1 * *', { name: 'cierre-mensual', timeZone: ZONA_LIMA })
  async cierreMensual(): Promise<ResumenCierre> {
    const resumen = await this.cerrarPendientes();

    if (resumen.fallidos.length > 0) {
      this.logger.error(
        `Cierre de ${resumen.hasta}: ${resumen.fallidos.length} fondo(s) sin cerrar. ` +
          resumen.fallidos.map((f) => `${f.fondoId}: ${f.motivo}`).join('; '),
      );
    }
    this.logger.log(
      `Cierre de ${resumen.hasta}: ${resumen.cierres} cierre(s) en ${resumen.fondos} fondo(s), ` +
        `${resumen.avisos} aviso(s).`,
    );
    return resumen;
  }

  /** Cierra, en cada fondo, todo mes terminado que no tenga cierre. */
  async cerrarPendientes(ahora = new Date()): Promise<ResumenCierre> {
    const ultimoTerminado = anterior(periodoDe(ahora));
    const fondos = await this.prisma.fondo.findMany({
      where: { creadoEn: { lt: ultimoTerminado.hasta } },
      select: { id: true, campana: { select: { ongId: true } } },
      orderBy: { creadoEn: 'asc' },
    });

    return this.cerrarYAvisar(
      fondos.map((f) => ({ fondoId: f.id, ongId: f.campana.ongId })),
      ultimoTerminado,
    );
  }

  /**
   * Cierra los fondos indicados hasta `hasta` y avisa a sus ONG.
   *
   * Separado de cerrarPendientes para poder probarlo sobre un fondo: un
   * cierre no se borra, y una prueba que cerrara todos los fondos de la base
   * dejaria cierres permanentes en los de la demostracion.
   */
  async cerrarYAvisar(
    fondos: Array<{ fondoId: string; ongId: string }>,
    hasta: Periodo,
  ): Promise<ResumenCierre> {
    const nuevos: CierreNuevo[] = [];
    const fallidos: ResumenCierre['fallidos'] = [];

    // Un fondo que falla no detiene a los demas: el aviso de los que si
    // cerraron no puede depender de un fondo con un problema propio.
    for (const { fondoId, ongId } of fondos) {
      try {
        const cerrados = await this.cerrarFondo(fondoId, hasta);
        nuevos.push(...cerrados.map((periodo) => ({ ongId, fondoId, periodo })));
      } catch (e) {
        fallidos.push({ fondoId, motivo: e instanceof Error ? e.message : String(e) });
      }
    }

    return {
      hasta: hasta.codigo,
      cierres: nuevos.length,
      fondos: new Set(nuevos.map((n) => n.fondoId)).size,
      avisos: await this.avisar(nuevos),
      fallidos,
    };
  }

  /**
   * Cierra los meses pendientes de un fondo hasta `hasta`, en orden.
   * Devuelve los periodos que cerro.
   */
  async cerrarFondo(fondoId: string, hasta: Periodo): Promise<string[]> {
    const [fondo, ultimo] = await Promise.all([
      this.prisma.fondo.findUniqueOrThrow({ where: { id: fondoId } }),
      this.prisma.cierreMensual.findFirst({ where: { fondoId }, orderBy: { periodo: 'desc' } }),
    ]);

    let referencia: ReferenciaCierre | null = ultimo
      ? { periodo: ultimo.periodo, hash: ultimo.hashContenido }
      : null;
    const cerrados: string[] = [];

    for (
      let p = ultimo ? siguiente(periodo(ultimo.periodo)) : periodoDe(fondo.creadoEn);
      p.codigo <= hasta.codigo;
      p = siguiente(p)
    ) {
      const contenido = jsonCanonico(await this.estados.calcular(fondoId, p, referencia));
      const hash = sha256(contenido);

      // La base vuelve a comprobar todo esto: que el hash sea el del
      // contenido, que el contenido sea de este fondo y este mes, y que
      // apunte al cierre anterior.
      await this.prisma.cierreMensual.create({
        data: {
          fondoId,
          periodo: p.codigo,
          contenido,
          hashContenido: hash,
          hashAnterior: referencia?.hash ?? null,
          versionFormato: VERSION_ESTADO,
        },
      });

      cerrados.push(p.codigo);
      referencia = { periodo: p.codigo, hash };
    }

    return cerrados;
  }

  /**
   * Un aviso por ONG a cada miembro activo, no uno por fondo y mes: el
   * primer cierre de una ONG antigua puede cubrir varios meses de varios
   * fondos, y diez avisos iguales no informan mas que uno.
   *
   * Es transaccional: le dice a la organizacion que sus estados estan listos,
   * no le ofrece nada, y no depende del consentimiento de comunicaciones.
   */
  private async avisar(nuevos: CierreNuevo[]): Promise<number> {
    const porOng = new Map<string, CierreNuevo[]>();
    for (const n of nuevos) porOng.set(n.ongId, [...(porOng.get(n.ongId) ?? []), n]);

    let avisos = 0;
    for (const [ongId, cierres] of porOng) {
      const miembros = await this.prisma.ongMiembro.findMany({
        where: { ongId, activo: true },
        select: { usuarioId: true },
      });

      const periodos = [...new Set(cierres.map((c) => c.periodo))].sort();
      const primero = nombreDelPeriodo(periodo(periodos[0]));
      const ultimo = nombreDelPeriodo(periodo(periodos[periodos.length - 1]));
      const meses = periodos.length === 1 ? primero : `${primero} a ${ultimo}`;
      const fondos = new Set(cierres.map((c) => c.fondoId)).size;

      const { count } = await this.prisma.notificacion.createMany({
        data: miembros.map((m) => ({
          usuarioId: m.usuarioId,
          tipo: 'CIERRE_MENSUAL',
          canal: 'IN_APP' as const,
          transaccional: true,
          asunto: `Estados de ${meses} listos`,
          cuerpo:
            `Se cerro ${meses} en ${fondos} fondo(s). Los estados ya no cambian: ` +
            'puede descargarlos en Excel o PDF desde Fondos, con el hash que los respalda.',
          estado: 'ENVIADA' as const,
          enviadaEn: new Date(),
        })),
      });
      avisos += count;
    }
    return avisos;
  }
}
