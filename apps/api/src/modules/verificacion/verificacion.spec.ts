/**
 * Prueba del ciclo de verificacion completo (Fase 6).
 *
 * Es el criterio de salida de la fase: tres gastos sembrados a proposito
 * caen uno en cada nivel, cada uno con su explicacion, el ALTO se aplica
 * FIFO contra las donaciones reales y el libro sigue cuadrando.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { NarrativaService } from '../retorno/narrativa.service';
import { RetornoService } from '../retorno/retorno.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { AplicacionFifoService } from '../contable/aplicacion-fifo.service';
import { LibroService } from '../contable/libro.service';
import { AlmacenamientoDisco } from '../gastos/almacenamiento/disco.storage';
import { ALMACENAMIENTO } from '../gastos/puertos/almacenamiento.port';
import { ColaVerificacionService } from './cola.service';
import { FakeSunatService } from './cpe/fake-sunat.service';
import { MotorReglasV0 } from './motores/reglas-v0.motor';
import { MOTOR_VERIFICACION } from './puertos/motor-verificacion.port';
import { SERVICIO_CPE } from './puertos/servicio-cpe.port';
import { VerificacionService } from './verificacion.service';

const marca = randomUUID().slice(0, 8);

let prisma: PrismaService;
let verificacion: VerificacionService;
let cola: ColaVerificacionService;
let libro: LibroService;

const usuarios: string[] = [];
let ongId: string;
let campanaId: string;
let donanteId: string;
let operadorId: string;

let contador = 5000;

/**
 * Crea un fondo con saldo retenido proveniente de donaciones reales.
 *
 * Cada caso usa su propia categoria de gasto. Sin eso, las señales de
 * anomalia (historial de montos, fraccionamiento) acumulan estado entre
 * pruebas y el nivel resultante depende del orden de ejecucion, que es
 * justo lo que una prueba no debe tolerar.
 */
async function fondoConDonaciones(
  nombre: string,
  montos: number[],
  categoriaGasto: 'ALIMENTOS' | 'MEDICAMENTOS' | 'INSUMOS' | 'TRANSPORTE' | 'ESTERILIZACION' | 'OTROS' = 'ALIMENTOS',
) {
  const fondo = await prisma.fondo.create({
    data: { campanaId, nombre: `${nombre} ${marca}`, categoriaGasto, meta: 100_000 },
  });

  for (const monto of montos) {
    const donacion = await prisma.donacion.create({
      data: {
        donanteId,
        fondoId: fondo.id,
        monto,
        montoNeto: monto,
        estado: 'CONFIRMADA',
        confirmadaEn: new Date(),
      },
    });
    await prisma.movimientoContable.create({
      data: {
        fondoId: fondo.id,
        donacionId: donacion.id,
        tipo: 'INGRESO',
        cuentaDebe: '10.1 Caja y bancos',
        cuentaHaber: '20.1 Donaciones por ejecutar',
        monto,
        descripcion: 'Ingreso de donacion',
      },
    });
    await prisma.movimientoContable.create({
      data: {
        fondoId: fondo.id,
        donacionId: donacion.id,
        tipo: 'RETENCION',
        cuentaDebe: '20.1 Donaciones por ejecutar',
        cuentaHaber: '20.2 Fondos retenidos por justificar',
        monto,
        descripcion: 'Retencion condicionada a evidencia de gasto',
      },
    });
  }

  return prisma.fondo.findUniqueOrThrow({ where: { id: fondo.id } });
}

