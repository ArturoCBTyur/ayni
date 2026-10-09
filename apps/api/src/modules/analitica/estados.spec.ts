/**
 * Estados mensuales y cierre mensual (Fase 2 del plan transdisciplinario).
 *
 * El escenario tiene movimientos en julio y agosto de 2026, uno justo en el
 * borde de los dos meses en hora de Lima, y un reverso en el mes en curso.
 * Las cifras esperadas se escriben a mano a partir de esos movimientos, no
 * se recalculan con el mismo codigo que se prueba.
 *
 * Ninguna prueba cierra fondos que no sean el suyo: un cierre no se borra, y
 * la base de desarrollo es tambien la de la demostracion.
 */
import { Logger } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

import { jsonCanonico } from '../../comun/canonico';
import { periodo, periodoDe } from '../../comun/periodo';
import { PrismaService } from '../../comun/prisma/prisma.service';
import {
  crearEscenarioContable,
  type EscenarioContable,
} from '../../comun/pruebas/escenario-contable';
import { cargarConfiguracion } from '../../config/configuracion';
import { LibroService } from '../contable/libro.service';
import { lineasPle, nombreArchivoPle } from '../contable/ple';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import { CierresService } from './cierres.service';
import { ConciliacionService } from './conciliacion.service';
import { enSoles, estadoPdf, estadoXlsx, nombreArchivo } from './estados.render';
import { EstadosService } from './estados.service';
import { PleService } from './ple.service';

let prisma: PrismaService;
let libro: LibroService;
let estados: EstadosService;
let cierres: CierresService;
let conciliacion: ConciliacionService;
let ple: PleService;
let e: EscenarioContable;

const admin: CargaAcceso = { sub: 'admin', correo: 'admin@prueba.pe', roles: ['ADMIN'], ongs: [] };
const enCurso = periodoDe(new Date());

const julio = (dia: number) => new Date(`2026-07-${String(dia).padStart(2, '0')}T15:00:00Z`);
const agosto = (dia: number) => new Date(`2026-08-${String(dia).padStart(2, '0')}T15:00:00Z`);

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [
      PrismaService,
      LibroService,
      ConciliacionService,
      EstadosService,
      CierresService,
      PleService,
    ],
  }).compile();

  prisma = modulo.get(PrismaService);
  libro = modulo.get(LibroService);
  estados = modulo.get(EstadosService);
  cierres = modulo.get(CierresService);
  conciliacion = modulo.get(ConciliacionService);
  ple = modulo.get(PleService);
  await prisma.$connect();

  e = await crearEscenarioContable(prisma, 'estados');

  // Julio: tres donaciones (la ultima a las 23:59:59 del 31 en Lima) y un gasto.
  await e.donar(200, 7.88, julio(10));
  await e.donar(150, 6.16, julio(20));
  const gastoDeJulio = await e.gastoAprobado(100, julio(25));
  await e.donar(50, 2.22, new Date('2026-08-01T04:59:59Z'));

  // Agosto: una donacion a las 00:00:00 del 1 en Lima, un gasto y una reasignacion.
  await e.donar(30, 1.33, new Date('2026-08-01T05:00:00Z'));
  await e.gastoAprobado(40, agosto(5));
  await e.reasignar(25.5, agosto(15));

  // El mes en curso: se revierte la ejecucion de julio.
  const ejecucion = await prisma.movimientoContable.findFirstOrThrow({
    where: { gastoId: gastoDeJulio, tipo: 'EJECUCION' },
  });
  await prisma.$transaction((tx) =>
    libro.asentarReverso(tx, { movimientoId: ejecucion.id, motivo: 'comprobante anulado' }),
  );
}, 60_000);

afterAll(async () => {
  await e.limpiar();
  await prisma.$disconnect();
});

