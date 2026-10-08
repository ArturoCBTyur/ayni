/**
 * Pruebas del Motor de Retorno (Fase 8).
 *
 * Aqui se cierra el ciclo de confianza, que es la tesis del proyecto. Lo
 * que se verifica: que cada donante reciba SU monto exacto y no un mensaje
 * generico, que ninguna narrativa pueda afirmar algo no verificado, que el
 * lenguaje de las plantillas resista una revision etica, y que reportar una
 * inconsistencia abra un caso real de auditoria.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { AplicacionFifoService } from '../contable/aplicacion-fifo.service';
import { LibroService } from '../contable/libro.service';
import { NarrativaService, normalizar, PLANTILLAS } from './narrativa.service';
import { RetornoService } from './retorno.service';
import { CifradoService } from '../../comun/cifrado/cifrado.service';
import { AlmacenamientoDisco } from '../gastos/almacenamiento/disco.storage';
import { ALMACENAMIENTO } from '../gastos/puertos/almacenamiento.port';
import { CampanasService } from '../campanas/campanas.service';

const marca = randomUUID().slice(0, 8);

let prisma: PrismaService;
let retorno: RetornoService;
let narrativa: NarrativaService;
let fifo: AplicacionFifoService;
let campanas: CampanasService;

const usuarios: string[] = [];
let ongId: string;
let campanaId: string;
let operadorId: string;

let contador = 12_000;

async function crearDonante(alias: string, frecuencia: 'CADA_GASTO' | 'MENSUAL' = 'CADA_GASTO') {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'DONANTE' } });
  const usuario = await prisma.usuario.create({
    data: {
      correo: `ret-${alias}-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: alias,
      apellidos: 'Donante',
      estado: 'ACTIVO',
      roles: { create: { rolId: rol.id } },
      donante: { create: { alias, frecuenciaNotificacion: frecuencia } },
      consentimientos: {
        create: [{ finalidad: 'TRATAMIENTO_DATOS', otorgado: true, versionPolitica: '1.0' }],
      },
    },
    include: { donante: true },
  });
  usuarios.push(usuario.id);
  return { usuarioId: usuario.id, donanteId: usuario.donante!.id };
}

/** Fondo con una donacion confirmada por cada donante indicado. */
async function fondoConDonantes(
  nombre: string,
  aportes: Array<{ donanteId: string; monto: number }>,
  categoriaGasto: 'ALIMENTOS' | 'ATENCION_VETERINARIA' | 'OTROS' = 'ALIMENTOS',
) {
  const fondo = await prisma.fondo.create({
    data: { campanaId, nombre: `${nombre} ${marca}`, categoriaGasto, meta: 100_000 },
  });

  for (const aporte of aportes) {
    const donacion = await prisma.donacion.create({
      data: {
        donanteId: aporte.donanteId,
        fondoId: fondo.id,
        monto: aporte.monto,
        montoNeto: aporte.monto,
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
          monto: aporte.monto,
          descripcion: `${tipo} sembrado`,
        },
      });
    }
  }
  return fondo;
}

