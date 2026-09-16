/**
 * Pruebas de Donaciones y Pagos y del Core Contable (Fase 4).
 *
 * Aqui entra el dinero, asi que las pruebas se concentran en lo que no puede
 * fallar: que el libro cuadre, que un webhook repetido no duplique asientos,
 * que un cobro rechazado no acredite nada, y que el donante vea su aporte
 * como "retenido" mientras no haya evidencia.
 */
import { ConfigModule, ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { LibroService } from '../contable/libro.service';
import { DonacionesService } from './donaciones.service';
import type { EventoWebhookEntrada } from './esquemas';
import { FakeGateway } from './pasarelas/fake.gateway';
import { PASARELA_PAGO } from './puertos/pasarela-pago.port';

const marca = randomUUID().slice(0, 8);

let prisma: PrismaService;
let donaciones: DonacionesService;
let libro: LibroService;
let pasarela: FakeGateway;

const usuarios: string[] = [];
let ongId: string;
let campanaId: string;
let fondoId: string;
let donanteUsuarioId: string;

async function crearUsuarioDonante() {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'DONANTE' } });
  const usuario = await prisma.usuario.create({
    data: {
      correo: `don-${marca}-${usuarios.length}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Donante',
      apellidos: 'De Prueba',
      estado: 'ACTIVO',
      roles: { create: { rolId: rol.id } },
      donante: { create: {} },
      consentimientos: {
        create: [{ finalidad: 'TRATAMIENTO_DATOS', otorgado: true, versionPolitica: '1.0' }],
      },
    },
  });
  usuarios.push(usuario.id);
  return usuario;
}

/** Construye el evento que la pasarela entregaria para un cobro dado. */
function eventoPara(
  referenciaExterna: string,
  referenciaInterna: string,
  opciones: { monto: number; comision: number; rechazado?: boolean; eventoId?: string },
): EventoWebhookEntrada {
  return {
    eventoId: opciones.eventoId ?? `evt_${randomUUID()}`,
    tipo: opciones.rechazado ? 'cargo.rechazado' : 'cargo.aprobado',
    referenciaExterna,
    referenciaInterna,
    monto: opciones.monto,
    comision: opciones.comision,
    metodo: 'tarjeta',
    ultimos4: '4242',
    marca: 'Visa',
    motivoRechazo: opciones.rechazado ? 'Fondos insuficientes en la tarjeta.' : undefined,
    creadoEn: new Date().toISOString(),
  };
}

/** Dona y confirma el cobro, devolviendo la donacion ya acreditada. */
async function donarYConfirmar(usuarioId: string, monto: number, fondo = fondoId) {
  const r = await donaciones.donar(
    usuarioId,
    { fondoId: fondo, monto, tokenTarjeta: 'tok_ok_4242', anonima: false },
    {},
  );
  const pago = await prisma.pago.findUniqueOrThrow({
    where: { referenciaExterna: r.referenciaExterna },
  });
  await donaciones.procesarWebhook(
    eventoPara(r.referenciaExterna, r.donacionId, {
      monto,
      comision: Number(pago.comision),
    }),
  );
  return { ...r, comision: Number(pago.comision) };
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [
      PrismaService,
      BitacoraService,
      LibroService,
      DonacionesService,
      FakeGateway,
      { provide: PASARELA_PAGO, useExisting: FakeGateway },
    ],
  }).compile();

  prisma = modulo.get(PrismaService);
  donaciones = modulo.get(DonacionesService);
  libro = modulo.get(LibroService);
  pasarela = modulo.get(FakeGateway);
  modulo.get(ConfigService);
  await prisma.$connect();

  const ong = await prisma.ong.create({
    data: {
      ruc: `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`,
      razonSocial: `ONG de pruebas de donaciones ${marca}`,
      representanteLegal: 'Representante de Prueba',
      documentoRepresentante: '00000000',
      direccion: 'Sin direccion',
      departamento: 'Huanuco',
      correoContacto: `donaciones-${marca}@prueba.pe`,
      descripcion: 'Organizacion creada por las pruebas de donaciones.',
      estadoVerificacion: 'VERIFICADA',
    },
  });
  ongId = ong.id;

  const campana = await prisma.campana.create({
    data: {
      ongId,
      titulo: `Campaña de donaciones ${marca}`,
      slug: `donaciones-${marca}`,
      descripcion: 'Campaña creada por las pruebas del modulo de donaciones.',
      causa: `Pruebas ${marca}`,
      fechaInicio: new Date('2026-01-01'),
      estado: 'ACTIVA',
    },
  });
  campanaId = campana.id;

  const fondo = await prisma.fondo.create({
    data: { campanaId, nombre: `Fondo principal ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 50_000 },
  });
  fondoId = fondo.id;

  donanteUsuarioId = (await crearUsuarioDonante()).id;
}, 30_000);

