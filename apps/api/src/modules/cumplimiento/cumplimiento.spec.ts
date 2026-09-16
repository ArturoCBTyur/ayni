/**
 * Pruebas de Privacidad y Cumplimiento (Fase 2).
 *
 * Lo que se verifica es lo que la Ley N.o 29733 obliga a poder demostrar:
 * que el consentimiento se pidio por finalidad, que revocarlo no borra la
 * historia previa, y que las solicitudes ARCO tienen un plazo calculado y
 * verificable.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { CumplimientoService } from './cumplimiento.service';
import { calcularPlazoArco, sumarDiasHabiles } from './plazos';

const marca = randomUUID().slice(0, 8);

/**
 * Hash ficticio pero distintivo: buscarlo en la exportacion solo prueba algo
 * si es una cadena que no puede aparecer por casualidad en el resto del JSON.
 */
const HASH_FICTICIO = `$argon2id$v=19$NO-DEBE-SALIR-EN-LA-EXPORTACION-${marca}`;

let prisma: PrismaService;
let cumplimiento: CumplimientoService;
const creados: string[] = [];

async function crearUsuario(rolCodigo = 'DONANTE') {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: rolCodigo } });
  const usuario = await prisma.usuario.create({
    data: {
      correo: `cumpl-${marca}-${creados.length}@prueba.pe`,
      hashPassword: HASH_FICTICIO,
      nombres: 'Usuario',
      apellidos: 'Cumplimiento',
      estado: 'ACTIVO',
      roles: { create: { rolId: rol.id } },
      consentimientos: {
        create: [
          { finalidad: 'TRATAMIENTO_DATOS', otorgado: true, versionPolitica: '1.0' },
          { finalidad: 'COMUNICACIONES', otorgado: true, versionPolitica: '1.0' },
        ],
      },
    },
  });
  creados.push(usuario.id);
  return usuario;
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [PrismaService, BitacoraService, CumplimientoService],
  }).compile();

  prisma = modulo.get(PrismaService);
  cumplimiento = modulo.get(CumplimientoService);
  await prisma.$connect();
});

afterAll(async () => {
  await prisma.bitacoraAuditoria.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.solicitudArco.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.consentimiento.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: creados } } });
  await prisma.usuario.deleteMany({ where: { id: { in: creados } } });
  await prisma.$disconnect();
});

describe('Calculo de plazos ARCO', () => {
  it('cuenta dias habiles y salta el fin de semana', () => {
    // Viernes 2026-09-11 + 1 dia habil = lunes 14.
    const viernes = new Date('2026-09-11T12:00:00Z');
    expect(sumarDiasHabiles(viernes, 1).getUTCDate()).toBe(14);
    // + 5 dias habiles = viernes 18.
    expect(sumarDiasHabiles(viernes, 5).getUTCDate()).toBe(18);
  });

  it('el derecho de acceso tiene un plazo mayor que los demas', () => {
    const desde = new Date('2026-09-01T12:00:00Z');
    const acceso = calcularPlazoArco('ACCESO', desde);
    const rectificacion = calcularPlazoArco('RECTIFICACION', desde);

    expect(acceso.getTime()).toBeGreaterThan(rectificacion.getTime());
  });

  it('nunca cae en sabado ni domingo', () => {
    for (let dia = 1; dia <= 28; dia += 1) {
      const plazo = calcularPlazoArco('CANCELACION', new Date(Date.UTC(2026, 8, dia, 12)));
      expect([0, 6]).not.toContain(plazo.getDay());
    }
  });
});

