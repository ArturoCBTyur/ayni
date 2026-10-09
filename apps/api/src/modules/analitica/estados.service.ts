import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type TipoMovimiento } from '@prisma/client';

import { jsonCanonico, sha256 } from '../../comun/canonico';
import { soles } from '../../comun/dinero';
import {
  ZONA_LIMA,
  esCodigoDePeriodo,
  nombreDelPeriodo,
  periodo,
  periodoDe,
  siguiente,
  type Periodo,
} from '../../comun/periodo';
import { PrismaService } from '../../comun/prisma/prisma.service';
import {
  clasificacionCuadra,
  clasificarSaldos,
  type SumasPorTipo,
} from '../contable/clasificacion';
import { LibroService } from '../contable/libro.service';
import { lineasDiario, type Naturaleza } from '../contable/pcge';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';

/**
 * Version del contenido de un estado. Un cierre guarda la version con que se
 * armo: si el formato cambia, los cierres viejos se siguen leyendo con la
 * suya y no se recalculan con otra.
 */
export const VERSION_ESTADO = 1;

export interface ReferenciaCierre {
  periodo: string;
  hash: string;
}

/**
 * RF-CF-07 · Estado mensual de un fondo.
 *
 * Todo importe es texto con dos decimales (ver soles()), y no hay ninguna
 * marca de tiempo de cuando se genero: el mismo libro tiene que dar el mismo
 * estado, byte por byte, para que su hash signifique algo.
 */
export interface EstadoMensual {
  version: number;
  marco: { norma: string; correspondencia: string; decision: string };
  fondo: {
    id: string;
    nombre: string;
    categoriaGasto: string;
    campana: { id: string; titulo: string };
    ong: { id: string; razonSocial: string; ruc: string };
  };
  periodo: { codigo: string; nombre: string; desde: string; hasta: string; zonaHoraria: string };
  cierreAnterior: ReferenciaCierre | null;
  /** Lo que paso en el mes. */
  actividades: {
    donaciones: number;
    donacionesBrutas: string;
    comisiones: string;
    donacionesNetas: string;
    ejecutado: string;
    revertido: string;
    liberadoNeto: string;
    reasignado: string;
    ejecutadoPorCategoria: Array<{
      categoria: string;
      gastos: number;
      ejecutado: string;
      revertido: string;
      neto: string;
    }>;
  };
  /** Lo retenido por justificar al empezar y al terminar el mes. */
  retenido: { inicial: string; final: string; variacion: string };
  /** Como quedo el fondo al cierre del mes, acumulado desde su creacion. */
  situacion: {
    recaudadoBruto: string;
    comisiones: string;
    efectivoRecibidoNeto: string;
    conRestriccion: string;
    liberados: string;
    reasignadoPendiente: string;
    particionCuadra: boolean;
  };
  /** Saldos acumulados en cuentas del PCGE (propuesta de D1). */
  balanceComprobacion: Array<{
    cuenta: string;
    nombre: string;
    auxiliar: string;
    naturaleza: Naturaleza;
    debe: string;
    haber: string;
    saldo: string;
  }>;
  /** Donde termina el mes dentro de la cadena de hashes del fondo. */
  libro: {
    movimientosDelPeriodo: number;
    movimientosAcumulados: number;
    ultimaSecuencia: number | null;
    hashUltimo: string | null;
  };
}

export interface ResultadoEstado {
  estado: EstadoMensual;
  /** Hay un cierre guardado para este mes: lo que se entrega es ese. */
  cerrado: boolean;
  /** El mes todavia no termina: las cifras pueden cambiar. */
  enCurso: boolean;
  cierre: {
    hash: string;
    hashAnterior: string | null;
    creadoEn: Date;
    /**
     * Recalcular el mes desde el libro da el mismo hash. Si no, alguien
     * asento en ese mes despues de cerrarlo, y eso es lo que hay que mirar.
     */
    vigente: boolean;
  } | null;
  /** Integridad de la cadena del fondo, comprobada al pedir el estado. */
  cadena: { integra: boolean; movimientos: number };
}

type FondoConDueno = Prisma.FondoGetPayload<{ include: { campana: { include: { ong: true } } } }>;