afterAll(async () => {
  await prisma.$executeRaw`ALTER TABLE movimientos_contables DISABLE TRIGGER tg_movimientos_no_delete`;
  try {
    await prisma.$executeRaw`
      DELETE FROM movimientos_contables
       WHERE fondo_id IN (SELECT id FROM fondos WHERE campana_id = ${campanaId}::uuid)
    `;
  } finally {
    await prisma.$executeRaw`ALTER TABLE movimientos_contables ENABLE TRIGGER tg_movimientos_no_delete`;
  }

  await prisma.pago.deleteMany({ where: { donacion: { fondo: { campanaId } } } });
  await prisma.suscripcion.deleteMany({ where: { ongId } });
  await prisma.donacion.deleteMany({ where: { fondo: { campanaId } } });
  await prisma.fondo.deleteMany({ where: { campanaId } });
  await prisma.campana.delete({ where: { id: campanaId } });
  await prisma.ong.delete({ where: { id: ongId } });
  await prisma.bitacoraAuditoria.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.consentimiento.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.donante.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.$disconnect();
});

describe('Pasarela simulada', () => {
  it('cobra siempre en PENDIENTE: la confirmacion llega por webhook', async () => {
    // Si la respuesta del cobro confirmara el pago, cambiar a Culqi despues
    // obligaria a reescribir el flujo entero.
    const r = await pasarela.cobrar({
      referenciaInterna: randomUUID(),
      monto: 100,
      moneda: 'PEN',
      descripcion: 'Prueba',
      tokenTarjeta: 'tok_ok_4242',
      correoPagador: 'prueba@prueba.pe',
    });

    expect(r.estado).toBe('PENDIENTE');
    expect(r.referenciaExterna).toMatch(/^fk_/);
  });

  it('cobra comision como porcentaje mas monto fijo', async () => {
    const r = await pasarela.cobrar({
      referenciaInterna: randomUUID(),
      monto: 100,
      moneda: 'PEN',
      descripcion: 'Prueba',
      tokenTarjeta: 'tok_ok_4242',
      correoPagador: 'prueba@prueba.pe',
    });

    // 3.44 % de 100 + 1.00 = 4.44
    expect(r.comision).toBe(4.44);
    expect(r.montoNeto).toBe(95.56);
  });

  it('verifica la firma del webhook y rechaza la alterada', () => {
    const cuerpo = JSON.stringify({ eventoId: 'evt_1', monto: 100 });
    const firma = pasarela.firmar(cuerpo);

    expect(pasarela.verificarFirma(cuerpo, firma)).toBe(true);
    expect(pasarela.verificarFirma(cuerpo, undefined)).toBe(false);
    expect(pasarela.verificarFirma(cuerpo, 'firma-inventada')).toBe(false);
    // Un centimo de diferencia en el cuerpo invalida la firma.
    expect(pasarela.verificarFirma(JSON.stringify({ eventoId: 'evt_1', monto: 101 }), firma)).toBe(
      false,
    );
  });
});