describe('Consentimientos (RF-DE-01)', () => {
  it('lista el consentimiento vigente de cada finalidad', async () => {
    const usuario = await crearUsuario();
    const lista = await cumplimiento.consentimientos(usuario.id);

    expect(lista).toHaveLength(2);
    expect(lista.map((c) => c.finalidad).sort()).toEqual(['COMUNICACIONES', 'TRATAMIENTO_DATOS']);
  });

  it('revocar conserva el registro anterior en lugar de borrarlo', async () => {
    const usuario = await crearUsuario();

    await cumplimiento.actualizarConsentimiento(
      usuario.id,
      { finalidad: 'COMUNICACIONES', otorgado: false, versionPolitica: '1.0' },
      { ip: '127.0.0.1' },
    );

    const todos = await prisma.consentimiento.findMany({
      where: { usuarioId: usuario.id, finalidad: 'COMUNICACIONES' },
      orderBy: { otorgadoEn: 'asc' },
    });

    // Dos filas: la original marcada como revocada y la nueva negativa. La
    // historia completa es lo que permite probar que el tratamiento previo
    // fue licito.
    expect(todos).toHaveLength(2);
    expect(todos[0].otorgado).toBe(true);
    expect(todos[0].revocadoEn).not.toBeNull();
    expect(todos[1].otorgado).toBe(false);
    expect(todos[1].revocadoEn).toBeNull();

    const vigentes = await cumplimiento.consentimientos(usuario.id);
    expect(vigentes.find((c) => c.finalidad === 'COMUNICACIONES')?.otorgado).toBe(false);
  });

  it('revocar comunicaciones bloquea las notificaciones no transaccionales', async () => {
    const usuario = await crearUsuario();

    await cumplimiento.actualizarConsentimiento(
      usuario.id,
      { finalidad: 'COMUNICACIONES', otorgado: false, versionPolitica: '1.0' },
      {},
    );

    // La regla vive en la base: revocar aqui tiene efecto real alli.
    await expect(
      prisma.notificacion.create({
        data: {
          usuarioId: usuario.id,
          tipo: 'RESUMEN',
          canal: 'CORREO',
          asunto: `Boletin ${marca}`,
          cuerpo: 'Resumen mensual',
          transaccional: false,
        },
      }),
    ).rejects.toThrow(/consentimiento vigente/i);
  });

  it('no permite revocar el tratamiento de datos sin cerrar la cuenta', async () => {
    const usuario = await crearUsuario();

    await expect(
      cumplimiento.actualizarConsentimiento(
        usuario.id,
        { finalidad: 'TRATAMIENTO_DATOS', otorgado: false, versionPolitica: '1.0' },
        {},
      ),
    ).rejects.toThrow(/cancelacion/i);
  });

  it('repetir la misma decision no genera un registro nuevo', async () => {
    const usuario = await crearUsuario();

    const r = await cumplimiento.actualizarConsentimiento(
      usuario.id,
      { finalidad: 'COMUNICACIONES', otorgado: true, versionPolitica: '1.0' },
      {},
    );

    expect(r.sinCambios).toBe(true);
    const filas = await prisma.consentimiento.count({
      where: { usuarioId: usuario.id, finalidad: 'COMUNICACIONES' },
    });
    expect(filas).toBe(1);
  });

  it('deja rastro en bitacora al revocar (RNF-08)', async () => {
    const usuario = await crearUsuario();

    await cumplimiento.actualizarConsentimiento(
      usuario.id,
      { finalidad: 'USO_IMAGEN', otorgado: true, versionPolitica: '1.0' },
      { ip: '10.0.0.5', userAgent: 'jest' },
    );

    const rastro = await prisma.bitacoraAuditoria.findFirst({
      where: { usuarioId: usuario.id, accion: 'CONSENTIMIENTO_OTORGADO' },
    });
    expect(rastro?.ip).toBe('10.0.0.5');
    expect(rastro?.valorNuevo).toMatchObject({ finalidad: 'USO_IMAGEN', otorgado: true });
  });
});