@Injectable()
export class EstadosService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly libro: LibroService,
  ) {}

  /**
   * Quien ve los estados de un fondo: el administrador, el auditor y los
   * miembros activos de la ONG dueña. Lo que autoriza a una ONG es su
   * membresia, no su rol: un operador de otra organizacion tiene el mismo rol
   * y no ve nada de esta.
   */
  async exigirAccesoAFondo(fondoId: string, usuario: CargaAcceso): Promise<FondoConDueno> {
    const fondo = await this.prisma.fondo.findUnique({
      where: { id: fondoId },
      include: { campana: { include: { ong: true } } },
    });
    if (!fondo) throw new NotFoundException('No encontramos ese fondo.');

    await this.exigirAccesoAOng(fondo.campana.ongId, usuario);
    return fondo;
  }

  async exigirAccesoAOng(ongId: string, usuario: CargaAcceso): Promise<void> {
    if (usuario.roles.includes('ADMIN') || usuario.roles.includes('AUDITOR')) return;

    const membresia = await this.prisma.ongMiembro.findUnique({
      where: { ongId_usuarioId: { ongId, usuarioId: usuario.sub } },
    });
    if (!membresia?.activo) {
      throw new ForbiddenException(
        'Los estados de un fondo los ven su organizacion, la auditoria y la administracion.',
      );
    }
  }

  /** Los meses de vida del fondo, del mas reciente al mas antiguo. */
  async periodos(fondoId: string, usuario: CargaAcceso, ahora = new Date()) {
    const fondo = await this.exigirAccesoAFondo(fondoId, usuario);
    const cierres = await this.prisma.cierreMensual.findMany({
      where: { fondoId },
      select: { periodo: true, hashContenido: true, creadoEn: true },
    });
    const porPeriodo = new Map(cierres.map((c) => [c.periodo, c]));

    const actual = periodoDe(ahora);
    const lista = [];
    for (let p = periodoDe(fondo.creadoEn); p.codigo <= actual.codigo; p = siguiente(p)) {
      const cierre = porPeriodo.get(p.codigo);
      lista.push({
        codigo: p.codigo,
        nombre: nombreDelPeriodo(p),
        enCurso: p.codigo === actual.codigo,
        cerrado: cierre !== undefined,
        hash: cierre?.hashContenido ?? null,
        cerradoEn: cierre?.creadoEn ?? null,
      });
    }

    return {
      fondo: {
        id: fondo.id,
        nombre: fondo.nombre,
        // El PLE es por ONG: la aplicacion lo pide con esto.
        ongId: fondo.campana.ongId,
        ong: fondo.campana.ong.razonSocial,
      },
      periodos: lista.reverse(),
    };
  }

  /**
   * El estado de un mes. Si el mes esta cerrado se entrega el cierre tal como
   * se guardo, y ademas se recalcula para decir si el libro sigue diciendo lo
   * mismo; si no, se calcula al momento.
   */
  async consultar(
    fondoId: string,
    codigo: string,
    usuario: CargaAcceso,
    ahora = new Date(),
  ): Promise<ResultadoEstado> {
    if (!esCodigoDePeriodo(codigo)) {
      throw new BadRequestException('El periodo se indica como AAAA-MM, por ejemplo 2026-09.');
    }
    const fondo = await this.exigirAccesoAFondo(fondoId, usuario);
    const p = periodo(codigo);
    const actual = periodoDe(ahora);

    if (p.codigo > actual.codigo) {
      throw new BadRequestException(`${nombreDelPeriodo(p)} todavia no empieza.`);
    }
    if (p.codigo < periodoDe(fondo.creadoEn).codigo) {
      throw new BadRequestException(`El fondo no existia en ${nombreDelPeriodo(p)}.`);
    }

    const [cierre, cadena] = await Promise.all([
      this.prisma.cierreMensual.findUnique({
        where: { fondoId_periodo: { fondoId, periodo: p.codigo } },
      }),
      this.libro.verificarCadena(fondoId),
    ]);
    const integridad = { integra: !cadena.rota, movimientos: cadena.movimientos };

    if (cierre) {
      const guardado = JSON.parse(cierre.contenido) as EstadoMensual;
      const recalculado = await this.calcular(fondoId, p, guardado.cierreAnterior);
      return {
        estado: guardado,
        cerrado: true,
        enCurso: false,
        cierre: {
          hash: cierre.hashContenido,
          hashAnterior: cierre.hashAnterior,
          creadoEn: cierre.creadoEn,
          vigente: sha256(jsonCanonico(recalculado)) === cierre.hashContenido,
        },
        cadena: integridad,
      };
    }

    const anterior = await this.prisma.cierreMensual.findFirst({
      where: { fondoId, periodo: { lt: p.codigo } },
      orderBy: { periodo: 'desc' },
    });
    const referencia = anterior
      ? { periodo: anterior.periodo, hash: anterior.hashContenido }
      : null;

    return {
      estado: await this.calcular(fondoId, p, referencia),
      cerrado: false,
      enCurso: p.codigo === actual.codigo,
      cierre: null,
      cadena: integridad,
    };
  }

  /**
   * RF-CF-07 · Arma el estado de un mes desde el libro, y solo desde el libro.
   *
   * No lee los saldos guardados en `fondos`: esos los mantiene un trigger, y
   * la conciliacion ya los compara con el libro. Un estado que los leyera
   * heredaria cualquier descuadre sin poder mostrarlo.
   */
  async calcular(
    fondoId: string,
    p: Periodo,
    cierreAnterior: ReferenciaCierre | null,
  ): Promise<EstadoMensual> {
    const fondo = await this.prisma.fondo.findUniqueOrThrow({
      where: { id: fondoId },
      include: { campana: { include: { ong: true } } },
    });

    const [
      delMes,
      alInicio,
      alFinal,
      donaciones,
      categorias,
      movimientosDelPeriodo,
      movimientosAcumulados,
      ultimo,
    ] = await Promise.all([
      this.libro.sumasPorTipo(fondoId, { desde: p.desde, hasta: p.hasta }),
      this.libro.sumasPorTipo(fondoId, { hasta: p.desde }),
      this.libro.sumasPorTipo(fondoId, { hasta: p.hasta }),
      this.prisma.movimientoContable.count({
        where: { fondoId, tipo: 'INGRESO', creadoEn: { gte: p.desde, lt: p.hasta } },
      }),
      this.ejecutadoPorCategoria(fondoId, p),
      this.prisma.movimientoContable.count({
        where: { fondoId, creadoEn: { gte: p.desde, lt: p.hasta } },
      }),
      this.prisma.movimientoContable.count({ where: { fondoId, creadoEn: { lt: p.hasta } } }),
      this.prisma.movimientoContable.findFirst({
        where: { fondoId, creadoEn: { lt: p.hasta } },
        orderBy: { secuencia: 'desc' },
        select: { secuencia: true, hashActual: true },
      }),
    ]);

    const inicio = clasificarSaldos(alInicio);
    const final = clasificarSaldos(alFinal);

    return {
      version: VERSION_ESTADO,
      marco: {
        norma: 'INPAG',
        correspondencia: 'PCGE',
        decision: 'D1 de ADR-0007, propuesta sin firma de Contabilidad',
      },
      fondo: {
        id: fondo.id,
        nombre: fondo.nombre,
        categoriaGasto: fondo.categoriaGasto,
        campana: { id: fondo.campana.id, titulo: fondo.campana.titulo },
        ong: {
          id: fondo.campana.ong.id,
          razonSocial: fondo.campana.ong.razonSocial,
          ruc: fondo.campana.ong.ruc,
        },
      },
      periodo: {
        codigo: p.codigo,
        nombre: nombreDelPeriodo(p),
        desde: p.desde.toISOString(),
        hasta: p.hasta.toISOString(),
        zonaHoraria: ZONA_LIMA,
      },
      cierreAnterior,
      actividades: {
        donaciones,
        donacionesBrutas: soles(delMes.INGRESO),
        comisiones: soles(delMes.COMISION),
        donacionesNetas: soles(delMes.INGRESO.minus(delMes.COMISION)),
        ejecutado: soles(delMes.EJECUCION),
        revertido: soles(delMes.REVERSO),
        liberadoNeto: soles(delMes.EJECUCION.minus(delMes.REVERSO)),
        reasignado: soles(delMes.REASIGNACION),
        ejecutadoPorCategoria: categorias,
      },
      retenido: {
        inicial: soles(inicio.conRestriccion),
        final: soles(final.conRestriccion),
        variacion: soles(final.conRestriccion.minus(inicio.conRestriccion)),
      },
      situacion: {
        recaudadoBruto: soles(final.recaudadoBruto),
        comisiones: soles(final.comisiones),
        efectivoRecibidoNeto: soles(final.efectivoRecibidoNeto),
        conRestriccion: soles(final.conRestriccion),
        liberados: soles(final.liberados),
        reasignadoPendiente: soles(final.reasignadoPendiente),
        particionCuadra: clasificacionCuadra(final),
      },
      balanceComprobacion: balanceComprobacion(alFinal),
      libro: {
        movimientosDelPeriodo,
        movimientosAcumulados,
        ultimaSecuencia: ultimo ? Number(ultimo.secuencia) : null,
        hashUltimo: ultimo?.hashActual ?? null,
      },
    };
  }

  /**
   * Ejecutado y revertido del mes, por categoria del gasto.
   *
   * Hoy cada fondo tiene una sola categoria y esto devuelve una fila; se
   * agrupa por la categoria del gasto y no se copia la del fondo para que el
   * estado siga siendo correcto el dia que un fondo admita varias.
   */
  private async ejecutadoPorCategoria(fondoId: string, p: Periodo) {
    const filas = await this.prisma.$queryRaw<
      {
        categoria: string;
        gastos: bigint;
        ejecutado: Prisma.Decimal;
        revertido: Prisma.Decimal;
      }[]
    >`
      SELECT f.categoria_gasto::text AS categoria,
             count(DISTINCT m.gasto_id) FILTER (WHERE m.tipo = 'EJECUCION') AS gastos,
             COALESCE(sum(m.monto) FILTER (WHERE m.tipo = 'EJECUCION'), 0) AS ejecutado,
             COALESCE(sum(m.monto) FILTER (WHERE m.tipo = 'REVERSO'), 0)   AS revertido
        FROM movimientos_contables m
        JOIN gastos g ON g.id = m.gasto_id
        JOIN fondos f ON f.id = g.fondo_id
       WHERE m.fondo_id = ${fondoId}::uuid
         AND m.tipo IN ('EJECUCION', 'REVERSO')
         AND m.creado_en >= ${p.desde} AND m.creado_en < ${p.hasta}
       GROUP BY f.categoria_gasto
       ORDER BY f.categoria_gasto
    `;

    return filas.map((f) => ({
      categoria: f.categoria,
      gastos: Number(f.gastos),
      ejecutado: soles(f.ejecutado),
      revertido: soles(f.revertido),
      neto: soles(new Prisma.Decimal(f.ejecutado).minus(f.revertido)),
    }));
  }
}