describe('RF-CF-07 · Estado de actividades del mes', () => {
  it('julio: donaciones, comisiones, lo ejecutado y lo retenido', async () => {
    const { estado } = await estados.consultar(e.fondoId, '2026-07', admin);

    expect(estado.actividades).toMatchObject({
      donaciones: 3,
      donacionesBrutas: '400.00',
      comisiones: '16.26',
      donacionesNetas: '383.74',
      ejecutado: '100.00',
      revertido: '0.00',
      liberadoNeto: '100.00',
      reasignado: '0.00',
    });
    expect(estado.actividades.ejecutadoPorCategoria).toEqual([
      {
        categoria: 'ATENCION_VETERINARIA',
        gastos: 1,
        ejecutado: '100.00',
        revertido: '0.00',
        neto: '100.00',
      },
    ]);
    expect(estado.retenido).toEqual({ inicial: '0.00', final: '283.74', variacion: '283.74' });
  });

  it('el borde del mes se lee en hora de Lima', async () => {
    // 04:59:59 UTC del 1 de agosto es 23:59:59 del 31 de julio en Lima.
    const julioEstado = (await estados.consultar(e.fondoId, '2026-07', admin)).estado;
    const agostoEstado = (await estados.consultar(e.fondoId, '2026-08', admin)).estado;

    expect(julioEstado.actividades.donaciones).toBe(3);
    expect(agostoEstado.actividades.donaciones).toBe(1);
    expect(agostoEstado.actividades.donacionesBrutas).toBe('30.00');
  });

  it('agosto empieza con lo que julio dejo retenido', async () => {
    const { estado } = await estados.consultar(e.fondoId, '2026-08', admin);

    expect(estado.retenido.inicial).toBe('283.74');
    // 283.74 + 28.67 netos - 40 ejecutados - 25.50 reasignados
    expect(estado.retenido.final).toBe('246.91');
    expect(estado.actividades.reasignado).toBe('25.50');
  });

  it('la variacion del retenido es lo neto menos lo liberado y lo reasignado', async () => {
    for (const codigo of ['2026-07', '2026-08', enCurso.codigo]) {
      const { actividades: a, retenido: r } = (await estados.consultar(e.fondoId, codigo, admin))
        .estado;
      const esperada = new Prisma.Decimal(a.donacionesNetas)
        .plus(a.recibidoPorTraslado)
        .minus(a.liberadoNeto)
        .minus(a.reasignado);
      expect(new Prisma.Decimal(r.variacion).equals(esperada)).toBe(true);
    }
  });

  it('los totales del mes son la suma de sus movimientos en el libro', async () => {
    const p = periodo('2026-07');
    const filas = await prisma.$queryRaw<{ tipo: string; total: Prisma.Decimal }[]>`
      SELECT tipo::text, sum(monto) AS total FROM movimientos_contables
       WHERE fondo_id = ${e.fondoId}::uuid AND creado_en >= ${p.desde} AND creado_en < ${p.hasta}
       GROUP BY tipo
    `;
    const suma = (tipo: string) => filas.find((f) => f.tipo === tipo)?.total.toFixed(2) ?? '0.00';
    const { actividades } = (await estados.consultar(e.fondoId, '2026-07', admin)).estado;

    expect(actividades.donacionesBrutas).toBe(suma('INGRESO'));
    expect(actividades.comisiones).toBe(suma('COMISION'));
    expect(actividades.ejecutado).toBe(suma('EJECUCION'));
  });

  it('un mes sin movimientos arrastra el retenido sin cambiarlo', async () => {
    const marzo = (await estados.consultar(e.fondoId, '2026-03', admin)).estado;
    expect(marzo.actividades.donacionesBrutas).toBe('0.00');
    expect(marzo.retenido).toEqual({ inicial: '0.00', final: '0.00', variacion: '0.00' });
    expect(marzo.libro.ultimaSecuencia).toBeNull();

    const septiembre = (await estados.consultar(e.fondoId, '2026-09', admin)).estado;
    if (enCurso.codigo > '2026-09') {
      expect(septiembre.retenido.inicial).toBe('246.91');
      expect(septiembre.retenido.final).toBe('246.91');
    }
  });

  it('la situacion del fondo es una particion de lo recaudado, y el balance cuadra', async () => {
    const { estado } = await estados.consultar(e.fondoId, '2026-08', admin);

    expect(estado.situacion).toMatchObject({
      recaudadoBruto: '430.00',
      comisiones: '17.59',
      conRestriccion: '246.91',
      liberados: '140.00',
      reasignadoPendiente: '25.50',
      efectivoRecibidoNeto: '412.41',
      particionCuadra: true,
    });

    const debe = estado.balanceComprobacion.reduce((t, b) => t.plus(b.debe), new Prisma.Decimal(0));
    const haber = estado.balanceComprobacion.reduce(
      (t, b) => t.plus(b.haber),
      new Prisma.Decimal(0),
    );
    expect(debe.equals(haber)).toBe(true);

    const retenido = estado.balanceComprobacion.find((b) => b.auxiliar.startsWith('20.2'));
    expect(retenido).toMatchObject({ cuenta: '496', naturaleza: 'ACREEDORA', saldo: '246.91' });
  });

  it('en el mes en curso cuadra con el saldo del fondo y con la conciliacion', async () => {
    const r = await estados.consultar(e.fondoId, enCurso.codigo, admin);
    const fondo = await prisma.fondo.findUniqueOrThrow({ where: { id: e.fondoId } });

    expect(r.enCurso).toBe(true);
    expect(r.cerrado).toBe(false);
    expect(r.estado.actividades.revertido).toBe('100.00');
    // El reverso devuelve los 100 de julio a lo retenido.
    expect(r.estado.retenido.final).toBe('346.91');
    expect(fondo.saldoRetenido.toFixed(2)).toBe(r.estado.retenido.final);
    expect(fondo.saldoEjecutado.toFixed(2)).toBe(r.estado.situacion.liberados);
    expect(r.cadena.integra).toBe(true);

    const descuadres = (await conciliacion.conciliar()).descuadres.filter(
      (d) => d.entidadId === e.fondoId,
    );
    expect(descuadres).toEqual([]);
  });

  it('el mismo libro da el mismo estado, byte por byte', async () => {
    const p = periodo('2026-08');
    const a = jsonCanonico(await estados.calcular(e.fondoId, p, null));
    const b = jsonCanonico(await estados.calcular(e.fondoId, p, null));
    expect(a).toBe(b);
  });

  it('rechaza un periodo mal escrito, uno futuro y uno anterior al fondo', async () => {
    await expect(estados.consultar(e.fondoId, '2026-7', admin)).rejects.toThrow('AAAA-MM');
    await expect(estados.consultar(e.fondoId, '2099-01', admin)).rejects.toThrow(
      'todavia no empieza',
    );
    await expect(estados.consultar(e.fondoId, '2025-12', admin)).rejects.toThrow('no existia');
    await expect(
      estados.consultar('00000000-0000-0000-0000-000000000000', '2026-07', admin),
    ).rejects.toThrow('No encontramos ese fondo');
  });

  it('lista los meses de vida del fondo, del mas reciente al mas antiguo', async () => {
    const { fondo, periodos } = await estados.periodos(e.fondoId, admin);

    expect(fondo.ongId).toBe(e.ongId);

    expect(periodos[0]).toMatchObject({ codigo: enCurso.codigo, enCurso: true });
    expect(periodos[periodos.length - 1].codigo).toBe('2026-01');
    expect(periodos.find((p) => p.codigo === '2026-09')?.nombre).toBe('septiembre de 2026');
  });
});

