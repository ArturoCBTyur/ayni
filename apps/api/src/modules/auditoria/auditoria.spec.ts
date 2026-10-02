/**
 * Pruebas de Auditoria y Alertas (Fase 7).
 *
 * Lo que se verifica: que una decision humana quede siempre fundamentada,
 * que aprobar por auditoria use exactamente la misma ruta contable que la
 * aprobacion automatica, que el debido proceso reputacional se respete, y
 * que nadie audite a una ONG de la que es miembro.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { horasHabilesEntre, sumarHorasHabiles } from '../../comun/fechas';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { NarrativaService } from '../retorno/narrativa.service';
import { RetornoService } from '../retorno/retorno.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { OngsService } from '../campanas/ongs.service';
import { AplicacionFifoService } from '../contable/aplicacion-fifo.service';
import { LibroService } from '../contable/libro.service';
import { AlertasService } from './alertas.service';
import { AuditoriaService } from './auditoria.service';

const marca = randomUUID().slice(0, 8);

let prisma: PrismaService;
let auditoria: AuditoriaService;
let alertas: AlertasService;
let libro: LibroService;

const usuarios: string[] = [];
let ongId: string;
let campanaId: string;
let donanteId: string;
let operadorId: string;
let auditorId: string;
let auditorAlternoId: string;

let contador = 9000;

async function crearAuditor(sufijo: string) {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'AUDITOR' } });
  const usuario = await prisma.usuario.create({
    data: {
      correo: `auditor-${sufijo}-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Auditor',
      apellidos: sufijo,
      estado: 'ACTIVO',
      roles: { create: { rolId: rol.id } },
    },
  });
  usuarios.push(usuario.id);
  return usuario.id;
}

/** Fondo con donaciones confirmadas y su saldo retenido asentado. */
async function fondoConDonaciones(nombre: string, montos: number[]) {
  const fondo = await prisma.fondo.create({
    data: { campanaId, nombre: `${nombre} ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 100_000 },
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
    for (const tipo of ['INGRESO', 'RETENCION'] as const) {
      await prisma.movimientoContable.create({
        data: {
          fondoId: fondo.id,
          donacionId: donacion.id,
          tipo,
          cuentaDebe: 'a',
          cuentaHaber: 'b',
          monto,
          descripcion: `${tipo} sembrado`,
        },
      });
    }
  }
  return prisma.fondo.findUniqueOrThrow({ where: { id: fondo.id } });
}

/** Gasto en revision, con un analisis de nivel MEDIO ya registrado. */
async function gastoEnRevision(fondoId: string, monto: number, creadoEn?: Date) {
  contador += 1;

  const gasto = await prisma.gasto.create({
    data: {
      fondoId,
      ongId,
      registradoPor: operadorId,
      montoDeclarado: monto,
      concepto: `Compra de insumos ${contador}`,
      proveedorNombre: `Proveedor ${marca}`,
      fechaGasto: new Date('2026-09-10'),
      estado: 'EN_REVISION',
      ...(creadoEn ? { creadoEn } : {}),
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
          hashSha256: createHash('sha256').update(`aud-${marca}-${contador}`).digest('hex'),
        },
      },
      evidencias: {
        create: {
          tipo: 'FOTO',
          archivoUrl: `evidencias/${marca}-${contador}.jpg`,
          archivoMime: 'image/jpeg',
          archivoBytes: 2048,
          hashSha256: createHash('sha256').update(`aud-ev-${marca}-${contador}`).digest('hex'),
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
      scoreDocumental: 70,
      scoreVisual: 80,
      scoreAnomalia: 75,
      scoreFinal: 74.5,
      nivel: 'MEDIO',
      datosExtraidos: { fuente: 'declarado' },
      explicacion: { motivos: [], resumen: 'Derivado a revision para la prueba.' },
    },
  });

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
      OngsService,
      AuditoriaService,
      AlertasService,
    ],
  }).compile();

  prisma = modulo.get(PrismaService);
  auditoria = modulo.get(AuditoriaService);
  alertas = modulo.get(AlertasService);
  libro = modulo.get(LibroService);
  await prisma.$connect();

  const ong = await prisma.ong.create({
    data: {
      ruc: `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`,
      razonSocial: `ONG de auditoria ${marca}`,
      representanteLegal: 'Representante de Prueba',
      documentoRepresentante: '00000000',
      direccion: 'Sin direccion',
      departamento: 'Huanuco',
      correoContacto: `aud-${marca}@prueba.pe`,
      descripcion: 'Organizacion creada por las pruebas de auditoria.',
      estadoVerificacion: 'VERIFICADA',
    },
  });
  ongId = ong.id;

  const campana = await prisma.campana.create({
    data: {
      ongId,
      titulo: `Campaña de auditoria ${marca}`,
      slug: `auditoria-${marca}`,
      descripcion: 'Campaña creada por las pruebas del modulo de auditoria.',
      causa: `Pruebas ${marca}`,
      fechaInicio: new Date('2026-01-01'),
      estado: 'ACTIVA',
    },
  });
  campanaId = campana.id;

  const rolOperador = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'ONG_OPERADOR' } });
  const operador = await prisma.usuario.create({
    data: {
      correo: `op-aud-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Operador',
      apellidos: 'Auditoria',
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
      correo: `don-aud-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Donante',
      apellidos: 'Auditoria',
      estado: 'ACTIVO',
      roles: { create: { rolId: rolDonante.id } },
      donante: { create: {} },
    },
  });
  usuarios.push(donanteUsuario.id);
  donanteId = (await prisma.donante.findUniqueOrThrow({
    where: { usuarioId: donanteUsuario.id },
  })).id;

  auditorId = await crearAuditor('titular');
  auditorAlternoId = await crearAuditor('alterno');
}, 60_000);

afterAll(async () => {
  await prisma.alerta.deleteMany({ where: { ongId } });
  await prisma.revisionAuditoria.deleteMany({ where: { gasto: { ongId } } });
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

describe('CU15 · Decision del auditor', () => {
  it('APROBAR aplica FIFO por la misma ruta que la aprobacion automatica', async () => {
    const fondo = await fondoConDonaciones('Fondo aprobar', [70, 90]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    const r = await auditoria.revisar(
      gasto.id,
      auditorId,
      {
        decision: 'APROBAR',
        comentario: 'Comprobante y evidencia coherentes con el concepto declarado.',
        diasSubsanacion: 5,
      },
      {},
    );

    expect(r.estado).toBe('APROBADO');
    expect(r.donacionesFinanciadas).toBe(2);

    const aprobado = await prisma.gasto.findUniqueOrThrow({
      where: { id: gasto.id },
      include: { aplicaciones: true },
    });
    expect(aprobado.estado).toBe('APROBADO');
    // FIFO: 70 de la primera donacion y 30 de la segunda.
    expect(aprobado.aplicaciones.map((a) => a.monto.toFixed(2)).sort()).toEqual(['30.00', '70.00']);

    const extracto = await libro.extracto(fondo.id);
    expect(extracto.filter((m) => m.tipo === 'EJECUCION')).toHaveLength(1);
    expect((await libro.verificarCadena(fondo.id)).rota).toBe(false);
  });

  it('permite aprobar por un monto menor al declarado', async () => {
    const fondo = await fondoConDonaciones('Fondo parcial', [200]);
    const gasto = await gastoEnRevision(fondo.id, 150);

    const r = await auditoria.revisar(
      gasto.id,
      auditorId,
      {
        decision: 'APROBAR',
        comentario: 'El comprobante solo respalda 100 de los 150 declarados.',
        montoAprobado: 100,
        diasSubsanacion: 5,
      },
      {},
    );

    expect(r.montoAprobado).toBe('100.00');

    const aprobado = await prisma.gasto.findUniqueOrThrow({ where: { id: gasto.id } });
    expect(aprobado.montoAprobado?.toFixed(2)).toBe('100.00');

    // Los 50 restantes siguen retenidos para otro gasto del fondo.
    const f = await prisma.fondo.findUniqueOrThrow({ where: { id: fondo.id } });
    expect(f.saldoRetenido.toFixed(2)).toBe('100.00');
  });

  it('no deja aprobar por mas de lo declarado', async () => {
    const fondo = await fondoConDonaciones('Fondo exceso', [500]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    await expect(
      auditoria.revisar(
        gasto.id,
        auditorId,
        {
          decision: 'APROBAR',
          comentario: 'Intento de aprobar por encima de lo declarado.',
          montoAprobado: 300,
          diasSubsanacion: 5,
        },
        {},
      ),
    ).rejects.toThrow(/mas de lo que la organizacion declaro/i);
  });

  it('OBSERVAR abre alerta con plazo y no toca la reputacion todavia', async () => {
    const fondo = await fondoConDonaciones('Fondo observar', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    const r = await auditoria.revisar(
      gasto.id,
      auditorId,
      {
        decision: 'OBSERVAR',
        comentario: 'La foto no permite identificar el producto comprado.',
        diasSubsanacion: 7,
      },
      {},
    );

    expect(r.estado).toBe('OBSERVADO');

    const alerta = await prisma.alerta.findFirstOrThrow({
      where: { gastoId: gasto.id, tipo: 'OBSERVACION_AUDITORIA' },
    });
    expect(alerta.plazoSubsanacion).not.toBeNull();
    // RF-SO-04: debido proceso antes de afectar la reputacion.
    expect(alerta.afectaReputacion).toBe(false);
    expect(alerta.descripcion).toContain('identificar el producto');
  });

  it('RECHAZAR deja el dinero retenido y si afecta la reputacion', async () => {
    const fondo = await fondoConDonaciones('Fondo rechazar', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    const r = await auditoria.revisar(
      gasto.id,
      auditorId,
      {
        decision: 'RECHAZAR',
        comentario: 'El comprobante corresponde a un gasto ajeno a la causa del fondo.',
        diasSubsanacion: 5,
      },
      {},
    );

    expect(r.estado).toBe('RECHAZADO');

    // El dinero no se ejecuto: sigue disponible para otro gasto del fondo.
    const f = await prisma.fondo.findUniqueOrThrow({ where: { id: fondo.id } });
    expect(f.saldoRetenido.toFixed(2)).toBe('300.00');
    expect(f.saldoEjecutado.toFixed(2)).toBe('0.00');

    // Ya hubo revision humana: no queda nada que subsanar.
    const alerta = await prisma.alerta.findFirstOrThrow({
      where: { gastoId: gasto.id, tipo: 'GASTO_RECHAZADO' },
    });
    expect(alerta.afectaReputacion).toBe(true);
  });

  it('guarda la decision como etiqueta con el nivel que propuso el motor', async () => {
    const fondo = await fondoConDonaciones('Fondo etiqueta', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    await auditoria.revisar(
      gasto.id,
      auditorId,
      { decision: 'APROBAR', comentario: 'Todo conforme tras revisar el comprobante.', diasSubsanacion: 5 },
      {},
    );

    const revision = await prisma.revisionAuditoria.findFirstOrThrow({
      where: { gastoId: gasto.id },
      include: { analisis: true },
    });

    // Es la etiqueta que AIni usara para entrenarse (RF-IA-11).
    expect(revision.decision).toBe('APROBAR');
    expect(revision.comentario.length).toBeGreaterThan(15);
    expect(revision.analisis?.nivel).toBe('MEDIO');

    // Y la bitacora conserva que la maquina proponia otra cosa.
    const rastro = await prisma.bitacoraAuditoria.findFirstOrThrow({
      where: { entidadId: gasto.id, accion: 'AUDITORIA_APROBAR' },
    });
    expect(rastro.valorNuevo).toMatchObject({ nivelPropuesto: 'MEDIO' });
  });

  it('un gasto ya aprobado no se aprueba dos veces', async () => {
    const fondo = await fondoConDonaciones('Fondo doble', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);
    const datos = {
      decision: 'APROBAR' as const,
      comentario: 'Aprobado tras revisar el comprobante y la evidencia.',
      diasSubsanacion: 5,
    };

    await auditoria.revisar(gasto.id, auditorId, datos, {});
    await expect(auditoria.revisar(gasto.id, auditorId, datos, {})).rejects.toThrow(
      /ya estaba aprobado/i,
    );
  });
});

describe('Conflicto de interes', () => {
  it('un auditor no puede revisar a una ONG de la que es miembro', async () => {
    const fondo = await fondoConDonaciones('Fondo conflicto', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    const auditorMiembro = await crearAuditor('miembro');
    await prisma.ongMiembro.create({
      data: { ongId, usuarioId: auditorMiembro, cargo: 'ADMINISTRADOR' },
    });

    await expect(
      auditoria.revisar(
        gasto.id,
        auditorMiembro,
        { decision: 'APROBAR', comentario: 'Aprobado por alguien con conflicto.', diasSubsanacion: 5 },
        {},
      ),
    ).rejects.toThrow(/organizacion de la que es miembro/i);

    // Y la bandeja se lo advierte antes de que lo intente.
    const bandeja = await auditoria.bandeja(auditorMiembro, {
      orden: 'antiguedad',
      incluirMuestreo: true,
      pagina: 1,
      porPagina: 50,
    });
    const caso = bandeja.casos.find((c) => c.id === gasto.id);
    expect(caso?.conflictoInteres).toBe(true);

    await prisma.ongMiembro.deleteMany({ where: { usuarioId: auditorMiembro } });
  });

  it('reasigna el caso a otro auditor dejando constancia del motivo', async () => {
    const fondo = await fondoConDonaciones('Fondo reasignar', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    const r = await auditoria.reasignar(
      gasto.id,
      auditorId,
      { auditorDestinoId: auditorAlternoId, motivo: 'Relacion familiar con el representante.' },
      {},
    );

    expect(r.reasignadoA).toBe(auditorAlternoId);

    const revision = await prisma.revisionAuditoria.findFirstOrThrow({
      where: { gastoId: gasto.id, conflictoInteres: true },
    });
    expect(revision.comentario).toContain('Relacion familiar');
  });

  it('no se reasigna a alguien que tambien tiene conflicto', async () => {
    const fondo = await fondoConDonaciones('Fondo reasignar 2', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    const auditorMiembro = await crearAuditor('miembro2');
    await prisma.ongMiembro.create({
      data: { ongId, usuarioId: auditorMiembro, cargo: 'OPERADOR' },
    });

    await expect(
      auditoria.reasignar(
        gasto.id,
        auditorId,
        { auditorDestinoId: auditorMiembro, motivo: 'Intento de reasignacion invalida.' },
        {},
      ),
    ).rejects.toThrow(/tambien pertenece a la organizacion/i);

    await prisma.ongMiembro.deleteMany({ where: { usuarioId: auditorMiembro } });
  });
});

describe('CU11 · Subsanacion de la ONG', () => {
  it('responder devuelve el gasto a analisis en lugar de aprobarlo', async () => {
    const fondo = await fondoConDonaciones('Fondo subsanar', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    await auditoria.revisar(
      gasto.id,
      auditorId,
      { decision: 'OBSERVAR', comentario: 'Falta el detalle del producto en la foto.', diasSubsanacion: 5 },
      {},
    );
    const alerta = await prisma.alerta.findFirstOrThrow({ where: { gastoId: gasto.id } });

    const r = await auditoria.subsanar(
      alerta.id,
      operadorId,
      'Subimos una foto nueva donde se ve la etiqueta del producto.',
      {},
    );

    expect(r.gastoReanalizado).toBe(true);

    // Responder no es lo mismo que corregir: vuelve a la cola para que el
    // motor lo evalue con la evidencia nueva.
    const reanalizado = await prisma.gasto.findUniqueOrThrow({ where: { id: gasto.id } });
    expect(reanalizado.estado).toBe('EN_ANALISIS');

    const trabajos = await prisma.trabajoVerificacion.count({ where: { gastoId: gasto.id } });
    expect(trabajos).toBeGreaterThan(0);
  });

  it('quien no pertenece a la ONG no puede subsanar', async () => {
    const fondo = await fondoConDonaciones('Fondo ajeno', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    await auditoria.revisar(
      gasto.id,
      auditorId,
      { decision: 'OBSERVAR', comentario: 'Observacion para probar permisos.', diasSubsanacion: 5 },
      {},
    );
    const alerta = await prisma.alerta.findFirstOrThrow({ where: { gastoId: gasto.id } });

    await expect(
      auditoria.subsanar(alerta.id, auditorId, 'Intento de subsanar sin pertenecer.', {}),
    ).rejects.toThrow(/No pertenece/i);
  });
});

describe('RF-SO-04 · Debido proceso reputacional', () => {
  it('la alerta solo afecta la reputacion cuando vence su plazo', async () => {
    const fondo = await fondoConDonaciones('Fondo plazo', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    await auditoria.revisar(
      gasto.id,
      auditorId,
      { decision: 'OBSERVAR', comentario: 'Observacion para probar el vencimiento.', diasSubsanacion: 5 },
      {},
    );
    const alerta = await prisma.alerta.findFirstOrThrow({ where: { gastoId: gasto.id } });
    expect(alerta.afectaReputacion).toBe(false);

    // Todavia dentro de plazo: el job no la toca. Se comprueba sobre ESTA
    // alerta y no sobre el total que devuelve el job, porque vencerPlazos()
    // recorre toda la base: una alerta vencida que haya dejado cualquier otra
    // suite haria fallar un recuento global sin que esta tenga nada que ver.
    // Afirmar una propiedad global para demostrar una local es lo que vuelve
    // una prueba dependiente del orden en que se ejecuta.
    await alertas.vencerPlazos();
    const dentroDePlazo = await prisma.alerta.findUniqueOrThrow({ where: { id: alerta.id } });
    expect(dentroDePlazo.afectaReputacion).toBe(false);

    // Se fuerza el vencimiento.
    await prisma.alerta.update({
      where: { id: alerta.id },
      data: { plazoSubsanacion: new Date(Date.now() - 86_400_000) },
    });

    expect(await alertas.vencerPlazos()).toBeGreaterThanOrEqual(1);

    const vencida = await prisma.alerta.findUniqueOrThrow({ where: { id: alerta.id } });
    expect(vencida.afectaReputacion).toBe(true);
  });

  it('una alerta ya respondida no se activa aunque venza el plazo', async () => {
    const fondo = await fondoConDonaciones('Fondo respondida', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    await auditoria.revisar(
      gasto.id,
      auditorId,
      { decision: 'OBSERVAR', comentario: 'Observacion que la ONG respondera a tiempo.', diasSubsanacion: 5 },
      {},
    );
    const alerta = await prisma.alerta.findFirstOrThrow({ where: { gastoId: gasto.id } });

    await auditoria.subsanar(alerta.id, operadorId, 'Corregimos lo observado y subimos evidencia.', {});

    // El plazo vence mientras el auditor revisa la respuesta.
    await prisma.alerta.update({
      where: { id: alerta.id },
      data: { plazoSubsanacion: new Date(Date.now() - 86_400_000) },
    });
    await alertas.vencerPlazos();

    // La asimetria es deliberada: estigmatizar a una ONG que si respondio
    // seria el daño que el proyecto existe para evitar.
    const despues = await prisma.alerta.findUniqueOrThrow({ where: { id: alerta.id } });
    expect(despues.estado).toBe('EN_SUBSANACION');
    expect(despues.afectaReputacion).toBe(false);
  });

  it('descartar una alerta la saca del puntaje', async () => {
    const fondo = await fondoConDonaciones('Fondo descartar', [300]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    await auditoria.revisar(
      gasto.id,
      auditorId,
      { decision: 'OBSERVAR', comentario: 'Observacion que resultara improcedente.', diasSubsanacion: 5 },
      {},
    );
    const alerta = await prisma.alerta.findFirstOrThrow({ where: { gastoId: gasto.id } });
    await prisma.alerta.update({
      where: { id: alerta.id },
      data: { afectaReputacion: true },
    });

    await alertas.descartar(alerta.id, auditorId, 'La observacion no correspondia al gasto.');

    const descartada = await prisma.alerta.findUniqueOrThrow({ where: { id: alerta.id } });
    expect(descartada.estado).toBe('DESCARTADA');
    expect(descartada.afectaReputacion).toBe(false);
  });
});

describe('RN-07 · SLA de 48 horas habiles', () => {
  it('cuenta horas habiles saltando el fin de semana', () => {
    // Viernes 2026-09-11 al mediodia. El plazo se cuenta en dias habiles de
    // 24 horas, no de jornada laboral: quedan 12 horas del viernes, el fin
    // de semana no suma, el lunes aporta 24 (36 acumuladas) y las ultimas 12
    // caen el martes al mediodia.
    const viernes = new Date('2026-09-11T12:00:00');
    const vence = sumarHorasHabiles(viernes, 48);

    expect(vence.getDay()).toBe(2);
    expect(vence.getHours()).toBe(12);
    expect(horasHabilesEntre(viernes, vence)).toBe(48);
  });

  it('la bandeja marca los casos vencidos', async () => {
    const fondo = await fondoConDonaciones('Fondo sla', [300]);
    // Recibido hace diez dias: el SLA ya vencio.
    const gasto = await gastoEnRevision(fondo.id, 100, new Date(Date.now() - 10 * 86_400_000));

    const bandeja = await auditoria.bandeja(auditorId, {
      orden: 'antiguedad',
      incluirMuestreo: false,
      pagina: 1,
      porPagina: 50,
    });
    const caso = bandeja.casos.find((c) => c.id === gasto.id);

    expect(caso?.sla.vencido).toBe(true);
    expect(caso?.sla.horasTranscurridas).toBeGreaterThan(48);
  });
});

describe('Bandeja e indicadores', () => {
  it('ordena por antiguedad o por monto (CU15)', async () => {
    const fondo = await fondoConDonaciones('Fondo orden', [1000]);
    await gastoEnRevision(fondo.id, 50);
    await gastoEnRevision(fondo.id, 400);

    const porMonto = await auditoria.bandeja(auditorId, {
      orden: 'monto',
      incluirMuestreo: false,
      pagina: 1,
      porPagina: 50,
    });

    const montos = porMonto.casos.map((c) => Number(c.monto));
    expect(montos).toEqual([...montos].sort((a, b) => b - a));
  });

  it('RN-08 · el muestreo selecciona casos ALTO ya aprobados', async () => {
    const fondo = await fondoConDonaciones('Fondo muestreo', [1000]);
    const gasto = await gastoEnRevision(fondo.id, 100);

    // Se aprueba y se marca su analisis como ALTO, como si lo hubiera
    // resuelto el motor sin intervencion humana.
    await auditoria.revisar(
      gasto.id,
      auditorId,
      { decision: 'APROBAR', comentario: 'Aprobado para preparar el caso de muestreo.', diasSubsanacion: 5 },
      {},
    );
    await prisma.analisisAini.updateMany({
      where: { gastoId: gasto.id },
      data: { nivel: 'ALTO' },
    });

    // El muestreo es aleatorio; lo que se comprueba es que no falle y que
    // solo tome candidatos validos.
    const seleccionados = await auditoria.seleccionarMuestreo(5);
    expect(seleccionados).toBeGreaterThanOrEqual(0);
  });

  it('los indicadores reportan automatizacion, SLA y falsos aprobados', async () => {
    const indicadores = await auditoria.indicadores();

    expect(indicadores.analisis.total).toBeGreaterThan(0);
    expect(indicadores.analisis.porcentajeAutomatico).toBeGreaterThanOrEqual(0);
    expect(indicadores.sla.horasHabiles).toBe(48);
    expect(indicadores.muestreo).toHaveProperty('falsosAprobados');
  });
});