describe('Solicitudes ARCO (RF-DE-02, CU21)', () => {
  it('registra la solicitud con su plazo legal', async () => {
    const usuario = await crearUsuario();

    const r = await cumplimiento.crearSolicitudArco(
      usuario.id,
      { tipo: 'ACCESO', detalle: 'Solicito copia de todos mis datos personales.' },
      {},
    );

    expect(r.estado).toBe('RECIBIDA');
    expect(r.diasHabiles).toBe(20);
    expect(r.plazoLimite.getTime()).toBeGreaterThan(Date.now());
  });

  it('impide duplicar una solicitud del mismo tipo en tramite', async () => {
    const usuario = await crearUsuario();
    const detalle = 'Solicito la rectificacion de mi numero de telefono.';

    await cumplimiento.crearSolicitudArco(usuario.id, { tipo: 'RECTIFICACION', detalle }, {});

    await expect(
      cumplimiento.crearSolicitudArco(usuario.id, { tipo: 'RECTIFICACION', detalle }, {}),
    ).rejects.toThrow(/ya tiene una solicitud/i);

    // Pero si permite una de otro tipo.
    await expect(
      cumplimiento.crearSolicitudArco(
        usuario.id,
        { tipo: 'OPOSICION', detalle: 'Me opongo al uso de mis datos para comunicaciones.' },
        {},
      ),
    ).resolves.toBeDefined();
  });

  it('el administrador la responde y queda registrada como atendida', async () => {
    const usuario = await crearUsuario();
    const admin = await crearUsuario('ADMIN');

    const solicitud = await cumplimiento.crearSolicitudArco(
      usuario.id,
      { tipo: 'CANCELACION', detalle: 'Solicito la eliminacion de mis datos personales.' },
      {},
    );

    const r = await cumplimiento.responderArco(
      solicitud.id,
      admin.id,
      { estado: 'ATENDIDA', respuesta: 'Datos eliminados segun lo solicitado.' },
      {},
    );

    expect(r.estado).toBe('ATENDIDA');
    expect(r.respondidoEn).not.toBeNull();

    // No se puede resolver dos veces.
    await expect(
      cumplimiento.responderArco(
        solicitud.id,
        admin.id,
        { estado: 'RECHAZADA', respuesta: 'Intento de segunda resolucion.' },
        {},
      ),
    ).rejects.toThrow(/ya fue resuelta/i);
  });

  it('la bandeja ordena por urgencia y marca las vencidas', async () => {
    const usuario = await crearUsuario();

    const solicitud = await cumplimiento.crearSolicitudArco(
      usuario.id,
      { tipo: 'ACCESO', detalle: 'Solicito acceso a mis datos personales guardados.' },
      {},
    );

    // Se fuerza un plazo ya vencido para comprobar el indicador.
    await prisma.solicitudArco.update({
      where: { id: solicitud.id },
      data: { plazoLimite: new Date(Date.now() - 86_400_000) },
    });

    const bandeja = await cumplimiento.bandejaArco();
    const mia = bandeja.find((s) => s.id === solicitud.id);

    expect(mia?.vencida).toBe(true);
    expect(mia?.solicitante.correo).toContain(marca);
  });

  it('una solicitud respondida dentro de plazo no figura como vencida', async () => {
    const usuario = await crearUsuario();
    const admin = await crearUsuario('ADMIN');

    const solicitud = await cumplimiento.crearSolicitudArco(
      usuario.id,
      { tipo: 'OPOSICION', detalle: 'Me opongo al tratamiento con fines de comunicacion.' },
      {},
    );
    await cumplimiento.responderArco(
      solicitud.id,
      admin.id,
      { estado: 'ATENDIDA', respuesta: 'Oposicion registrada y aplicada.' },
      {},
    );

    const mias = await cumplimiento.misSolicitudes(usuario.id);
    expect(mias[0].vencida).toBe(false);
  });
});

describe('Derecho de acceso: exportacion de datos', () => {
  it('entrega los datos personales sin incluir credenciales', async () => {
    const usuario = await crearUsuario();

    const datos = await cumplimiento.exportarDatos(usuario.id);
    const serializado = JSON.stringify(datos);

    expect(datos.cuenta.correo).toBe(usuario.correo);
    expect(datos.consentimientos.length).toBeGreaterThan(0);

    // Lo que no debe salir: entregar credenciales convertiria el derecho de
    // acceso en una via de robo de cuenta.
    expect(serializado).not.toContain('hashPassword');
    expect(serializado).not.toContain('totpSecreto');
    expect(serializado).not.toContain(usuario.hashPassword);
  });
});