describe('RF-CF-09 · Cierre mensual', () => {
  it('el cron, en febrero, cerraria solo enero', async () => {
    const r = await cierres.cerrarPendientes(new Date('2026-02-10T12:00:00Z'));
    const delFondo = await prisma.cierreMensual.findMany({ where: { fondoId: e.fondoId } });

    expect(r.hasta).toBe('2026-01');
    expect(delFondo.map((c) => c.periodo)).toEqual(['2026-01']);
    expect(delFondo[0].hashAnterior).toBeNull();
  });

  it('cierra en orden los meses pendientes, cada uno apuntando al anterior', async () => {
    const r = await cierres.cerrarYAvisar(
      [{ fondoId: e.fondoId, ongId: e.ongId }],
      periodo('2026-07'),
    );
    const cadena = await prisma.cierreMensual.findMany({
      where: { fondoId: e.fondoId },
      orderBy: { periodo: 'asc' },
    });

    expect(r).toMatchObject({ hasta: '2026-07', cierres: 6, fondos: 1, fallidos: [] });
    expect(cadena.map((c) => c.periodo)).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
      '2026-06',
      '2026-07',
    ]);
    for (let i = 1; i < cadena.length; i += 1) {
      expect(cadena[i].hashAnterior).toBe(cadena[i - 1].hashContenido);
    }
  });

  it('el hash guardado es el SHA-256 del contenido, recalculable por cualquiera', async () => {
    const c = await prisma.cierreMensual.findUniqueOrThrow({
      where: { fondoId_periodo: { fondoId: e.fondoId, periodo: '2026-07' } },
    });
    expect(createHash('sha256').update(c.contenido, 'utf8').digest('hex')).toBe(c.hashContenido);
  });

  it('volver a cerrar no duplica nada', async () => {
    expect(await cierres.cerrarFondo(e.fondoId, periodo('2026-07'))).toEqual([]);
  });

  it('un mes cerrado se entrega tal como se guardo, y el libro todavia lo sostiene', async () => {
    const r = await estados.consultar(e.fondoId, '2026-07', admin);

    expect(r.cerrado).toBe(true);
    expect(r.cierre?.vigente).toBe(true);
    expect(r.estado.retenido.final).toBe('283.74');
    expect(r.estado.cierreAnterior?.periodo).toBe('2026-06');
  });

  it('avisa a cada miembro activo, uno por corrida, sin depender de su consentimiento', async () => {
    const avisos = await prisma.notificacion.findMany({
      where: { usuarioId: e.operadorId, tipo: 'CIERRE_MENSUAL' },
      orderBy: { creadoEn: 'asc' },
    });

    // La corrida de febrero cerro enero; la siguiente, de febrero a julio.
    expect(avisos.map((a) => a.asunto)).toEqual([
      'Estados de enero de 2026 listos',
      'Estados de febrero de 2026 a julio de 2026 listos',
    ]);
    expect(avisos[1]).toMatchObject({ transaccional: true, canal: 'IN_APP' });
  });

  it('el cron del dia 1 deja en el registro los fondos que no pudo cerrar', async () => {
    // Sin ejecutar el cierre de verdad: cerraria todos los fondos de la base.
    const pendientes = jest.spyOn(cierres, 'cerrarPendientes').mockResolvedValue({
      hasta: '2026-09',
      cierres: 0,
      fondos: 0,
      avisos: 0,
      fallidos: [{ fondoId: 'f', motivo: 'sin conexion' }],
    });
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    const r = await cierres.cierreMensual();

    expect(r.fallidos).toHaveLength(1);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('f: sin conexion'));
    pendientes.mockRestore();
    error.mockRestore();
  });

  it('un fondo que falla no impide cerrar los demas', async () => {
    const r = await cierres.cerrarYAvisar(
      [{ fondoId: '00000000-0000-0000-0000-000000000000', ongId: e.ongId }],
      periodo('2026-07'),
    );
    expect(r.cierres).toBe(0);
    expect(r.fallidos).toHaveLength(1);
  });

  it('la base no deja modificar ni borrar un cierre', async () => {
    await expect(
      prisma.cierreMensual.updateMany({
        where: { fondoId: e.fondoId, periodo: '2026-07' },
        data: { contenido: '{}' },
      }),
    ).rejects.toThrow(/solo insercion/);
    await expect(
      prisma.cierreMensual.deleteMany({ where: { fondoId: e.fondoId } }),
    ).rejects.toThrow(/solo insercion/);
  });

  it('la base rechaza un hash que no es el del contenido', async () => {
    const ultimo = await prisma.cierreMensual.findUniqueOrThrow({
      where: { fondoId_periodo: { fondoId: e.fondoId, periodo: '2026-07' } },
    });
    const contenido = jsonCanonico({
      ...(await estados.calcular(e.fondoId, periodo('2026-08'), {
        periodo: '2026-07',
        hash: ultimo.hashContenido,
      })),
    });

    await expect(
      prisma.cierreMensual.create({
        data: {
          fondoId: e.fondoId,
          periodo: '2026-08',
          contenido,
          hashContenido: 'f'.repeat(64),
          hashAnterior: ultimo.hashContenido,
        },
      }),
    ).rejects.toThrow(/ck_cierres_hash_del_contenido/);
  });

  it('la base rechaza un cierre que no apunta al anterior, o que salta hacia atras', async () => {
    const contenido = jsonCanonico(await estados.calcular(e.fondoId, periodo('2026-08'), null));
    const hash = createHash('sha256').update(contenido, 'utf8').digest('hex');

    await expect(
      prisma.cierreMensual.create({
        data: { fondoId: e.fondoId, periodo: '2026-08', contenido, hashContenido: hash },
      }),
    ).rejects.toThrow(/no apunta al cierre anterior/);

    const viejo = jsonCanonico(await estados.calcular(e.fondoId, periodo('2026-03'), null));
    await expect(
      prisma.cierreMensual.create({
        data: {
          fondoId: e.fondoId,
          periodo: '2026-03',
          contenido: viejo,
          hashContenido: createHash('sha256').update(viejo, 'utf8').digest('hex'),
        },
      }),
    ).rejects.toThrow(/ya tiene cerrado/);
  });
});