describe('CU03 · Donar a un fondo especifico', () => {
  it('la donacion nace pendiente y no toca el libro todavia', async () => {
    const usuario = await crearUsuarioDonante();
    const antes = await prisma.movimientoContable.count({ where: { fondoId } });

    const r = await donaciones.donar(
      usuario.id,
      { fondoId, monto: 100, tokenTarjeta: 'tok_ok_4242', anonima: false },
      {},
    );

    expect(r.estado).toBe('PENDIENTE');
    // Asentar un ingreso que despues resulte rechazado obligaria a
    // revertirlo, y el libro es de solo insercion.
    expect(await prisma.movimientoContable.count({ where: { fondoId } })).toBe(antes);
  });

  it('el webhook aprobado asienta INGRESO, COMISION y RETENCION', async () => {
    const usuario = await crearUsuarioDonante();
    const fondoPropio = await prisma.fondo.create({
      data: { campanaId, nombre: `Fondo asientos ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 10_000 },
    });

    await donarYConfirmar(usuario.id, 100, fondoPropio.id);

    const extracto = await libro.extracto(fondoPropio.id);
    expect(extracto.map((m) => m.tipo)).toEqual(['INGRESO', 'COMISION', 'RETENCION']);
    expect(extracto[0].monto).toBe('100.00');
    expect(extracto[1].monto).toBe('4.44');
    expect(extracto[2].monto).toBe('95.56');

    // Y la cadena de hashes queda intacta.
    const cadena = await libro.verificarCadena(fondoPropio.id);
    expect(cadena.rota).toBe(false);
    expect(cadena.movimientos).toBe(3);
  });

  it('los saldos del fondo reflejan el neto retenido', async () => {
    const usuario = await crearUsuarioDonante();
    const fondoPropio = await prisma.fondo.create({
      data: { campanaId, nombre: `Fondo saldos ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 10_000 },
    });

    await donarYConfirmar(usuario.id, 200, fondoPropio.id);

    const f = await prisma.fondo.findUniqueOrThrow({ where: { id: fondoPropio.id } });
    // 200 bruto - 7.88 de comision = 192.12 disponible y retenido.
    expect(f.saldoRecaudado.toFixed(2)).toBe('192.12');
    expect(f.saldoRetenido.toFixed(2)).toBe('192.12');
    expect(f.saldoEjecutado.toFixed(2)).toBe('0.00');
  });

  it('RN-02 · la comision queda como movimiento separado y visible', async () => {
    const usuario = await crearUsuarioDonante();
    const fondoPropio = await prisma.fondo.create({
      data: { campanaId, nombre: `Fondo comision ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 10_000 },
    });

    const r = await donarYConfirmar(usuario.id, 100, fondoPropio.id);

    const historial = await donaciones.historial(usuario.id);
    const donacion = historial.donaciones.find((d) => d.id === r.donacionId);

    // El donante ve cuanto se llevo la pasarela, no solo un neto mezclado.
    expect(donacion?.comision).toBe('4.44');
    expect(donacion?.monto).toBe('100.00');
    expect(donacion?.montoNeto).toBe('95.56');
  });

  it('un cobro rechazado no acredita nada', async () => {
    const usuario = await crearUsuarioDonante();
    const fondoPropio = await prisma.fondo.create({
      data: { campanaId, nombre: `Fondo rechazo ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 10_000 },
    });

    const r = await donaciones.donar(
      usuario.id,
      { fondoId: fondoPropio.id, monto: 150, tokenTarjeta: 'tok_rechazo_0000', anonima: false },
      {},
    );

    await donaciones.procesarWebhook(
      eventoPara(r.referenciaExterna, r.donacionId, { monto: 150, comision: 6.16, rechazado: true }),
    );

    const donacion = await prisma.donacion.findUniqueOrThrow({ where: { id: r.donacionId } });
    expect(donacion.estado).toBe('FALLIDA');
    expect(await prisma.movimientoContable.count({ where: { fondoId: fondoPropio.id } })).toBe(0);

    const f = await prisma.fondo.findUniqueOrThrow({ where: { id: fondoPropio.id } });
    expect(f.saldoRecaudado.toFixed(2)).toBe('0.00');
  });

  it('rechaza donar a un fondo de una ONG sin verificar', async () => {
    const usuario = await crearUsuarioDonante();
    const ongSinVerificar = await prisma.ong.create({
      data: {
        ruc: `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`,
        razonSocial: `ONG sin verificar ${marca}`,
        representanteLegal: 'X',
        documentoRepresentante: '00000000',
        direccion: 'Sin direccion',
        departamento: 'Huanuco',
        correoContacto: `sinver-${marca}@prueba.pe`,
        descripcion: 'Organizacion sin verificar.',
        estadoVerificacion: 'PENDIENTE',
      },
    });
    const c = await prisma.campana.create({
      data: {
        ongId: ongSinVerificar.id,
        titulo: `Campaña sin verificar ${marca}`,
        slug: `sin-verificar-${marca}`,
        descripcion: 'Campaña de una ONG sin verificar.',
        causa: 'Prueba',
        fechaInicio: new Date('2026-01-01'),
        estado: 'ACTIVA',
      },
    });
    const f = await prisma.fondo.create({
      data: { campanaId: c.id, nombre: 'Fondo', categoriaGasto: 'ALIMENTOS', meta: 1000 },
    });

    await expect(
      donaciones.donar(
        usuario.id,
        { fondoId: f.id, monto: 50, tokenTarjeta: 'tok_ok_4242', anonima: false },
        {},
      ),
    ).rejects.toThrow(/no esta verificada/i);

    await prisma.fondo.delete({ where: { id: f.id } });
    await prisma.campana.delete({ where: { id: c.id } });
    await prisma.ong.delete({ where: { id: ongSinVerificar.id } });
  });
});

