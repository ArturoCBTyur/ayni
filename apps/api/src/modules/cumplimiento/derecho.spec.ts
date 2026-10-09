/**
 * Derecho y tributario (Fase 6 del plan transdisciplinario).
 *
 * La constancia de donacion solo la pide su donante, solo de un aporte
 * confirmado, y dice que la ONG es perceptora solo si lo era en la fecha de
 * la donacion. El informe de la Ley N.o 29733 se prueba sobre el año 2001,
 * donde no hay mas datos que los de esta suite.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { BitacoraModule } from '../../comun/bitacora/bitacora.module';
import { PrismaModule } from '../../comun/prisma/prisma.module';
import { PrismaService } from '../../comun/prisma/prisma.service';
import {
  crearEscenarioContable,
  type EscenarioContable,
} from '../../comun/pruebas/escenario-contable';
import { cargarConfiguracion } from '../../config/configuracion';
import { esquemaPerceptora } from '../campanas/esquemas';
import { OngsService } from '../campanas/ongs.service';
import { ContableModule } from '../contable/contable.module';
import { constanciaPdf } from '../donaciones/constancia';
import { DonacionesService } from '../donaciones/donaciones.service';
import { DonacionesModule } from '../donaciones/donaciones.module';
import { GastosModule } from '../gastos/gastos.module';
import { CumplimientoService } from './cumplimiento.service';
import { informeCumplimientoPdf, informeCumplimientoXlsx, periodoEnLima } from './informe';

let prisma: PrismaService;
let ongs: OngsService;
let donaciones: DonacionesService;
let cumplimiento: CumplimientoService;
let e: EscenarioContable;
let donacionId: string;
let auditorId: string;

const contexto = { ip: '127.0.0.1', userAgent: 'jest' };
const motivo = 'Constancia de inscripcion en el registro de SUNAT, adjunta al expediente.';

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] }),
      PrismaModule,
      BitacoraModule,
      ContableModule,
      GastosModule,
      DonacionesModule,
    ],
    providers: [OngsService, CumplimientoService],
  }).compile();
  prisma = modulo.get(PrismaService);
  ongs = modulo.get(OngsService);
  donaciones = modulo.get(DonacionesService);
  cumplimiento = modulo.get(CumplimientoService);
  await prisma.$connect();

  e = await crearEscenarioContable(prisma, 'derecho');
  donacionId = await e.donar(120, 5.13, new Date('2026-06-15T15:00:00Z'));

  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'AUDITOR' } });
  const auditor = await prisma.usuario.create({
    data: {
      correo: `aud-derecho-${e.marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Auditora',
      apellidos: 'De Prueba',
      estado: 'ACTIVO',
      roles: { create: { rolId: rol.id } },
    },
  });
  auditorId = auditor.id;
  e.usuarios.push(auditorId);
  await prisma.donante.update({
    where: { id: e.donanteId },
    data: { documentoTipo: 'DNI', documentoNumero: '40000001' },
  });
}, 60_000);

afterAll(async () => {
  await prisma.solicitudArco.deleteMany({ where: { usuarioId: { in: e.usuarios } } });
  await e.limpiar();
  await prisma.$disconnect();
});

describe('RF-DE-07 · Calificacion de perceptora de donaciones', () => {
  it('calificarla exige la resolucion y una vigencia que no termine antes de empezar', () => {
    expect(esquemaPerceptora.safeParse({ perceptora: true, motivo }).success).toBe(false);
    expect(
      esquemaPerceptora.safeParse({
        perceptora: true,
        resolucion: 'R.I. 0230050012345',
        desde: '2026-05-01',
        hasta: '2026-04-01',
        motivo,
      }).success,
    ).toBe(false);
  });

  it('la base tampoco acepta una perceptora sin resolucion', async () => {
    await expect(
      prisma.ong.update({ where: { id: e.ongId }, data: { perceptoraDonaciones: true } }),
    ).rejects.toThrow(/ck_ongs_perceptora_acreditada/);
  });

  it('un miembro de la ONG no puede registrarla', async () => {
    await expect(
      ongs.registrarPerceptora(
        e.ongId,
        e.operadorId,
        { perceptora: true, resolucion: 'R.I. 1', desde: new Date('2026-01-01'), motivo },
        contexto,
      ),
    ).rejects.toThrow('su calificacion la debe registrar otra persona');
  });

  it('la registra alguien de afuera, con motivo, y queda en la bitacora', async () => {
    const r = await ongs.registrarPerceptora(
      e.ongId,
      auditorId,
      {
        perceptora: true,
        resolucion: 'R.I. 0230050012345',
        desde: new Date('2026-07-01'),
        motivo,
      },
      contexto,
    );
    const bitacora = await prisma.bitacoraAuditoria.findFirstOrThrow({
      where: { usuarioId: auditorId, accion: 'ONG_PERCEPTORA' },
    });

    expect(r.perceptoraDonaciones).toBe(true);
    expect(bitacora.valorNuevo).toMatchObject({ perceptora: true, motivo });
  });
});

describe('RF-DE-07 · Constancia de donacion', () => {
  it('solo la pide su donante', async () => {
    await expect(donaciones.constancia(donacionId, e.operadorId)).rejects.toThrow(
      'No encontramos ese aporte',
    );
  });

  it('dice cuanto, a quien, por que medio y que se hizo con el aporte', async () => {
    const c = await donaciones.constancia(donacionId, e.donanteUsuarioId);

    expect(c.numero).toMatch(/^AYNI-2026-[0-9A-F]{8}$/);
    expect(c.donatario.ruc).toBe(e.ruc);
    expect(c.donante).toEqual({ nombre: 'Donante De Prueba', documento: 'DNI 40000001' });
    expect(c.donacion).toMatchObject({ monto: '120.00', comision: '5.13', neto: '114.87' });
    expect(c.destino).toMatchObject({ aplicado: '0.00', esperandoEvidencia: '114.87' });
  });

  it('una calificacion posterior a la donacion no se aplica hacia atras', async () => {
    // Calificada desde julio; la donacion es de junio.
    const c = await donaciones.constancia(donacionId, e.donanteUsuarioId);
    expect(c.donatario.perceptora).toBeNull();
    expect(constanciaPdf(c).toString('latin1')).not.toContain('perceptora de donaciones:');
  });

  it('vigente en la fecha de la donacion, la constancia lo dice y advierte lo que falta', async () => {
    await ongs.registrarPerceptora(
      e.ongId,
      auditorId,
      {
        perceptora: true,
        resolucion: 'R.I. 0230050012345',
        desde: new Date('2026-01-01'),
        motivo,
      },
      contexto,
    );
    const c = await donaciones.constancia(donacionId, e.donanteUsuarioId);
    const pdf = constanciaPdf(c).toString('latin1');

    expect(c.donatario.perceptora?.resolucion).toBe('R.I. 0230050012345');
    expect(pdf).toContain('R.I. 0230050012345');
    expect(pdf).toContain('validaci\\363n por un contador');
  });

  it('un aporte sin confirmar no tiene constancia', async () => {
    const pendiente = await prisma.donacion.create({
      data: { donanteId: e.donanteId, fondoId: e.fondoId, monto: 10, estado: 'PENDIENTE' },
    });
    await expect(donaciones.constancia(pendiente.id, e.donanteUsuarioId)).rejects.toThrow(
      'cuando el pago esta confirmado',
    );
    await prisma.donacion.delete({ where: { id: pendiente.id } });
  });
});

describe('RF-DE-08 · Informe de cumplimiento de la Ley N.o 29733', () => {
  const desde = new Date('2001-01-01T05:00:00Z');
  const hasta = new Date('2002-01-01T05:00:00Z');

  beforeAll(async () => {
    const en = (mes: number, dia: number) => new Date(Date.UTC(2001, mes - 1, dia, 15));
    await prisma.solicitudArco.create({
      data: {
        usuarioId: e.donanteUsuarioId,
        tipo: 'ACCESO',
        detalle: 'Quiero saber que datos tienen de mi.',
        estado: 'ATENDIDA',
        creadoEn: en(3, 1),
        plazoLimite: en(3, 29),
        respondidoEn: en(3, 11),
        respuesta: 'Se le envio la exportacion de sus datos.',
      },
    });
    await prisma.solicitudArco.create({
      data: {
        usuarioId: e.operadorId,
        tipo: 'OPOSICION',
        detalle: 'No quiero que usen mis datos para estadisticas.',
        estado: 'RECIBIDA',
        creadoEn: en(11, 1),
        plazoLimite: en(11, 15),
      },
    });
    await prisma.consentimiento.create({
      data: {
        usuarioId: e.donanteUsuarioId,
        finalidad: 'INVESTIGACION',
        otorgado: true,
        versionPolitica: '1.0',
        otorgadoEn: en(4, 1),
        revocadoEn: en(6, 1),
      },
    });
  });

  it('cuenta las solicitudes ARCO, su plazo y las vencidas sin resolver', async () => {
    const i = await cumplimiento.informeCumplimiento(desde, hasta);

    expect(i.arco).toMatchObject({
      recibidas: 2,
      porTipo: { ACCESO: 1, OPOSICION: 1 },
      resueltas: 1,
      resueltasEnPlazo: 1,
      porcentajeEnPlazo: 100,
      diasPromedioDeRespuesta: 10,
      vencidasSinResolver: 1,
    });
  });

  it('cuenta los consentimientos por finalidad, y lo vigente al cierre', async () => {
    const i = await cumplimiento.informeCumplimiento(desde, hasta);
    const investigacion = i.consentimientos.find((c) => c.finalidad === 'INVESTIGACION');

    expect(investigacion).toEqual({
      finalidad: 'INVESTIGACION',
      otorgados: 1,
      revocados: 1,
      vigentesAlCierre: 0,
    });
    expect(i.der1).toEqual({ notificacionesConEvidencia: 0, sinAnonimizar: 0, cumple: true });
  });

  it('el periodo que se pide son dias de Lima, con el ultimo entero', () => {
    // Lo que manda la app para "este año": sin correrlo, empezaba el 31/12.
    const p = periodoEnLima(new Date('2026-01-01'), new Date('2026-10-09'));
    expect(p.desde.toISOString()).toBe('2026-01-01T05:00:00.000Z');
    expect(p.hasta.toISOString()).toBe('2026-10-10T05:00:00.000Z');
  });

  it('se exporta en Excel y PDF, sin un solo dato personal', async () => {
    const i = await cumplimiento.informeCumplimiento(desde, hasta);
    const xlsx = informeCumplimientoXlsx(i).toString('latin1');
    const pdf = informeCumplimientoPdf(i).toString('latin1');

    expect(xlsx.startsWith('PK')).toBe(true);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    for (const archivo of [xlsx, pdf]) {
      expect(archivo).not.toContain('@prueba.pe');
      expect(archivo).not.toContain('Donante De Prueba');
    }
    // Los parentesis van escapados dentro de un texto del PDF.
    expect(pdf).toContain('Investigaci\\363n \\(encuestas\\)');
  });
});