describe('RF-CF-08 · Excel y PDF del estado', () => {
  it('el Excel trae las cuatro hojas y los importes del mes', async () => {
    const r = await estados.consultar(e.fondoId, '2026-07', admin);
    const xlsx = estadoXlsx(r).toString('latin1');

    expect(xlsx.startsWith('PK')).toBe(true);
    for (const hoja of ['sheet1', 'sheet2', 'sheet3', 'sheet4']) {
      expect(xlsx).toContain(`xl/worksheets/${hoja}.xml`);
    }
    expect(xlsx).toContain('<v>400.00</v>');
    expect(xlsx).toContain(r.cierre!.hash);
  });

  it('el PDF dice si el mes esta cerrado y con que hash', async () => {
    const r = await estados.consultar(e.fondoId, '2026-07', admin);
    const pdf = estadoPdf(r).toString('latin1');

    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('S/ 400.00');
    expect(pdf).toContain(r.cierre!.hash);
    expect(pdf).toContain('El libro sigue sosteniendo estas cifras');
  });

  it('nombra el archivo con el fondo y el mes', async () => {
    const r = await estados.consultar(e.fondoId, '2026-07', admin);
    expect(nombreArchivo(r, 'pdf')).toBe(`estado-fondo-estados-${e.marca}-2026-07.pdf`);
  });

  it('escribe los importes como en la aplicacion', () => {
    expect(enSoles('1234567.50')).toBe('S/ 1,234,567.50');
    expect(enSoles('-14.04')).toBe('-S/ 14.04');
    expect(enSoles('0.00')).toBe('S/ 0.00');
  });
});