/**
 * Balance de comprobacion en cuentas del PCGE, a partir de las sumas por tipo.
 *
 * Cada tipo de movimiento carga y abona siempre las mismas dos cuentas, asi
 * que las sumas por tipo alcanzan para armarlo sin recorrer el libro fila por
 * fila. Una linea por subcuenta auxiliar: 20.1 y 20.2 caen ambas en la 496 y
 * un contador necesita verlas por separado.
 */
export function balanceComprobacion(sumas: SumasPorTipo): EstadoMensual['balanceComprobacion'] {
  const cuentas = new Map<
    string,
    {
      cuenta: string;
      nombre: string;
      naturaleza: Naturaleza;
      debe: Prisma.Decimal;
      haber: Prisma.Decimal;
    }
  >();

  for (const [tipo, monto] of Object.entries(sumas) as Array<[TipoMovimiento, Prisma.Decimal]>) {
    for (const linea of lineasDiario(tipo, monto)) {
      const actual = cuentas.get(linea.auxiliar) ?? {
        cuenta: linea.cuenta.codigo,
        nombre: linea.cuenta.nombre,
        naturaleza: linea.cuenta.naturaleza,
        debe: new Prisma.Decimal(0),
        haber: new Prisma.Decimal(0),
      };
      actual.debe = actual.debe.plus(linea.debe);
      actual.haber = actual.haber.plus(linea.haber);
      cuentas.set(linea.auxiliar, actual);
    }
  }

  return (
    [...cuentas.entries()]
      // Sin localeCompare: el orden entra en el hash, y no puede depender del
      // idioma del servidor.
      .sort(([a, x], [b, y]) => comparar(x.cuenta, y.cuenta) || comparar(a, b))
      .map(([auxiliar, c]) => ({
        cuenta: c.cuenta,
        nombre: c.nombre,
        auxiliar,
        naturaleza: c.naturaleza,
        debe: soles(c.debe),
        haber: soles(c.haber),
        saldo: soles(c.naturaleza === 'DEUDORA' ? c.debe.minus(c.haber) : c.haber.minus(c.debe)),
      }))
  );
}

function comparar(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