describe('Idempotencia del webhook', () => {
  it('el mismo evento repetido no duplica asientos', async () => {
    const usuario = await crearUsuarioDonante();
    const fondoPropio = await prisma.fondo.create({
      data: { campanaId, nombre: `Fondo idempotente ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 10_000 },
    });

    const r = await donaciones.donar(
      usuario.id,
      { fondoId: fondoPropio.id, monto: 100, tokenTarjeta: 'tok_ok_4242', anonima: false },
      {},
    );
    const evento = eventoPara(r.referenciaExterna, r.donacionId, { monto: 100, comision: 4.44 });

    const primera = await donaciones.procesarWebhook(evento);
    const segunda = await donaciones.procesarWebhook(evento);
    const tercera = await donaciones.procesarWebhook(evento);

    expect(primera.procesado).toBe(true);
    expect(segunda.procesado).toBe(false);
    expect(tercera.procesado).toBe(false);

    // Las pasarelas reintentan; tres entregas no pueden triplicar el dinero.
    expect(await prisma.movimientoContable.count({ where: { fondoId: fondoPropio.id } })).toBe(3);
    const f = await prisma.fondo.findUniqueOrThrow({ where: { id: fondoPropio.id } });
    expect(f.saldoRetenido.toFixed(2)).toBe('95.56');
  });

  it('un evento distinto sobre un pago ya resuelto tampoco vuelve a aplicar', async () => {
    const usuario = await crearUsuarioDonante();
    const fondoPropio = await prisma.fondo.create({
      data: { campanaId, nombre: `Fondo reintento ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 10_000 },
    });

    const r = await donaciones.donar(
      usuario.id,
      { fondoId: fondoPropio.id, monto: 100, tokenTarjeta: 'tok_ok_4242', anonima: false },
      {},
    );

    await donaciones.procesarWebhook(
      eventoPara(r.referenciaExterna, r.donacionId, { monto: 100, comision: 4.44 }),
    );
    const repetido = await donaciones.procesarWebhook(
      eventoPara(r.referenciaExterna, r.donacionId, { monto: 100, comision: 4.44 }),
    );

    expect(repetido.procesado).toBe(false);
    expect(repetido.motivo).toMatch(/ya estaba en estado APROBADO/i);
    expect(await prisma.movimientoContable.count({ where: { fondoId: fondoPropio.id } })).toBe(3);
  });

  it('un webhook de un cargo desconocido se ignora sin romper', async () => {
    const r = await donaciones.procesarWebhook(
      eventoPara('fk_inexistente', randomUUID(), { monto: 10, comision: 1 }),
    );

    // Se responde sin error a proposito: un 404 haria que la pasarela
    // reintente para siempre un cargo que no nos pertenece.
    expect(r.procesado).toBe(false);
    expect(r.motivo).toMatch(/desconocida/i);
  });
});