describe('RF-CF-10 · Borrador del PLE', () => {
  it('el diario de julio tiene dos lineas por movimiento, de 21 campos, y cuadra', async () => {
    const { nombre, texto } = await ple.borrador(e.ongId, '2026-07', 'diario', admin);
    const lineas = texto.trimEnd().split('\r\n');
    const movimientos = await prisma.movimientoContable.count({
      where: {
        fondoId: e.fondoId,
        creadoEn: { gte: periodo('2026-07').desde, lt: periodo('2026-07').hasta },
      },
    });

    expect(nombre).toBe(`BORRADOR-LE${e.ruc}20260700050100001111.txt`);
    expect(lineas).toHaveLength(movimientos * 2);

    let debe = new Prisma.Decimal(0);
    let haber = new Prisma.Decimal(0);
    for (const l of lineas) {
      expect(l.endsWith('|')).toBe(true);
      const campos = l.slice(0, -1).split('|');
      expect(campos).toHaveLength(21);
      expect(campos[0]).toBe('20260700');
      expect(campos[12]).toMatch(/^\d{2}\/07\/2026$/);
      debe = debe.plus(campos[17]);
      haber = haber.plus(campos[18]);
    }
    expect(debe.equals(haber)).toBe(true);
  });

  it('el mayor ordena por cuenta', async () => {
    const { texto } = await ple.borrador(e.ongId, '2026-07', 'mayor', admin);
    const cuentas = texto
      .trimEnd()
      .split('\r\n')
      .map((l) => l.split('|')[3]);
    expect(cuentas).toEqual([...cuentas].sort());
  });

  it('un mes sin operaciones lo dice en el nombre y va vacio', async () => {
    const { nombre, texto } = await ple.borrador(e.ongId, '2026-03', 'diario', admin);
    expect(nombre).toBe(`BORRADOR-LE${e.ruc}20260300050100000111.txt`);
    expect(texto).toBe('');
  });

  it('el comprobante del gasto va con su codigo de la tabla 10 de SUNAT', () => {
    const [cargo] = lineasPle(
      [
        {
          fondoId: '12345678-0000-0000-0000-000000000000',
          secuencia: 7,
          fecha: new Date('2026-07-25T15:00:00Z'),
          tipo: 'EJECUCION',
          monto: '80.00',
          descripcion: 'Ejecucion | con barra',
          comprobante: { tipo: 'BOLETA', serie: 'B001', numero: '123' },
        },
      ],
      periodo('2026-07'),
      'diario',
    );
    const campos = cargo.split('|');

    expect(campos.slice(9, 12)).toEqual(['03', 'B001', '123']);
    expect(campos[1]).toBe('12345678000007');
    expect(campos[15]).toBe('Ejecucion con barra');
  });

  it('rechaza un periodo mal escrito y una ONG que no existe', async () => {
    await expect(ple.borrador(e.ongId, '07-2026', 'diario', admin)).rejects.toThrow('AAAA-MM');
    await expect(
      ple.borrador('00000000-0000-0000-0000-000000000000', '2026-07', 'diario', admin),
    ).rejects.toThrow('No encontramos esa organizacion');
    expect(nombreArchivoPle('20601030579', periodo('2026-12'), 'mayor', true)).toBe(
      'LE2060103057920261200060100001111.txt',
    );
  });
});

