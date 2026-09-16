/**
 * Pruebas de Analitica de Impacto (Fase 9).
 *
 * La conciliacion es lo que convierte la promesa de trazabilidad en algo
 * comprobable, asi que las pruebas no se limitan a ver que cuadre con datos
 * sanos: rompen el libro a proposito y verifican que el descuadre se
 * detecte, lo identifique y diga de cuanto es.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { AplicacionFifoService } from '../contable/aplicacion-fifo.service';
import { LibroService } from '../contable/libro.service';
import { ConciliacionService } from './conciliacion.service';
import { ExportacionService } from './exportacion.service';
import { IndicadoresService } from './indicadores.service';

const marca = randomUUID().slice(0, 8);

let prisma: PrismaService;
let conciliacion: ConciliacionService;
let indicadores: IndicadoresService;
let exportacion: ExportacionService;
let fifo: AplicacionFifoService;

const usuarios: string[] = [];
let ongId: string;
let campanaId: string;
let fondoId: string;
let donanteId: string;
let operadorId: string;

let contador = 20_000;

/**
 * Triggers de inmutabilidad del libro que esta suite apaga a proposito para
 * poder simular una manipulacion externa. Se listan aparte porque hay que
 * comprobar que quedan encendidos: apagarlos es una operacion de tabla, no de
 * sesion, asi que si una corrida muere entre el DISABLE y el ENABLE la base se
 * queda sin la garantia que el proyecto promete, en silencio y hasta que
 * alguien lo note.
 */
const TRIGGERS_INMUTABILIDAD = ['tg_movimientos_no_update', 'tg_movimientos_no_delete'];

/** Estado real de los triggers segun el catalogo: 'O' = habilitado. */
async function triggersHabilitados(cliente: PrismaService): Promise<Record<string, boolean>> {
  const filas = await cliente.$queryRaw<{ tgname: string; tgenabled: string }[]>`
    SELECT tgname, tgenabled::text FROM pg_trigger
     WHERE tgrelid = 'movimientos_contables'::regclass
       AND tgname = ANY(${TRIGGERS_INMUTABILIDAD})
  `;
  return Object.fromEntries(filas.map((f) => [f.tgname, f.tgenabled === 'O']));
}

/** Donacion confirmada con sus tres asientos, como haria el webhook. */
async function donar(monto: number, comision: number) {
  const neto = Number((monto - comision).toFixed(2));

  const donacion = await prisma.donacion.create({
    data: {
      donanteId,
      fondoId,
      monto,
      montoNeto: neto,
      estado: 'CONFIRMADA',
      confirmadaEn: new Date(),
      pago: {
        create: {
          pasarela: 'fake',
          referenciaExterna: `fk_${marca}_${contador++}`,
          monto,
          comision,
          montoNeto: neto,
          estado: 'APROBADO',
          procesadoEn: new Date(),
        },
      },
    },
  });

  for (const [tipo, importe] of [
    ['INGRESO', monto],
    ['COMISION', comision],
    ['RETENCION', neto],
  ] as const) {
    await prisma.movimientoContable.create({
      data: {
        fondoId,
        donacionId: donacion.id,
        tipo,
        cuentaDebe: 'a',
        cuentaHaber: 'b',
        monto: importe,
        descripcion: `${tipo} de prueba`,
      },
    });
  }

  return donacion;
}