/** Crea un gasto con comprobante y evidencia, ya encolado. */
async function crearGasto(opciones: {
  fondoId: string;
  monto: number;
  rucEmisor?: string;
  subtotal?: number;
  igv?: number;
  total?: number;
  hashPerceptual?: string;
  nitidez?: number;
  fechaEmision?: Date;
  proveedor?: string;
}) {
  contador += 1;
  const total = opciones.total ?? opciones.monto;
  const subtotal = opciones.subtotal ?? Math.round((total / 1.18) * 100) / 100;

  const gasto = await prisma.gasto.create({
    data: {
      fondoId: opciones.fondoId,
      ongId,
      registradoPor: operadorId,
      montoDeclarado: opciones.monto,
      concepto: 'Compra de alimento balanceado para el refugio',
      proveedorNombre: opciones.proveedor ?? `Proveedor ${marca}`,
      fechaGasto: new Date('2026-09-10'),
      capturadoEn: new Date('2026-09-10T15:00:00Z'),
      estado: 'EN_ANALISIS',
      comprobante: {
        create: {
          tipo: 'BOLETA',
          rucEmisor: opciones.rucEmisor ?? '20601030579',
          serie: 'B001',
          numero: String(contador),
          fechaEmision: opciones.fechaEmision ?? new Date('2026-09-09'),
          subtotal,
          igv: opciones.igv ?? Math.round((total - subtotal) * 100) / 100,
          total,
          archivoUrl: `comprobantes/${marca}-${contador}.jpg`,
          archivoMime: 'image/jpeg',
          archivoBytes: 1024,
          hashSha256: createHash('sha256').update(`comp-${marca}-${contador}`).digest('hex'),
        },
      },
      evidencias: {
        create: {
          tipo: 'FOTO',
          archivoUrl: `evidencias/${marca}-${contador}.jpg`,
          archivoMime: 'image/jpeg',
          archivoBytes: 2048,
          ancho: 1280,
          alto: 960,
          hashSha256: createHash('sha256').update(`ev-${marca}-${contador}`).digest('hex'),
          // Aleatorio, no secuencial: dos contadores consecutivos en
          // hexadecimal difieren en uno o dos bits, y el motor los tomaria
          // por la misma imagen reciclada.
          hashPerceptual: opciones.hashPerceptual ?? randomBytes(8).toString('hex'),
          nitidez: opciones.nitidez ?? 300,
          exifCapturadoEn: new Date('2026-09-10T15:00:00Z'),
          contienePersonas: false,
          anonimizada: true,
        },
      },
    },
  });

  await prisma.trabajoVerificacion.create({ data: { gastoId: gasto.id } });
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
      NarrativaService,
      RetornoService,
      VerificacionService,
      ColaVerificacionService,
      MotorReglasV0,
      FakeSunatService,
      AlmacenamientoDisco,
      { provide: SERVICIO_CPE, useExisting: FakeSunatService },
      { provide: MOTOR_VERIFICACION, useExisting: MotorReglasV0 },
      // El analisis emite URLs firmadas para que el motor pueda descargar el
      // comprobante; el adaptador de disco alcanza para las pruebas.
      { provide: ALMACENAMIENTO, useExisting: AlmacenamientoDisco },
    ],
  }).compile();

  prisma = modulo.get(PrismaService);
  verificacion = modulo.get(VerificacionService);
  cola = modulo.get(ColaVerificacionService);
  libro = modulo.get(LibroService);
  await prisma.$connect();

  const ong = await prisma.ong.create({
    data: {
      ruc: `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`,
      razonSocial: `ONG de verificacion ${marca}`,
      representanteLegal: 'Representante de Prueba',
      documentoRepresentante: '00000000',
      direccion: 'Sin direccion',
      departamento: 'Huanuco',
      correoContacto: `verif-${marca}@prueba.pe`,
      descripcion: 'Organizacion creada por las pruebas de verificacion.',
      estadoVerificacion: 'VERIFICADA',
    },
  });
  ongId = ong.id;

  const campana = await prisma.campana.create({
    data: {
      ongId,
      titulo: `Campaña de verificacion ${marca}`,
      slug: `verificacion-${marca}`,
      descripcion: 'Campaña creada por las pruebas del motor de verificacion.',
      causa: `Pruebas ${marca}`,
      fechaInicio: new Date('2026-01-01'),
      estado: 'ACTIVA',
    },
  });
  campanaId = campana.id;

  const rolOperador = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'ONG_OPERADOR' } });
  const operador = await prisma.usuario.create({
    data: {
      correo: `operador-verif-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Operador',
      apellidos: 'Verificacion',
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
      correo: `donante-verif-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Donante',
      apellidos: 'Verificacion',
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
  await prisma.alerta.deleteMany({ where: { ongId } });
  await prisma.analisisAini.deleteMany({ where: { gasto: { ongId } } });
  await prisma.trabajoVerificacion.deleteMany({ where: { gasto: { ongId } } });
  await prisma.aplicacionDonacion.deleteMany({ where: { gasto: { ongId } } });
  await prisma.evidencia.deleteMany({ where: { gasto: { ongId } } });
  await prisma.comprobante.deleteMany({ where: { gasto: { ongId } } });

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

describe('Criterio de salida: un gasto en cada nivel', () => {
  it('ALTO · aprueba, aplica FIFO y asienta la ejecucion', async () => {
    const fondo = await fondoConDonaciones('Fondo alto', [60, 80]);
    const gasto = await crearGasto({ fondoId: fondo.id, monto: 100 });

    const r = await verificacion.analizarGasto(gasto.id);

    expect(r.nivel).toBe('ALTO');
    expect(r.accion).toBe('aprobado_automaticamente');

    const aprobado = await prisma.gasto.findUniqueOrThrow({
      where: { id: gasto.id },
      include: { aplicaciones: { include: { donacion: true } } },
    });
    expect(aprobado.estado).toBe('APROBADO');

    // FIFO: consume primero la donacion mas antigua (60) y 40 de la segunda.
    const montos = aprobado.aplicaciones.map((a) => a.monto.toFixed(2)).sort();
    expect(montos).toEqual(['40.00', '60.00']);

    // RN-04: la suma aplicada iguala el monto aprobado.
    const suma = aprobado.aplicaciones.reduce(
      (t, a) => t.plus(a.monto),
      new Prisma.Decimal(0),
    );
    expect(suma.toFixed(2)).toBe('100.00');

    // El libro asento la ejecucion y la cadena sigue intacta.
    const extracto = await libro.extracto(fondo.id);
    expect(extracto.filter((m) => m.tipo === 'EJECUCION')).toHaveLength(1);
    expect((await libro.verificarCadena(fondo.id)).rota).toBe(false);

    const saldos = await prisma.fondo.findUniqueOrThrow({ where: { id: fondo.id } });
    expect(saldos.saldoEjecutado.toFixed(2)).toBe('100.00');
    expect(saldos.saldoRetenido.toFixed(2)).toBe('40.00');
  });

  it('MEDIO · deriva al panel de auditoria sin tocar el libro', async () => {
    const fondo = await fondoConDonaciones('Fondo medio', [500], 'MEDICAMENTOS');
    // RUC invalido y comprobante viejo: baja el puntaje sin bloquear.
    // Documental 50, visual 100, anomalia 90 -> 74.5, entre 60 y 90.
    const gasto = await crearGasto({
      fondoId: fondo.id,
      monto: 100,
      rucEmisor: '20601030570',
      fechaEmision: new Date('2026-06-01'),
      proveedor: `Proveedor medio ${marca}`,
    });

    const r = await verificacion.analizarGasto(gasto.id);

    expect(r.nivel).toBe('MEDIO');
    expect(r.accion).toBe('derivado_a_auditoria');

    const enRevision = await prisma.gasto.findUniqueOrThrow({ where: { id: gasto.id } });
    expect(enRevision.estado).toBe('EN_REVISION');

    // Nada se ejecuto: el dinero sigue retenido esperando decision humana.
    const extracto = await libro.extracto(fondo.id);
    expect(extracto.filter((m) => m.tipo === 'EJECUCION')).toHaveLength(0);
  });

  it('BAJO · bloquea, abre alerta con plazo y no afecta la reputacion todavia', async () => {
    const fondo = await fondoConDonaciones('Fondo bajo', [50], 'INSUMOS');
    // El gasto excede el saldo retenido: bloqueo duro.
    const gasto = await crearGasto({ fondoId: fondo.id, monto: 500 });

    const r = await verificacion.analizarGasto(gasto.id);

    expect(r.nivel).toBe('BAJO');
    expect(r.accion).toBe('observado_para_subsanacion');

    const observado = await prisma.gasto.findUniqueOrThrow({ where: { id: gasto.id } });
    expect(observado.estado).toBe('OBSERVADO');

    const alerta = await prisma.alerta.findFirstOrThrow({ where: { gastoId: gasto.id } });
    expect(alerta.estado).toBe('ABIERTA');
    expect(alerta.plazoSubsanacion).not.toBeNull();
    // RF-SO-04: el debido proceso primero; la reputacion solo se toca si
    // vence el plazo sin respuesta.
    expect(alerta.afectaReputacion).toBe(false);
  });
});

describe('Trazabilidad de la decision (RN-06, RNF-09)', () => {
  it('cada analisis queda atado al motor y a la regla vigente', async () => {
    const fondo = await fondoConDonaciones('Fondo trazable', [300], 'TRANSPORTE');
    const gasto = await crearGasto({ fondoId: fondo.id, monto: 100 });

    await verificacion.analizarGasto(gasto.id);

    const analisis = await prisma.analisisAini.findFirstOrThrow({
      where: { gastoId: gasto.id },
      include: { modelo: true, regla: true },
    });

    expect(analisis.modelo.version).toBe('reglas-v0');
    // El motor de esta version es de reglas, no un modelo entrenado.
    expect(analisis.modelo.tipo).toBe('REGLAS');
    expect(analisis.regla.activa).toBe(true);
    expect(analisis.duracionMs).toBeGreaterThanOrEqual(0);

    const explicacion = analisis.explicacion as { motivos: unknown[]; resumen: string };
    expect(explicacion.motivos.length).toBeGreaterThan(3);
    expect(explicacion.resumen.length).toBeGreaterThan(20);
  });

  it('cambiar los umbrales no reescribe analisis anteriores', async () => {
    const fondo = await fondoConDonaciones('Fondo umbrales', [300], 'ESTERILIZACION');
    const gasto = await crearGasto({ fondoId: fondo.id, monto: 100 });
    await verificacion.analizarGasto(gasto.id);

    const antes = await prisma.analisisAini.findFirstOrThrow({ where: { gastoId: gasto.id } });
    const reglaOriginal = await prisma.reglaConfianza.findFirstOrThrow({ where: { activa: true } });

    // Se cierra la regla vigente y se abre otra mas exigente.
    const nueva = await prisma.$transaction(async (tx) => {
      await tx.reglaConfianza.update({
        where: { id: reglaOriginal.id },
        data: { activa: false, vigenteHasta: new Date() },
      });
      return tx.reglaConfianza.create({
        data: {
          umbralAlto: 99,
          umbralMedio: 95,
          pesoDocumental: 0.45,
          pesoVisual: 0.25,
          pesoAnomalia: 0.3,
          activa: true,
        },
      });
    });

    try {
      // El analisis viejo sigue apuntando a la regla con la que se evaluo.
      const despues = await prisma.analisisAini.findUniqueOrThrow({ where: { id: antes.id } });
      expect(despues.reglaId).toBe(reglaOriginal.id);
      expect(despues.nivel).toBe(antes.nivel);
    } finally {
      await prisma.$transaction([
        prisma.reglaConfianza.delete({ where: { id: nueva.id } }),
        prisma.reglaConfianza.update({
          where: { id: reglaOriginal.id },
          data: { activa: true, vigenteHasta: null },
        }),
      ]);
    }
  });
});

describe('Cola de verificacion (ADR-0002)', () => {
  it('procesa los trabajos pendientes y los marca completados', async () => {
    const fondo = await fondoConDonaciones('Fondo cola', [400], 'OTROS');
    await crearGasto({ fondoId: fondo.id, monto: 50 });
    await crearGasto({ fondoId: fondo.id, monto: 60 });

    // Se vacia la cola: procesarLote toma un lote por pasada, y pueden
    // quedar trabajos de casos anteriores.
    let atendidos = 0;
    for (let i = 0; i < 10; i += 1) {
      const n = await cola.procesarLote();
      atendidos += n;
      if (n === 0) break;
    }
    expect(atendidos).toBeGreaterThanOrEqual(2);

    const pendientes = await prisma.trabajoVerificacion.count({
      where: { gasto: { fondoId: fondo.id }, estado: 'PENDIENTE' },
    });
    expect(pendientes).toBe(0);
  });

  it('un trabajo sin gasto valido se reintenta y termina en revision humana', async () => {
    const fondo = await fondoConDonaciones('Fondo fallido', [100], 'OTROS');
    const gasto = await crearGasto({ fondoId: fondo.id, monto: 50 });

    // Se le quita el comprobante: el analisis no puede completarse.
    await prisma.comprobante.deleteMany({ where: { gastoId: gasto.id } });

    // Tres pasadas agotan los intentos.
    for (let i = 0; i < 3; i += 1) {
      await prisma.trabajoVerificacion.updateMany({
        where: { gastoId: gasto.id },
        data: { proximoIntentoEn: new Date(Date.now() - 1000) },
      });
      await cola.procesarLote();
    }

    const trabajo = await prisma.trabajoVerificacion.findFirstOrThrow({
      where: { gastoId: gasto.id },
    });
    expect(trabajo.estado).toBe('FALLIDO');
    expect(trabajo.error).toBeTruthy();

    // El desenlace seguro cuando la automatizacion falla es una persona, no
    // dejar el gasto colgado en EN_ANALISIS para siempre.
    const final = await prisma.gasto.findUniqueOrThrow({ where: { id: gasto.id } });
    expect(final.estado).toBe('EN_REVISION');
  });

  it('el estado de la cola resume lo pendiente y lo fallido', async () => {
    const estado = await cola.estado();

    expect(estado).toHaveProperty('pendientes');
    expect(estado).toHaveProperty('completados');
    expect(estado.completados).toBeGreaterThan(0);
  });
});