describe('Un cierre de otra version del formato', () => {
  it('se entrega como se guardo, sin declararlo vigente ni roto', async () => {
    // Agosto, cerrado como si lo hubiera armado una version anterior.
    const julioCerrado = await prisma.cierreMensual.findUniqueOrThrow({
      where: { fondoId_periodo: { fondoId: e.fondoId, periodo: '2026-07' } },
    });
    const contenido = jsonCanonico(
      await estados.calcular(e.fondoId, periodo('2026-08'), {
        periodo: '2026-07',
        hash: julioCerrado.hashContenido,
      }),
    );
    await prisma.cierreMensual.create({
      data: {
        fondoId: e.fondoId,
        periodo: '2026-08',
        contenido,
        hashContenido: createHash('sha256').update(contenido, 'utf8').digest('hex'),
        hashAnterior: julioCerrado.hashContenido,
        versionFormato: 0,
      },
    });

    const r = await estados.consultar(e.fondoId, '2026-08', admin);

    expect(r.cerrado).toBe(true);
    expect(r.cierre?.vigente).toBeNull();
    expect(estadoPdf(r).toString('latin1')).toContain(
      'Cerrado con una versi\\363n anterior del formato',
    );
  });
});

describe('Un asiento posterior al cierre', () => {
  // Va al final: cambia el libro de julio.
  it('hace que el cierre de julio deje de estar vigente, sin cambiarlo', async () => {
    const antes = await estados.consultar(e.fondoId, '2026-07', admin);
    await e.reasignar(1, julio(30));
    const despues = await estados.consultar(e.fondoId, '2026-07', admin);

    expect(despues.cerrado).toBe(true);
    expect(despues.cierre?.hash).toBe(antes.cierre?.hash);
    expect(despues.estado).toEqual(antes.estado);
    expect(despues.cierre?.vigente).toBe(false);
  });
});