/** Gasto aprobado y aplicado, con analisis de nivel ALTO. */
async function gastoAprobado(monto: number) {
  contador += 1;

  const gasto = await prisma.gasto.create({
    data: {
      fondoId,
      ongId,
      registradoPor: operadorId,
      montoDeclarado: monto,
      concepto: `Compra "premium", 20 kg ${contador}`,
      proveedorNombre: 'Proveedor; con punto y coma',
      fechaGasto: new Date('2026-09-10'),
      capturadoEn: new Date(Date.now() - 60_000),
      sincronizadoEn: new Date(Date.now() - 30_000),
      estado: 'EN_ANALISIS',
      comprobante: {
        create: {
          tipo: 'BOLETA',
          rucEmisor: '20601030579',
          serie: 'B001',
          numero: String(contador),
          fechaEmision: new Date('2026-09-09'),
          subtotal: Math.round((monto / 1.18) * 100) / 100,
          igv: Math.round((monto - monto / 1.18) * 100) / 100,
          total: monto,
          archivoUrl: `comprobantes/${marca}-${contador}.jpg`,
          archivoMime: 'image/jpeg',
          archivoBytes: 1024,
          hashSha256: createHash('sha256').update(`an-${marca}-${contador}`).digest('hex'),
        },
      },
      evidencias: {
        create: {
          tipo: 'FOTO',
          archivoUrl: `evidencias/${marca}-${contador}.jpg`,
          archivoMime: 'image/jpeg',
          archivoBytes: 2048,
          hashSha256: createHash('sha256').update(`an-ev-${marca}-${contador}`).digest('hex'),
          hashPerceptual: randomBytes(8).toString('hex'),
          contienePersonas: false,
          anonimizada: true,
        },
      },
    },
  });

  const [modelo, regla] = await Promise.all([
    prisma.modeloIa.findFirstOrThrow({ where: { version: 'reglas-v0' } }),
    prisma.reglaConfianza.findFirstOrThrow({ where: { activa: true } }),
  ]);
  await prisma.analisisAini.create({
    data: {
      gastoId: gasto.id,
      modeloId: modelo.id,
      reglaId: regla.id,
      scoreDocumental: 100,
      scoreVisual: 100,
      scoreAnomalia: 100,
      scoreFinal: 100,
      nivel: 'ALTO',
      datosExtraidos: { fuente: 'declarado' },
      explicacion: { motivos: [], resumen: 'Aprobado para la prueba de analitica.' },
    },
  });

  await fifo.aprobarYAplicar({ gastoId: gasto.id, montoAprobado: monto });
  return gasto;
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [
      PrismaService,
      BitacoraService,
      LibroService,
      AplicacionFifoService,
      ConciliacionService,
      IndicadoresService,
      ExportacionService,
    ],
  }).compile();

  prisma = modulo.get(PrismaService);
  conciliacion = modulo.get(ConciliacionService);
  indicadores = modulo.get(IndicadoresService);
  exportacion = modulo.get(ExportacionService);
  fifo = modulo.get(AplicacionFifoService);
  await prisma.$connect();

  const ong = await prisma.ong.create({
    data: {
      ruc: `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`,
      razonSocial: `ONG de analitica ${marca}`,
      representanteLegal: 'Representante',
      documentoRepresentante: '00000000',
      direccion: 'Sin direccion',
      departamento: 'Huanuco',
      correoContacto: `ana-${marca}@prueba.pe`,
      descripcion: 'Organizacion creada por las pruebas de analitica.',
      estadoVerificacion: 'VERIFICADA',
    },
  });
  ongId = ong.id;

  const campana = await prisma.campana.create({
    data: {
      ongId,
      titulo: `Campaña de analitica ${marca}`,
      slug: `analitica-${marca}`,
      descripcion: 'Campaña creada por las pruebas de analitica.',
      causa: `Pruebas ${marca}`,
      fechaInicio: new Date('2026-01-01'),
      estado: 'ACTIVA',
    },
  });
  campanaId = campana.id;

  const fondo = await prisma.fondo.create({
    data: { campanaId, nombre: `Fondo analitica ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 50_000 },
  });
  fondoId = fondo.id;

  const rolOperador = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'ONG_OPERADOR' } });
  const operador = await prisma.usuario.create({
    data: {
      correo: `op-ana-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Operador',
      apellidos: 'Analitica',
      estado: 'ACTIVO',
      roles: { create: { rolId: rolOperador.id } },
      membresias: { create: { ongId, cargo: 'OPERADOR' } },
    },
  });
  operadorId = operador.id;
  usuarios.push(operador.id);

  const rolDonante = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'DONANTE' } });
  const donanteUsuario = await prisma.usuario.create({
    data: {
      correo: `don-ana-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Donante',
      apellidos: 'Analitica',
      estado: 'ACTIVO',
      roles: { create: { rolId: rolDonante.id } },
      donante: { create: {} },
    },
  });
  usuarios.push(donanteUsuario.id);
  donanteId = (await prisma.donante.findUniqueOrThrow({
    where: { usuarioId: donanteUsuario.id },
  })).id;
}, 60_000);

afterAll(async () => {
  await prisma.analisisAini.deleteMany({ where: { gasto: { ongId } } });
  await prisma.aplicacionDonacion.deleteMany({ where: { gasto: { ongId } } });
  await prisma.evidencia.deleteMany({ where: { gasto: { ongId } } });
  await prisma.comprobante.deleteMany({ where: { gasto: { ongId } } });
  await prisma.trabajoVerificacion.deleteMany({ where: { gasto: { ongId } } });

  await prisma.$executeRaw`ALTER TABLE movimientos_contables DISABLE TRIGGER tg_movimientos_no_delete`;
  try {
    await prisma.$executeRaw`
      DELETE FROM movimientos_contables
       WHERE fondo_id IN (SELECT id FROM fondos WHERE campana_id = ${campanaId}::uuid)
    `;
  } finally {
    await prisma.$executeRaw`ALTER TABLE movimientos_contables ENABLE TRIGGER tg_movimientos_no_delete`;
  }

  await prisma.gasto.deleteMany({ where: { ongId } });
  await prisma.pago.deleteMany({ where: { donacion: { fondo: { campanaId } } } });
  await prisma.donacion.deleteMany({ where: { fondo: { campanaId } } });
  await prisma.fondo.deleteMany({ where: { campanaId } });
  await prisma.campana.delete({ where: { id: campanaId } });
  await prisma.ongMiembro.deleteMany({ where: { ongId } });
  await prisma.ong.delete({ where: { id: ongId } });
  await prisma.bitacoraAuditoria.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.donante.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.$disconnect();
});

describe('CU16 · Conciliacion con datos sanos', () => {
  it('cuadra y reporta los totales de cada fuente', async () => {
    await donar(200, 7.88);
    await donar(150, 6.16);
    await gastoAprobado(100);

    const r = await conciliacion.conciliar();

    expect(r.cuadra).toBe(true);
    expect(r.descuadres).toEqual([]);
    expect(r.cadenas.rotas).toBe(0);
    // Los totales salen de tablas escritas por caminos distintos.
    expect(Number(r.totales.ingresosLibro.replace(/,/g, ''))).toBeGreaterThan(0);
    expect(r.duracionMs).toBeGreaterThanOrEqual(0);
  });

  it('el saldo del fondo coincide con la suma de su propio libro', async () => {
    const r = await conciliacion.conciliar();

    expect(r.descuadres.filter((d) => d.comprobacion.startsWith('saldo_'))).toEqual([]);
  });
});

describe('La conciliacion detecta lo que deberia', () => {
  it('detecta un saldo alterado por fuera del libro', async () => {
    const antes = await prisma.fondo.findUniqueOrThrow({ where: { id: fondoId } });

    // Se altera el saldo saltandose el trigger, que es exactamente lo que
    // haria alguien manipulando la base directamente.
    await prisma.fondo.update({
      where: { id: fondoId },
      data: { saldoRetenido: antes.saldoRetenido.plus(500) },
    });

    try {
      const r = await conciliacion.conciliar();

      expect(r.cuadra).toBe(false);
      const descuadre = r.descuadres.find((d) => d.comprobacion === 'saldo_retenido_vs_libro');
      expect(descuadre).toBeDefined();
      expect(descuadre!.severidad).toBe('CRITICO');
      // Dice de cuanto es la diferencia: un descuadre sin importe obliga a
      // recalcularlo a mano, que es justo lo que se queria evitar.
      expect(descuadre!.diferencia).toBe('-500.00');
    } finally {
      await prisma.fondo.update({
        where: { id: fondoId },
        data: { saldoRetenido: antes.saldoRetenido },
      });
    }
  });

  it('detecta una cadena de hashes rota (RNF-07)', async () => {
    await prisma.$executeRaw`ALTER TABLE movimientos_contables DISABLE TRIGGER tg_movimientos_no_update`;
    let montoOriginal: string | null = null;
    try {
      const movimiento = await prisma.movimientoContable.findFirstOrThrow({
        where: { fondoId },
        orderBy: { secuencia: 'asc' },
      });
      montoOriginal = movimiento.monto.toFixed(2);

      await prisma.$executeRaw`
        UPDATE movimientos_contables SET monto = monto + 1 WHERE id = ${movimiento.id}::uuid
      `;

      const r = await conciliacion.conciliar();

      expect(r.cuadra).toBe(false);
      expect(r.cadenas.rotas).toBeGreaterThanOrEqual(1);
      expect(r.cadenas.fondosRotos).toContain(fondoId);

      const descuadre = r.descuadres.find((d) => d.comprobacion === 'cadena_hashes');
      expect(descuadre?.descripcion).toMatch(/modifico el libro por fuera/i);
    } finally {
      if (montoOriginal !== null) {
        const movimiento = await prisma.movimientoContable.findFirstOrThrow({
          where: { fondoId },
          orderBy: { secuencia: 'asc' },
        });
        await prisma.$executeRaw`
          UPDATE movimientos_contables SET monto = ${montoOriginal}::numeric
           WHERE id = ${movimiento.id}::uuid
        `;
      }
      await prisma.$executeRaw`ALTER TABLE movimientos_contables ENABLE TRIGGER tg_movimientos_no_update`;
    }
  });

  it('vuelve a cuadrar cuando se restaura el dato alterado', async () => {
    const r = await conciliacion.conciliar();

    // Sin esta comprobacion, las dos pruebas anteriores podrian estar
    // dejando la base rota y las siguientes fallarian por arrastre.
    expect(r.cuadra).toBe(true);
  });

  it('deja encendidos los triggers que apago para simular la manipulacion', async () => {
    // La prueba anterior demuestra que el dato volvio a su lugar; esta, que
    // volvio la proteccion. Son cosas distintas: el libro podria estar correcto
    // y a la vez haber quedado modificable, que es el peor de los dos estados
    // porque no se nota mirando los numeros.
    const estado = await triggersHabilitados(prisma);

    for (const trigger of TRIGGERS_INMUTABILIDAD) {
      expect(estado[trigger]).toBe(true);
    }
  });
});

describe('CU20 · Indicadores de la Tabla 3', () => {
  it('mide lo que puede y declara lo que no', async () => {
    const { indicadores: lista, medidos, total } = await indicadores.tabla3();

    expect(total).toBeGreaterThan(8);
    expect(medidos).toBeGreaterThan(0);

    // Los no medibles se declaran con su motivo en vez de omitirse: un
    // tablero que solo muestra lo que sabe medir sugiere que eso era todo.
    const sinMedir = lista.filter((i) => i.valor === null);
    for (const indicador of sinMedir) {
      expect(indicador.noMedible).toBeTruthy();
      expect(indicador.noMedible!.length).toBeGreaterThan(20);
    }
  });

  it('declara que la exactitud del OCR no se puede medir sin AIni', async () => {
    const { indicadores: lista } = await indicadores.tabla3();
    const ocr = lista.find((i) => i.codigo === 'INF-3');

    expect(ocr?.valor).toBeNull();
    expect(ocr?.noMedible).toMatch(/los captura el operador/i);
  });

  it('mide el porcentaje de soles respaldados con comprobante y evidencia', async () => {
    const { indicadores: lista } = await indicadores.tabla3();
    const respaldo = lista.find((i) => i.codigo === 'CYF-1');

    expect(respaldo?.valor).toBe(100);
    expect(respaldo?.cumple).toBe(true);
  });

  it('comprueba que ninguna evidencia sin anonimizar llego a un donante', async () => {
    const { indicadores: lista } = await indicadores.tabla3();
    const privacidad = lista.find((i) => i.codigo === 'DER-1');

    // La base lo impide por trigger, pero se mide igual: un control que no
    // se comprueba nunca es una promesa, no un control.
    expect(privacidad?.valor).toBe(0);
    expect(privacidad?.cumple).toBe(true);
  });

  it('el resumen cuenta ONG, donaciones y gastos', async () => {
    const resumen = await indicadores.resumen();

    expect(resumen.ongsVerificadas).toBeGreaterThan(0);
    expect(resumen.donaciones.cantidad).toBeGreaterThan(0);
    expect(resumen.gastos).toHaveProperty('APROBADO');
  });
});

describe('RF-15 · Exportaciones', () => {
  it('el libro exportado incluye los hashes para recalcular la cadena', async () => {
    const { nombre, csv } = await exportacion.libroDeFondo(fondoId);

    expect(nombre).toMatch(/^libro-.*\.csv$/);
    expect(csv).toContain('hash_previo,hash_actual');
    // Sin los hashes, un tercero tendria que confiar en que el sistema dice
    // la verdad sobre si mismo.
    expect(csv).toMatch(/[0-9a-f]{64}/);
  });

  it('escapa comas y comillas para que el CSV no se desalinee', async () => {
    const { csv } = await exportacion.gastosDeOng(ongId);

    // El concepto sembrado contiene comillas y coma; el proveedor, un punto
    // y coma. Si no se escapan, la fila se parte y el auditor ve datos en
    // columnas equivocadas.
    expect(csv).toContain('"Compra ""premium"", 20 kg');
    expect(csv).toContain('"Proveedor; con punto y coma"');
  });

  it('lleva BOM para que Excel en Windows respete las tildes', async () => {
    const { csv } = await exportacion.conciliacionCsv();

    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain('comprobacion');
  });

  it('CU17 · el informe de auditoria confirma la integridad de cada fondo', async () => {
    const informe = await exportacion.informeAuditoria(ongId);

    expect(informe.organizacion.ruc).toHaveLength(11);
    expect(informe.fondos.length).toBeGreaterThan(0);
    // Lo primero que un auditor externo querria confirmar.
    expect(informe.fondos.every((f) => f.cadenaIntegra)).toBe(true);
    expect(informe.fondos[0].movimientos).toBeGreaterThan(0);
  });

  it('rechaza exportar un fondo u organizacion que no existe', async () => {
    const inexistente = randomUUID();

    await expect(exportacion.libroDeFondo(inexistente)).rejects.toThrow(/No encontramos/i);
    await expect(exportacion.informeAuditoria(inexistente)).rejects.toThrow(/No encontramos/i);
  });
});
