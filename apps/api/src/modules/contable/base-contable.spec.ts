/**
 * Base contable estandarizada (Fase 1 del plan transdisciplinario).
 *
 * Dos cosas: que el libro se pueda leer en cuentas del PCGE sin tocar un
 * solo asiento (RF-CF-05), y que los saldos de cada fondo se clasifiquen en
 * lo que sigue condicionado y lo que ya se libero (RF-CF-06).
 *
 * De paso, cubre un defecto que la clasificacion destapo: la conciliacion
 * calculaba los saldos del libro mirando solo RETENCION y EJECUCION, y el
 * primer REVERSO o REASIGNACION habria aparecido como un descuadre.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma, TipoMovimiento } from '@prisma/client';

import {
  crearEscenarioContable,
  type EscenarioContable,
} from '../../comun/pruebas/escenario-contable';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { ConciliacionService } from '../analitica/conciliacion.service';
import { ExportacionService } from '../analitica/exportacion.service';
import {
  clasificacionCuadra,
  clasificarSaldos,
  sumasDesdeGrupos,
  sumasVacias,
  type SumasPorTipo,
} from './clasificacion';
import { CUENTAS } from './cuentas';
import { LibroService } from './libro.service';
import { PCGE, asientoPcge, lineasDiario } from './pcge';

let prisma: PrismaService;
let libro: LibroService;
let conciliacion: ConciliacionService;
let exportacion: ExportacionService;
let escenario: EscenarioContable;

const d = (v: number | string) => new Prisma.Decimal(v);

/** Filas de un CSV propio, sin BOM. Los datos de esta suite no llevan comas. */
function filasCsv(csv: string): Record<string, string>[] {
  const [cabecera, ...lineas] = csv
    .replace(/^\uFEFF/, '')
    .trim()
    .split('\r\n');
  const campos = cabecera.split(',');
  return lineas.map((l) => Object.fromEntries(l.split(',').map((v, i) => [campos[i], v])));
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [PrismaService, LibroService, ConciliacionService, ExportacionService],
  }).compile();

  prisma = modulo.get(PrismaService);
  libro = modulo.get(LibroService);
  conciliacion = modulo.get(ConciliacionService);
  exportacion = modulo.get(ExportacionService);
  await prisma.$connect();

  escenario = await crearEscenarioContable(prisma, 'base-contable');

  // Dos donaciones, un gasto aprobado, el reverso de esa ejecucion, otro
  // gasto y una reasignacion: los seis tipos de movimiento en un fondo.
  await escenario.donar(200, 7.88);
  await escenario.donar(150, 6.16);
  const gasto = await escenario.gastoAprobado(100);
  const ejecucion = await prisma.movimientoContable.findFirstOrThrow({
    where: { gastoId: gasto, tipo: 'EJECUCION' },
  });
  await prisma.$transaction((tx) =>
    libro.asentarReverso(tx, { movimientoId: ejecucion.id, motivo: 'comprobante anulado' }),
  );
  await escenario.gastoAprobado(40);
  await escenario.reasignar(25.5);
}, 60_000);

afterAll(async () => {
  await escenario.limpiar();
  await prisma.$disconnect();
});

describe('RF-CF-05 · Correspondencia con el PCGE', () => {
  it('cada tipo de movimiento tiene su asiento PCGE, con las dos cuentas', () => {
    for (const tipo of Object.values(TipoMovimiento)) {
      const { debe, haber } = asientoPcge(tipo);
      expect(debe.cuenta.codigo).toMatch(/^\d{3}$/);
      expect(haber.cuenta.codigo).toMatch(/^\d{3}$/);
    }
  });

  it('ninguna cuenta interna queda sin traducir', () => {
    for (const cuenta of Object.values(CUENTAS)) {
      expect(PCGE[cuenta]).toBeDefined();
    }
  });

  it('la ejecucion no se traduce a una cuenta de gasto: tiene saldo acreedor', () => {
    // Hallazgo 1 de D1. Si alguien la mueve al elemento 6, el estado de
    // actividades mostraria un gasto con saldo acreedor.
    expect(PCGE[CUENTAS.EJECUTADO].codigo.startsWith('6')).toBe(false);
    expect(PCGE[CUENTAS.EJECUTADO].naturaleza).toBe('ACREEDORA');
  });

  it('la retencion es una reclasificacion dentro de la 496, distinguida por la auxiliar', () => {
    const { debe, haber } = asientoPcge('RETENCION');
    expect(debe.cuenta.codigo).toBe('496');
    expect(haber.cuenta.codigo).toBe('496');
    expect(debe.auxiliar).not.toBe(haber.auxiliar);
  });

  it('cada movimiento da una linea al debe y otra al haber por el mismo importe', () => {
    const [cargo, abono] = lineasDiario('INGRESO', '123.45');
    expect(cargo.debe.equals(d('123.45'))).toBe(true);
    expect(cargo.haber.isZero()).toBe(true);
    expect(abono.haber.equals(d('123.45'))).toBe(true);
    expect(abono.debe.isZero()).toBe(true);
  });

  it('el diario exportado cuadra por asiento y en total', async () => {
    const { csv } = await exportacion.diarioPcge(escenario.fondoId);
    const filas = filasCsv(csv);
    const movimientos = await libro.extracto(escenario.fondoId);

    expect(filas).toHaveLength(movimientos.length * 2);

    const porAsiento = new Map<string, Prisma.Decimal>();
    for (const f of filas) {
      const saldo = porAsiento.get(f.secuencia) ?? d(0);
      porAsiento.set(f.secuencia, saldo.plus(f.debe_pen).minus(f.haber_pen));
    }
    for (const [, saldo] of porAsiento) expect(saldo.isZero()).toBe(true);

    const debe = filas.reduce((t, f) => t.plus(f.debe_pen), d(0));
    const haber = filas.reduce((t, f) => t.plus(f.haber_pen), d(0));
    expect(debe.equals(haber)).toBe(true);
    expect(debe.greaterThan(0)).toBe(true);
  });

  it('cada linea lleva el hash de su movimiento en el libro original', async () => {
    const { csv } = await exportacion.diarioPcge(escenario.fondoId);
    const hashes = new Set((await libro.extracto(escenario.fondoId)).map((m) => m.hashActual));

    for (const f of filasCsv(csv)) expect(hashes.has(f.hash_actual)).toBe(true);
  });

  it('exportar no reescribe ningun asiento ni rompe la cadena', async () => {
    const antes = await libro.extracto(escenario.fondoId);
    await exportacion.diarioPcge(escenario.fondoId);
    const despues = await libro.extracto(escenario.fondoId);

    expect(despues).toEqual(antes);
    expect((await libro.verificarCadena(escenario.fondoId)).rota).toBe(false);
  });

  it('rechaza exportar un fondo que no existe', async () => {
    await expect(exportacion.diarioPcge('00000000-0000-0000-0000-000000000000')).rejects.toThrow(
      'No encontramos ese fondo',
    );
  });
});