/** Gasto aprobado y aplicado FIFO, listo para notificar. */
async function gastoAprobado(
  fondoId: string,
  monto: number,
  conPersonas = false,
  borrador: (numero: string) => string | null = () => null,
) {
  contador += 1;

  const gasto = await prisma.gasto.create({
    data: {
      fondoId,
      ongId,
      registradoPor: operadorId,
      montoDeclarado: monto,
      concepto: 'alimento balanceado para veinte perros rescatados',
      proveedorNombre: 'Agroveterinaria El Establo',
      fechaGasto: new Date('2026-09-10'),
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
          hashSha256: createHash('sha256').update(`ret-${marca}-${contador}`).digest('hex'),
        },
      },
      evidencias: {
        create: {
          tipo: 'FOTO',
          archivoUrl: `evidencias/${marca}-${contador}.jpg`,
          archivoMime: 'image/jpeg',
          archivoBytes: 2048,
          hashSha256: createHash('sha256').update(`ret-ev-${marca}-${contador}`).digest('hex'),
          hashPerceptual: randomBytes(8).toString('hex'),
          contienePersonas: conPersonas,
          // Con personas y sin difuminar todavia: no es publicable.
          anonimizada: !conPersonas,
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
      explicacion: { motivos: [], resumen: 'Aprobado para la prueba de retorno.' },
      narrativaBorrador: borrador(String(contador)),
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
      NarrativaService,
      RetornoService,
      CifradoService,
      AlmacenamientoDisco,
      { provide: ALMACENAMIENTO, useExisting: AlmacenamientoDisco },
      CampanasService,
    ],
  }).compile();

  prisma = modulo.get(PrismaService);
  retorno = modulo.get(RetornoService);
  narrativa = modulo.get(NarrativaService);
  fifo = modulo.get(AplicacionFifoService);
  campanas = modulo.get(CampanasService);
  await prisma.$connect();

  const ong = await prisma.ong.create({
    data: {
      ruc: `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`,
      razonSocial: `Asociacion Huellas ${marca}`,
      nombreComercial: `Huellas ${marca}`,
      representanteLegal: 'Representante de Prueba',
      documentoRepresentante: '00000000',
      direccion: 'Sin direccion',
      departamento: 'Huanuco',
      correoContacto: `ret-${marca}@prueba.pe`,
      descripcion: 'Organizacion creada por las pruebas del motor de retorno.',
      estadoVerificacion: 'VERIFICADA',
    },
  });
  ongId = ong.id;

  const campana = await prisma.campana.create({
    data: {
      ongId,
      titulo: `Rescate de invierno ${marca}`,
      slug: `retorno-${marca}`,
      descripcion: 'Campaña creada por las pruebas del motor de retorno.',
      causa: `Bienestar animal ${marca}`,
      fechaInicio: new Date('2026-01-01'),
      estado: 'ACTIVA',
    },
  });
  campanaId = campana.id;

  const rolOperador = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'ONG_OPERADOR' } });
  const operador = await prisma.usuario.create({
    data: {
      correo: `op-ret-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Operador',
      apellidos: 'Retorno',
      estado: 'ACTIVO',
      roles: { create: { rolId: rolOperador.id } },
      membresias: { create: { ongId, cargo: 'OPERADOR' } },
    },
  });
  operadorId = operador.id;
  usuarios.push(operador.id);

}, 60_000);

afterAll(async () => {
  await prisma.feedbackDonante.deleteMany({ where: { gasto: { ongId } } });
  await prisma.notificacion.deleteMany({ where: { gasto: { ongId } } });
  await prisma.alerta.deleteMany({ where: { ongId } });
  await prisma.analisisAini.deleteMany({ where: { gasto: { ongId } } });
  await prisma.revisionAuditoria.deleteMany({ where: { gasto: { ongId } } });
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
  await prisma.feedbackDonante.deleteMany({ where: { donante: { usuarioId: { in: usuarios } } } });
  await prisma.notificacion.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.consentimiento.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.donante.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.$disconnect();
});

describe('RNF-21 · La narrativa no puede afirmar lo no verificado', () => {
  it('rechaza una plantilla que referencia un dato inexistente', () => {
    const maliciosa = {
      codigo: 'prueba.maliciosa',
      version: '1.0',
      categoria: null,
      asunto: 'Prueba',
      cuerpo: 'Gracias <%= it.donante %>, salvaste <%= it.vidasSalvadas %> vidas.',
      verificacion: '',
    };

    // "vidasSalvadas" no es un dato que el sistema haya comprobado, asi que
    // la redaccion falla en vez de escribir una cifra inventada.
    expect(() =>
      narrativa.redactar(maliciosa, {
        donante: 'Rosa',
        monto: '40.00',
        concepto: 'alimento',
        proveedor: 'Proveedor',
        fecha: '10/09/2026',
        ong: 'Huellas',
        fondo: 'Alimentos',
        campana: 'Invierno',
      }),
    ).toThrow(/no es un dato verificado/i);
  });

  it('todas las plantillas de la biblioteca usan solo campos permitidos', () => {
    const permitidos = NarrativaService.camposPermitidos();

    for (const plantilla of PLANTILLAS) {
      // El cuerpo puede, ademas, colocar el parrafo de verificacion.
      const delCuerpo = [...plantilla.cuerpo.matchAll(/it\.(\w+)/g)].map((m) => m[1]);
      for (const referencia of delCuerpo) {
        expect([...permitidos, 'verificacion']).toContain(referencia);
      }
      const deLaVerificacion = [...plantilla.verificacion.matchAll(/it\.(\w+)/g)].map((m) => m[1]);
      for (const referencia of deLaVerificacion) {
        expect(permitidos).toContain(referencia);
      }
    }
  });
});

describe('RNF-21 · El borrador de AIni se revisa antes de llegar al donante', () => {
  const hechos = ['20601030579', 'B001', '004521', '118.00', 'Clinica Veterinaria San Roque'];
  const bueno =
    'La boleta B001-004521 de Clinica Veterinaria San Roque se leyó automáticamente: ' +
    'el RUC y el total de S/ 118.00 coinciden con lo declarado.';

  it('acepta un borrador que solo usa cifras del gasto', () => {
    expect(NarrativaService.revisarBorrador(bueno, hechos)).toEqual({ aceptado: true, motivos: [] });
  });

  it('rechaza una cifra que el gasto no respalda', () => {
    const r = NarrativaService.revisarBorrador(
      bueno.replace('118.00', '180.00') + ' Se atendió a 12 perros.',
      hechos,
    );
    expect(r.aceptado).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/180\.00, 12/);
  });

  it('rechaza el lenguaje sensacionalista igual que en una plantilla', () => {
    const r = NarrativaService.revisarBorrador(`${bueno} Fue un caso desgarrador.`, hechos);
    expect(r.aceptado).toBe(false);
    expect(r.motivos.join(' ')).toMatch(/desgarrador/);
  });

  it('rechaza marcado y enlaces', () => {
    for (const malo of [`${bueno} <script>x</script>`, `${bueno} Mira https://ejemplo.pe`]) {
      expect(NarrativaService.revisarBorrador(malo, hechos).aceptado).toBe(false);
    }
  });

  it('el donante recibe el borrador aceptado y queda registrado quien lo escribio', async () => {
    const eva = await crearDonante('Eva');
    const fondo = await fondoConDonantes('Fondo borrador', [
      { donanteId: eva.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(
      fondo.id,
      118,
      false,
      (numero) =>
        `La boleta B001-${numero} de Agroveterinaria El Establo se leyó automáticamente: ` +
        'el total de S/ 118.00 coincide con lo declarado.',
    );

    await retorno.notificarImpacto(gasto.id);

    const n = await prisma.notificacion.findFirstOrThrow({
      where: { usuarioId: eva.usuarioId, gastoId: gasto.id },
    });
    expect(n.cuerpo).toContain('se leyó automáticamente');
    // El texto generico se mantiene: el borrador lo detalla, no lo reemplaza.
    expect(n.cuerpo).toContain('respaldó el gasto con su comprobante');
    // Y el monto propio del donante sigue viniendo de la plantilla.
    expect(n.cuerpo).toContain('S/ 118.00 de tu donación');
    expect(n.plantilla).toBe('impacto.alimentos@1.0+aini');
  });

  it('un borrador con una cifra inventada se descarta y sale la plantilla sola', async () => {
    const leo = await crearDonante('Leo');
    const fondo = await fondoConDonantes('Fondo borrador malo', [
      { donanteId: leo.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(
      fondo.id,
      100,
      false,
      () => 'Gracias a este gasto se alimentaron 40 perros durante 3 semanas.',
    );

    await retorno.notificarImpacto(gasto.id);

    const n = await prisma.notificacion.findFirstOrThrow({
      where: { usuarioId: leo.usuarioId, gastoId: gasto.id },
    });
    expect(n.cuerpo).not.toContain('40 perros');
    expect(n.plantilla).toBe('impacto.alimentos@1.0');

    const bitacora = await prisma.bitacoraAuditoria.findFirstOrThrow({
      where: { accion: 'RETORNO_NOTIFICADO', entidadId: gasto.id },
    });
    expect(bitacora.valorNuevo).toMatchObject({ borrador: 'rechazado' });
  });
});

describe('RF-CO-02 · Revision de lenguaje etico', () => {
  it('ninguna plantilla publicada usa lenguaje sensacionalista', () => {
    // Esta prueba es la "revision de lenguaje etico antes de publicarse" que
    // exige RNF-21: una plantilla con lenguaje que revictimiza no pasa.
    for (const plantilla of PLANTILLAS) {
      expect(NarrativaService.revisarLenguaje(plantilla)).toEqual([]);
    }
  });

  it('la revision detecta las palabras prohibidas pese a la flexion', () => {
    const mala = {
      codigo: 'prueba.mala',
      version: '1.0',
      categoria: null,
      // "desgarradora" en femenino: una busqueda literal de "desgarrador"
      // no la encontraria, y es justo la forma que se usa en la practica.
      asunto: 'Una historia desgarradora',
      cuerpo: 'Gracias a ti, este pobrecito animal moribundo encontro un heroe.',
      verificacion: '',
    };

    const hallazgos = NarrativaService.revisarLenguaje(mala);
    expect(hallazgos).toContain('desgarrador');
    expect(hallazgos).toContain('pobrecito');
    expect(hallazgos).toContain('moribundo');
    expect(hallazgos).toContain('heroe');
  });

  it('la revision no se deja engañar por los acentos', () => {
    const conTildes = {
      codigo: 'prueba.tildes',
      version: '1.0',
      categoria: null,
      asunto: 'Un héroe anónimo',
      cuerpo: 'Esta víctima de la miseria vivió una tragedia.',
      verificacion: '',
    };

    // Sin normalizar acentos, ninguna de estas se detectaria y el filtro
    // etico seria decorativo.
    const hallazgos = NarrativaService.revisarLenguaje(conTildes);
    expect(hallazgos).toEqual(expect.arrayContaining(['heroe', 'victima', 'miseria', 'tragedia']));
  });

  it('elige la plantilla mas especifica y cae a la general si no hay', () => {
    expect(narrativa.elegirPlantilla('ALIMENTOS').codigo).toBe('impacto.alimentos');
    expect(narrativa.elegirPlantilla('ATENCION_VETERINARIA').codigo).toBe('impacto.veterinaria');
    expect(narrativa.elegirPlantilla('TRANSPORTE').codigo).toBe('impacto.general');
  });
});

describe('CU06 · Una narrativa por donante con su monto exacto', () => {
  it('cada donante recibe el monto que financio, no el total del gasto', async () => {
    const rosa = await crearDonante('Rosa');
    const luis = await crearDonante('Luis');

    const fondo = await fondoConDonantes('Fondo compartido', [
      { donanteId: rosa.donanteId, monto: 60 },
      { donanteId: luis.donanteId, monto: 90 },
    ]);
    const gasto = await gastoAprobado(fondo.id, 100);

    const r = await retorno.notificarImpacto(gasto.id);
    expect(r.notificaciones).toBe(2);

    const deRosa = await prisma.notificacion.findFirstOrThrow({
      where: { usuarioId: rosa.usuarioId, gastoId: gasto.id },
    });
    const deLuis = await prisma.notificacion.findFirstOrThrow({
      where: { usuarioId: luis.usuarioId, gastoId: gasto.id },
    });

    // FIFO: Rosa aporto primero, asi que sus 60 se consumen enteros y Luis
    // pone los 40 restantes. Cada uno ve SU cifra.
    expect(deRosa.montoAplicado?.toFixed(2)).toBe('60.00');
    expect(deLuis.montoAplicado?.toFixed(2)).toBe('40.00');
    expect(deRosa.cuerpo).toContain('S/ 60.00');
    expect(deLuis.cuerpo).toContain('S/ 40.00');
    // El valor del mensaje esta en que sea suyo, no generico.
    expect(deRosa.cuerpo).toContain('Rosa');
    expect(deLuis.cuerpo).toContain('Luis');
  });

  it('la narrativa nombra el concepto, el proveedor y la organizacion reales', async () => {
    const ana = await crearDonante('Ana');
    const fondo = await fondoConDonantes('Fondo narrativa', [
      { donanteId: ana.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(fondo.id, 150);

    await retorno.notificarImpacto(gasto.id);

    const n = await prisma.notificacion.findFirstOrThrow({
      where: { usuarioId: ana.usuarioId, gastoId: gasto.id },
    });

    expect(n.cuerpo).toContain('alimento balanceado');
    expect(n.cuerpo).toContain('Agroveterinaria El Establo');
    expect(n.cuerpo).toContain(`Huellas ${marca}`);
    expect(n.plantilla).toBe('impacto.alimentos@1.0');
  });

  it('usa la plantilla de la categoria del fondo', async () => {
    const beto = await crearDonante('Beto');
    const fondo = await fondoConDonantes(
      'Fondo veterinaria',
      [{ donanteId: beto.donanteId, monto: 200 }],
      'ATENCION_VETERINARIA',
    );
    const gasto = await gastoAprobado(fondo.id, 100);

    await retorno.notificarImpacto(gasto.id);

    const n = await prisma.notificacion.findFirstOrThrow({
      where: { usuarioId: beto.usuarioId, gastoId: gasto.id },
    });
    expect(n.plantilla).toBe('impacto.veterinaria@1.0');
    // Se compara sin tildes: el asunto lleva acentos, como debe ser.
    expect(normalizar(n.asunto)).toContain('atencion veterinaria');
  });

  it('no notifica dos veces la misma aplicacion', async () => {
    const carla = await crearDonante('Carla');
    const fondo = await fondoConDonantes('Fondo idempotente', [
      { donanteId: carla.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(fondo.id, 100);

    const primera = await retorno.notificarImpacto(gasto.id);
    const segunda = await retorno.notificarImpacto(gasto.id);

    expect(primera.notificaciones).toBe(1);
    expect(segunda.notificaciones).toBe(0);
    expect(segunda.omitidas[0].motivo).toBe('ya notificado');
  });

  it('RF-PS-04 · quien pidio resumen mensual no recibe aviso inmediato', async () => {
    const diego = await crearDonante('Diego', 'MENSUAL');
    const fondo = await fondoConDonantes('Fondo mensual', [
      { donanteId: diego.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(fondo.id, 100);

    await retorno.notificarImpacto(gasto.id);

    const n = await prisma.notificacion.findFirstOrThrow({
      where: { usuarioId: diego.usuarioId, gastoId: gasto.id },
    });

    // La notificacion existe y esta en su historial, pero no se le envio:
    // respetar la frecuencia elegida evita la fatiga de notificaciones.
    expect(n.estado).toBe('PENDIENTE');
    expect(n.enviadaEn).toBeNull();
  });

  it('solo se notifica un gasto aprobado', async () => {
    const elsa = await crearDonante('Elsa');
    const fondo = await fondoConDonantes('Fondo sin aprobar', [
      { donanteId: elsa.donanteId, monto: 200 },
    ]);

    contador += 1;
    const gasto = await prisma.gasto.create({
      data: {
        fondoId: fondo.id,
        ongId,
        registradoPor: operadorId,
        montoDeclarado: 50,
        concepto: 'compra pendiente de verificacion',
        proveedorNombre: 'Proveedor',
        fechaGasto: new Date('2026-09-10'),
        estado: 'EN_ANALISIS',
      },
    });

    await expect(retorno.notificarImpacto(gasto.id)).rejects.toThrow(/aprobado y verificado/i);
  });
});

describe('RNF-06 · La evidencia adjunta siempre esta anonimizada', () => {
  it('no adjunta una evidencia con personas sin difuminar', async () => {
    const fabio = await crearDonante('Fabio');
    const fondo = await fondoConDonantes('Fondo con personas', [
      { donanteId: fabio.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(fondo.id, 100, true);

    const r = await retorno.notificarImpacto(gasto.id);
    expect(r.notificaciones).toBe(1);

    const n = await prisma.notificacion.findFirstOrThrow({
      where: { usuarioId: fabio.usuarioId, gastoId: gasto.id },
    });

    // La narrativa llega igual; lo que no llega es la foto sin anonimizar.
    // Retrasar el aviso seria peor que enviarlo sin imagen.
    expect(n.evidenciaId).toBeNull();
    expect(n.cuerpo.length).toBeGreaterThan(50);
  });
});

describe('CU07 · Control social del donante (RF-SO-02)', () => {
  it('reportar una inconsistencia abre un caso real y devuelve el gasto a revision', async () => {
    const gabi = await crearDonante('Gabi');
    const fondo = await fondoConDonantes('Fondo reporte', [
      { donanteId: gabi.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(fondo.id, 100);
    await retorno.notificarImpacto(gasto.id);

    const r = await retorno.registrarFeedback(
      gabi.usuarioId,
      {
        gastoId: gasto.id,
        comentario: 'La foto parece de otra campaña; el local no coincide con el proveedor.',
        reportaInconsistencia: true,
      },
      {},
    );

    expect(r.alertaGenerada).not.toBeNull();

    const alerta = await prisma.alerta.findUniqueOrThrow({ where: { id: r.alertaGenerada! } });
    expect(alerta.tipo).toBe('REPORTE_DONANTE');
    // Un reporte no comprobado no mancha a la ONG hasta que se revise.
    expect(alerta.afectaReputacion).toBe(false);

    // Lo reporto una persona, asi que lo resuelve una persona.
    const enRevision = await prisma.gasto.findUniqueOrThrow({ where: { id: gasto.id } });
    expect(enRevision.estado).toBe('EN_REVISION');
  });

  it('exige describir que se observo al reportar', async () => {
    const hugo = await crearDonante('Hugo');
    const fondo = await fondoConDonantes('Fondo sin motivo', [
      { donanteId: hugo.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(fondo.id, 100);

    await expect(
      retorno.registrarFeedback(
        hugo.usuarioId,
        { gastoId: gasto.id, reportaInconsistencia: true },
        {},
      ),
    ).rejects.toThrow(/describa que observo/i);
  });

  it('una valoracion sin reporte no abre ningun caso', async () => {
    const irene = await crearDonante('Irene');
    const fondo = await fondoConDonantes('Fondo valoracion', [
      { donanteId: irene.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(fondo.id, 100);

    const r = await retorno.registrarFeedback(
      irene.usuarioId,
      { gastoId: gasto.id, valoracion: 5, comentario: 'Muy claro, gracias.', reportaInconsistencia: false },
      {},
    );

    expect(r.alertaGenerada).toBeNull();

    const sinCambios = await prisma.gasto.findUniqueOrThrow({ where: { id: gasto.id } });
    expect(sinCambios.estado).toBe('APROBADO');
  });
});

describe('La evidencia a la vista del donante y del publico', () => {
  it('la bandeja trae la URL firmada de la foto publicable', async () => {
    const mara = await crearDonante('Mara');
    const fondo = await fondoConDonantes('Fondo con foto', [
      { donanteId: mara.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(fondo.id, 100);
    await retorno.notificarImpacto(gasto.id);

    const [n] = await retorno.bandeja(mara.usuarioId);
    expect(n.evidencia?.anonimizada).toBe(true);
    expect(n.evidencia?.url).toContain(`almacenamiento/evidencias/${marca}-`);
    expect(n.evidencia?.url).toContain('token=');
  });

  it('la ficha publica muestra en que se gasto, sin entregar nunca una foto sin difuminar', async () => {
    const nora = await crearDonante('Nora');
    const fondo = await fondoConDonantes('Fondo publico', [
      { donanteId: nora.donanteId, monto: 300 },
    ]);
    const sinPersonas = await gastoAprobado(fondo.id, 60);
    const conPersonas = await gastoAprobado(fondo.id, 40, true);

    const ficha = await campanas.detalleCampana(`retorno-${marca}`);
    const verificados = ficha.fondos.find((f) => f.id === fondo.id)!.gastosVerificados;

    expect(verificados.map((g) => g.id).sort()).toEqual([sinPersonas.id, conPersonas.id].sort());

    const publicable = verificados.find((g) => g.id === sinPersonas.id)!;
    expect(publicable.monto).toBe('60.00');
    expect(publicable.comprobante).toMatch(/^BOLETA B001-/);
    expect(publicable.evidencias).toHaveLength(1);

    // La foto con personas existe, pero sin difuminar no se publica.
    expect(verificados.find((g) => g.id === conPersonas.id)!.evidencias).toEqual([]);
  });

  it('un gasto que no esta aprobado no aparece en la ficha', async () => {
    const fondo = await fondoConDonantes('Fondo sin aprobar', []);
    await prisma.gasto.create({
      data: {
        fondoId: fondo.id,
        ongId,
        registradoPor: operadorId,
        montoDeclarado: 30,
        concepto: 'gasto todavia en analisis',
        proveedorNombre: 'Proveedor',
        fechaGasto: new Date('2026-09-10'),
        estado: 'EN_REVISION',
      },
    });

    const ficha = await campanas.detalleCampana(`retorno-${marca}`);
    expect(ficha.fondos.find((f) => f.id === fondo.id)!.gastosVerificados).toEqual([]);
  });
});

describe('Bandeja y recomendaciones', () => {
  it('la bandeja muestra la narrativa y permite marcarla leida', async () => {
    const julia = await crearDonante('Julia');
    const fondo = await fondoConDonantes('Fondo bandeja', [
      { donanteId: julia.donanteId, monto: 200 },
    ]);
    const gasto = await gastoAprobado(fondo.id, 100);
    await retorno.notificarImpacto(gasto.id);

    const bandeja = await retorno.bandeja(julia.usuarioId);
    expect(bandeja).toHaveLength(1);
    expect(bandeja[0].montoAplicado).toBe('100.00');
    expect(bandeja[0].leida).toBe(false);

    await retorno.marcarLeida(bandeja[0].id, julia.usuarioId);
    const despues = await retorno.bandeja(julia.usuarioId, true);
    expect(despues).toHaveLength(0);
  });

  it('nadie marca como leida la notificacion de otra persona', async () => {
    const kim = await crearDonante('Kim');
    const leo = await crearDonante('Leo');
    const fondo = await fondoConDonantes('Fondo ajeno', [{ donanteId: kim.donanteId, monto: 200 }]);
    const gasto = await gastoAprobado(fondo.id, 100);
    await retorno.notificarImpacto(gasto.id);

    const bandeja = await retorno.bandeja(kim.usuarioId);
    const r = await retorno.marcarLeida(bandeja[0].id, leo.usuarioId);

    expect(r.actualizada).toBe(false);
  });

  it('RF-IA-10 · recomienda fondos afines explicando por que', async () => {
    const mara = await crearDonante('Mara');
    const fondoApoyado = await fondoConDonantes('Fondo apoyado', [
      { donanteId: mara.donanteId, monto: 100 },
    ]);
    // Otro fondo de la misma causa al que aun no aporta.
    await prisma.fondo.create({
      data: {
        campanaId,
        nombre: `Fondo sugerible ${marca}`,
        categoriaGasto: 'ALIMENTOS',
        meta: 5000,
      },
    });

    const recomendaciones = await retorno.recomendarFondos(mara.usuarioId);

    expect(recomendaciones.length).toBeGreaterThan(0);
    // No se recomienda lo que ya apoya.
    expect(recomendaciones.map((r) => r.id)).not.toContain(fondoApoyado.id);
    // Una sugerencia sin motivo se parece demasiado a publicidad.
    expect(recomendaciones[0].motivo.length).toBeGreaterThan(10);
  });

  it('sin historial no recomienda nada', async () => {
    const nuevo = await crearDonante('Nuevo');
    expect(await retorno.recomendarFondos(nuevo.usuarioId)).toEqual([]);
  });
});