describe('RF-PS-01 · Linea de tiempo del aporte', () => {
  it('tras confirmarse, el donante ve "Retenido: esperando evidencia"', async () => {
    const usuario = await crearUsuarioDonante();
    const fondoPropio = await prisma.fondo.create({
      data: { campanaId, nombre: `Fondo estado ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 10_000 },
    });

    await donarYConfirmar(usuario.id, 100, fondoPropio.id);

    const historial = await donaciones.historial(usuario.id);
    expect(historial.donaciones[0].estado.codigo).toBe('RETENIDO');
    expect(historial.donaciones[0].estado.etiqueta).toBe('Retenido: esperando evidencia');
    expect(historial.donaciones[0].montoEsperandoEvidencia).toBe('95.56');
  });

  it('mientras el pago no se confirma, el estado explica que se esta confirmando', async () => {
    const usuario = await crearUsuarioDonante();
    await donaciones.donar(
      usuario.id,
      { fondoId, monto: 60, tokenTarjeta: 'tok_ok_4242', anonima: false },
      {},
    );

    const historial = await donaciones.historial(usuario.id);
    expect(historial.donaciones[0].estado.codigo).toBe('DONADO');
  });

  it('un pago rechazado se explica sin alarmar al donante', async () => {
    const usuario = await crearUsuarioDonante();
    const r = await donaciones.donar(
      usuario.id,
      { fondoId, monto: 60, tokenTarjeta: 'tok_rechazo_1111', anonima: false },
      {},
    );
    await donaciones.procesarWebhook(
      eventoPara(r.referenciaExterna, r.donacionId, { monto: 60, comision: 3.06, rechazado: true }),
    );

    const historial = await donaciones.historial(usuario.id);
    expect(historial.donaciones[0].estado.codigo).toBe('FALLIDA');
    expect(historial.donaciones[0].estado.descripcion).toMatch(/no se le hizo ningun cargo/i);
  });
});

describe('CU04 · Donacion recurrente', () => {
  it('crea la suscripcion con su proximo cobro', async () => {
    const usuario = await crearUsuarioDonante();

    const s = await donaciones.suscribir(
      usuario.id,
      { fondoId, monto: 50, tokenTarjeta: 'tok_ok_4242', diaCobro: 5, anonima: false },
      {},
    );

    expect(s.estado).toBe('ACTIVA');
    expect(s.proximoCobroEn.getTime()).toBeGreaterThan(Date.now());
    expect(s.proximoCobroEn.getDate()).toBe(5);
  });

  it('no permite dos suscripciones activas al mismo fondo', async () => {
    const usuario = await crearUsuarioDonante();
    const datos = {
      fondoId,
      monto: 30,
      tokenTarjeta: 'tok_ok_4242',
      diaCobro: 1,
      anonima: false,
    };

    await donaciones.suscribir(usuario.id, datos, {});
    await expect(donaciones.suscribir(usuario.id, datos, {})).rejects.toThrow(/ya tiene una/i);
  });

  it('se pausa, reanuda y cancela en un paso (RF-08)', async () => {
    const usuario = await crearUsuarioDonante();
    const s = await donaciones.suscribir(
      usuario.id,
      { fondoId, monto: 40, tokenTarjeta: 'tok_ok_4242', diaCobro: 10, anonima: false },
      {},
    );

    expect((await donaciones.cambiarSuscripcion(s.id, usuario.id, { accion: 'PAUSAR' }, {})).estado)
      .toBe('PAUSADA');
    expect(
      (await donaciones.cambiarSuscripcion(s.id, usuario.id, { accion: 'REANUDAR' }, {})).estado,
    ).toBe('ACTIVA');
    expect(
      (await donaciones.cambiarSuscripcion(s.id, usuario.id, { accion: 'CANCELAR' }, {})).estado,
    ).toBe('CANCELADA');

    // Cancelada es definitivo: no se reanuda.
    await expect(
      donaciones.cambiarSuscripcion(s.id, usuario.id, { accion: 'REANUDAR' }, {}),
    ).rejects.toThrow(/ya estaba cancelada/i);
  });

  it('nadie puede tocar la suscripcion de otra persona', async () => {
    const dueno = await crearUsuarioDonante();
    const extrano = await crearUsuarioDonante();

    const s = await donaciones.suscribir(
      dueno.id,
      { fondoId, monto: 25, tokenTarjeta: 'tok_ok_4242', diaCobro: 15, anonima: false },
      {},
    );

    await expect(
      donaciones.cambiarSuscripcion(s.id, extrano.id, { accion: 'CANCELAR' }, {}),
    ).rejects.toThrow(/No encontramos/i);
  });
});

describe('Integridad del libro con varias donaciones', () => {
  it('la cadena se mantiene y los saldos cuadran con la suma de movimientos', async () => {
    const fondoPropio = await prisma.fondo.create({
      data: { campanaId, nombre: `Fondo multiple ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 10_000 },
    });

    let netoEsperado = new Prisma.Decimal(0);
    for (const monto of [50, 120, 75.5]) {
      const r = await donarYConfirmar(donanteUsuarioId, monto, fondoPropio.id);
      netoEsperado = netoEsperado.plus(new Prisma.Decimal(monto).minus(r.comision));
    }

    const cadena = await libro.verificarCadena(fondoPropio.id);
    expect(cadena.rota).toBe(false);
    expect(cadena.movimientos).toBe(9); // 3 donaciones x 3 asientos

    const f = await prisma.fondo.findUniqueOrThrow({ where: { id: fondoPropio.id } });
    expect(f.saldoRetenido.toFixed(2)).toBe(netoEsperado.toFixed(2));
    expect(f.saldoRecaudado.toFixed(2)).toBe(netoEsperado.toFixed(2));

    // La secuencia es continua: ningun movimiento se perdio.
    const extracto = await libro.extracto(fondoPropio.id);
    expect(extracto.map((m) => m.secuencia)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
});

describe('Concurrencia sobre el mismo fondo', () => {
  /** Crea el cobro pendiente y devuelve lo necesario para disparar su webhook. */
  async function cobroPendiente(monto: number, fondo: string) {
    const r = await donaciones.donar(
      donanteUsuarioId,
      { fondoId: fondo, monto, tokenTarjeta: 'tok_ok_4242', anonima: false },
      {},
    );
    const pago = await prisma.pago.findUniqueOrThrow({
      where: { referenciaExterna: r.referenciaExterna },
    });
    return { ...r, monto, comision: Number(pago.comision) };
  }

  it('tres donaciones confirmadas a la vez no pierden ni duplican asientos', async () => {
    const fondoPropio = await prisma.fondo.create({
      data: {
        campanaId,
        nombre: `Fondo concurrente ${marca}`,
        categoriaGasto: 'ALIMENTOS',
        meta: 10_000,
      },
    });

    // Se crean antes y de a uno: donar() no toca el libro, asi que la carrera
    // que interesa empieza recien cuando llegan los webhooks.
    const cobros: Awaited<ReturnType<typeof cobroPendiente>>[] = [];
    for (const monto of [40, 65, 90]) {
      cobros.push(await cobroPendiente(monto, fondoPropio.id));
    }

    const resultados = await Promise.all(
      cobros.map((c) =>
        donaciones.procesarWebhook(
          eventoPara(c.referenciaExterna, c.donacionId, {
            monto: c.monto,
            comision: c.comision,
          }),
        ),
      ),
    );

    // Ninguno falla. Sin reintento, PostgreSQL aborta a los que pierden la
    // carrera de serializacion y esos donantes reciben un error con la
    // tarjeta ya cobrada.
    expect(resultados.every((r) => r.procesado)).toBe(true);

    const cadena = await libro.verificarCadena(fondoPropio.id);
    expect(cadena.rota).toBe(false);
    expect(cadena.movimientos).toBe(9); // 3 donaciones x 3 asientos

    // La secuencia sigue siendo continua: el encadenamiento serializo lo que
    // llego en paralelo, sin huecos ni numeros repetidos.
    const extracto = await libro.extracto(fondoPropio.id);
    expect(extracto.map((m) => m.secuencia)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const netoEsperado = cobros.reduce(
      (suma, c) => suma.plus(new Prisma.Decimal(c.monto).minus(c.comision)),
      new Prisma.Decimal(0),
    );
    const f = await prisma.fondo.findUniqueOrThrow({ where: { id: fondoPropio.id } });
    expect(f.saldoRetenido.toFixed(2)).toBe(netoEsperado.toFixed(2));
  });

  it('el mismo evento entregado dos veces a la vez se asienta una sola vez', async () => {
    const fondoPropio = await prisma.fondo.create({
      data: {
        campanaId,
        nombre: `Fondo evento doble ${marca}`,
        categoriaGasto: 'ALIMENTOS',
        meta: 10_000,
      },
    });

    const cobro = await cobroPendiente(150, fondoPropio.id);
    const evento = eventoPara(cobro.referenciaExterna, cobro.donacionId, {
      monto: cobro.monto,
      comision: cobro.comision,
    });

    // La misma entrega, dos veces, sin espera entre una y otra: las dos leen
    // el pago en PENDIENTE antes de que ninguna lo resuelva. Es el caso que
    // la guarda de idempotencia de afuera no alcanza a cubrir.
    const [a, b] = await Promise.all([
      donaciones.procesarWebhook(evento),
      donaciones.procesarWebhook(evento),
    ]);

    const aplicados = [a, b].filter((r) => r.procesado);
    expect(aplicados).toHaveLength(1);

    // Lo que de verdad importa: el libro. Seis asientos en vez de tres serian
    // el doble del dinero que entro.
    const cadena = await libro.verificarCadena(fondoPropio.id);
    expect(cadena.movimientos).toBe(3);
    expect(cadena.rota).toBe(false);

    const neto = new Prisma.Decimal(cobro.monto).minus(cobro.comision);
    const f = await prisma.fondo.findUniqueOrThrow({ where: { id: fondoPropio.id } });
    expect(f.saldoRetenido.toFixed(2)).toBe(neto.toFixed(2));
  });
});