describe('RF-CF-06 · Saldos con restriccion y liberados', () => {
  const sumas = (parcial: Partial<Record<TipoMovimiento, number>>): SumasPorTipo => {
    const s = sumasVacias();
    for (const [tipo, v] of Object.entries(parcial)) s[tipo as TipoMovimiento] = d(v);
    return s;
  };

  it('todo sol que entro esta en exactamente un lugar', () => {
    const c = clasificarSaldos(
      sumas({ INGRESO: 350, COMISION: 14.04, RETENCION: 335.96, EJECUCION: 140, REVERSO: 100 }),
    );

    expect(c.conRestriccion.equals(d('295.96'))).toBe(true);
    expect(c.liberados.equals(d(40))).toBe(true);
    expect(clasificacionCuadra(c)).toBe(true);
  });

  it('un tipo sin suma cuenta como cero, y uno que falta tambien', () => {
    // Prisma tipa _sum.monto como opcional aunque la columna sea NOT NULL.
    const s = sumasDesdeGrupos([{ tipo: 'INGRESO', _sum: { monto: null } }]);
    expect(s.INGRESO.isZero()).toBe(true);
    expect(s.EJECUCION.isZero()).toBe(true);
  });

  it('no cuadra si un ingreso no tiene su retencion', () => {
    // Un INGRESO asentado sin la RETENCION de su neto deja dinero sin
    // condicionar, y la clasificacion tiene que notarlo.
    expect(clasificacionCuadra(clasificarSaldos(sumas({ INGRESO: 100, COMISION: 4 })))).toBe(false);
  });

  it('la clasificacion del libro coincide con los saldos que mantiene la base', async () => {
    const c = await libro.saldosClasificados(escenario.fondoId);
    const fondo = await prisma.fondo.findUniqueOrThrow({ where: { id: escenario.fondoId } });

    expect(c.recaudadoBruto.equals(d(350))).toBe(true);
    expect(c.comisiones.equals(d('14.04'))).toBe(true);
    // 335.96 retenidos - 100 ejecutados + 100 revertidos - 40 ejecutados - 25.50 reasignados
    expect(c.conRestriccion.equals(d('270.46'))).toBe(true);
    expect(c.liberados.equals(d(40))).toBe(true);
    expect(c.reasignadoPendiente.equals(d('25.5'))).toBe(true);
    expect(clasificacionCuadra(c)).toBe(true);

    expect(fondo.saldoRetenido.equals(c.conRestriccion)).toBe(true);
    expect(fondo.saldoEjecutado.equals(c.liberados)).toBe(true);
  });

  it('el efectivo recibido es neto de comisiones', async () => {
    const c = await libro.saldosClasificados(escenario.fondoId);
    expect(c.efectivoRecibidoNeto.equals(d('335.96'))).toBe(true);
  });

  it('una fecha de corte deja fuera lo posterior', async () => {
    const c = await libro.saldosClasificados(escenario.fondoId, new Date('2000-01-01'));
    expect(c.recaudadoBruto.isZero()).toBe(true);
  });
});

describe('Conciliacion con reversos y reasignaciones', () => {
  it('no reporta descuadre en un fondo con REVERSO y REASIGNACION', async () => {
    const r = await conciliacion.conciliar();
    const delFondo = r.descuadres.filter((x) => x.entidadId === escenario.fondoId);

    expect(delFondo).toEqual([]);
  });
});
