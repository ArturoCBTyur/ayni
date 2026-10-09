/**
 * Encuestas de SOC-1 y PSI-1 (Fase 4 del plan transdisciplinario).
 *
 * Lo que se prueba es lo que hace que la medicion valga: que nadie responda
 * sin el consentimiento de investigacion, que la respuesta no lleve la
 * cuenta, que la linea base sea de verdad anterior al primer impacto, que
 * revocar desvincule, y que el tablero no publique un promedio de tres.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomBytes } from 'node:crypto';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import {
  crearEscenarioContable,
  type EscenarioContable,
} from '../../comun/pruebas/escenario-contable';
import { cargarConfiguracion } from '../../config/configuracion';
import { IndicadoresService } from '../analitica/indicadores.service';
import { CumplimientoService } from '../cumplimiento/cumplimiento.service';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import { EncuestasService } from './encuestas.service';
import {
  CONFIANZA_DONANTE,
  DIAS_SEGUIMIENTO,
  SUS,
  UMBRAL_PUBLICACION,
  puntaje,
  variacionSoc1,
} from './instrumentos';
import { publicarInstrumentos } from './publicacion';

let prisma: PrismaService;
let encuestas: EncuestasService;
let cumplimiento: CumplimientoService;
let indicadores: IndicadoresService;
let e: EscenarioContable;

/** Seudonimos de respuestas sembradas a mano, para limpiarlas al final. */
const sembradas: string[] = [];
/** Respuestas desvinculadas por la suite: su seudonimo ya no es el de nadie. */
const desvinculadas: string[] = [];

const DIA = 24 * 60 * 60 * 1000;
const contexto = { ip: '127.0.0.1', userAgent: 'jest' };

const como = (usuarioId: string, roles = ['DONANTE']): CargaAcceso => ({
  sub: usuarioId,
  correo: `${usuarioId}@prueba.pe`,
  roles,
  ongs: [],
});

async function consentir(usuarioId: string, otorgado = true) {
  await cumplimiento.actualizarConsentimiento(
    usuarioId,
    { finalidad: 'INVESTIGACION', otorgado, versionPolitica: '1.0' },
    contexto,
  );
}

async function impacto(usuarioId: string, creadoEn: Date) {
  await prisma.notificacion.create({
    data: {
      usuarioId,
      tipo: 'IMPACTO',
      canal: 'IN_APP',
      asunto: 'Su aporte se uso',
      cuerpo: 'Prueba de encuestas.',
      transaccional: true,
      creadoEn,
    },
  });
}

/** Una cuenta con rol de donante, su perfil y una donacion confirmada. */
async function donanteCon(etiqueta: string): Promise<string> {
  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'DONANTE' } });
  const usuario = await prisma.usuario.create({
    data: {
      correo: `${etiqueta}-${e.marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: etiqueta,
      apellidos: 'De Prueba',
      estado: 'ACTIVO',
      roles: { create: { rolId: rol.id } },
      donante: { create: {} },
    },
    include: { donante: true },
  });
  e.usuarios.push(usuario.id);
  await prisma.donacion.create({
    data: {
      donanteId: usuario.donante!.id,
      fondoId: e.fondoId,
      monto: 20,
      montoNeto: 19,
      estado: 'CONFIRMADA',
      confirmadaEn: new Date(),
    },
  });
  return usuario.id;
}

const respuestaConfianza = (momento: 'LINEA_BASE' | 'SEGUIMIENTO', valor = 4) => ({
  codigo: CONFIANZA_DONANTE.codigo,
  version: CONFIANZA_DONANTE.version,
  momento,
  valores: CONFIANZA_DONANTE.items.map(() => valor),
});

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [
      PrismaService,
      BitacoraService,
      EncuestasService,
      CumplimientoService,
      IndicadoresService,
    ],
  }).compile();

  prisma = modulo.get(PrismaService);
  encuestas = modulo.get(EncuestasService);
  cumplimiento = modulo.get(CumplimientoService);
  indicadores = modulo.get(IndicadoresService);
  await prisma.$connect();

  // El seed ya los publica; esto cubre una base sembrada antes de la Fase 4.
  await publicarInstrumentos(prisma);
  e = await crearEscenarioContable(prisma, 'encuestas');
}, 60_000);

afterAll(async () => {
  const seudonimos = [...sembradas, ...e.usuarios.map((u) => encuestas.seudonimo(u))];
  await prisma.respuestaEncuesta.deleteMany({
    where: { OR: [{ seudonimo: { in: seudonimos } }, { id: { in: desvinculadas } }] },
  });
  await e.limpiar();
  await prisma.$disconnect();
});

describe('Puntajes', () => {
  it('el SUS usa la formula estandar e invierte los items pares', () => {
    expect(puntaje(SUS, [3, 3, 3, 3, 3, 3, 3, 3, 3, 3])).toBe(50);
    expect(puntaje(SUS, [5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(puntaje(SUS, [1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
  });

  it('el indice de confianza lleva la media a 0-100', () => {
    const items = CONFIANZA_DONANTE.items.length;
    const todos = (v: number) => Array.from({ length: items }, () => v);
    expect(puntaje(CONFIANZA_DONANTE, todos(7))).toBe(100);
    expect(puntaje(CONFIANZA_DONANTE, todos(1))).toBe(0);
    expect(puntaje(CONFIANZA_DONANTE, todos(4))).toBe(50);
  });

  it('rechaza respuestas incompletas o fuera de la escala', () => {
    expect(() => puntaje(SUS, [3, 3])).toThrow('Responda los 10');
    expect(() => puntaje(SUS, [3, 3, 3, 3, 3, 3, 3, 3, 3, 6])).toThrow('ítem 10');
    expect(() => puntaje(SUS, [3, 3, 3, 3, 3, 3, 3, 3, 3, 2.5])).toThrow('ítem 10');
  });

  it('SOC-1 es la variacion de las medias de los pares', () => {
    expect(variacionSoc1([{ base: 50, seguimiento: 60 }])).toBe(20);
    expect(variacionSoc1([])).toBeNull();
    expect(variacionSoc1([{ base: 0, seguimiento: 10 }])).toBeNull();
  });
});

describe('RF-DE-06 · Consentimiento para investigacion', () => {
  it('sin la finalidad otorgada se ofrece la encuesta, pero no se puede responder', async () => {
    const pendientes = await encuestas.pendientes(como(e.donanteUsuarioId));
    await e.donar(30, 1.33);
    const conDonacion = await encuestas.pendientes(como(e.donanteUsuarioId));

    expect(pendientes.consentimiento).toBe(false);
    expect(pendientes.pendientes).toEqual([]);
    expect(conDonacion.pendientes.map((p) => p.momento)).toEqual(['LINEA_BASE', 'UNICA']);
    await expect(
      encuestas.responder(como(e.donanteUsuarioId), respuestaConfianza('LINEA_BASE')),
    ).rejects.toThrow('autorizar el uso de sus respuestas');
  });
});

describe('RF-SO-05 · Respuestas sin la cuenta de quien responde', () => {
  it('la respuesta guarda un seudonimo, no la cuenta, y el puntaje', async () => {
    await consentir(e.donanteUsuarioId);
    await encuestas.responder(como(e.donanteUsuarioId), respuestaConfianza('LINEA_BASE', 5));

    const fila = await prisma.respuestaEncuesta.findFirstOrThrow({
      where: { seudonimo: encuestas.seudonimo(e.donanteUsuarioId) },
    });
    expect(fila.seudonimo).not.toContain(e.donanteUsuarioId);
    expect(fila.seudonimo).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(fila.puntaje)).toBeCloseTo(66.67);
    expect(fila.rol).toBe('DONANTE');
  });

  it('no se responde dos veces el mismo momento', async () => {
    await expect(
      encuestas.responder(como(e.donanteUsuarioId), respuestaConfianza('LINEA_BASE')),
    ).rejects.toThrow('no le corresponde ahora');
  });

  it('el seguimiento llega a los 30 dias del primer impacto, no antes', async () => {
    const primerImpacto = new Date(Date.now() - 2 * DIA);
    await impacto(e.donanteUsuarioId, primerImpacto);

    const antes = await encuestas.pendientes(como(e.donanteUsuarioId));
    const despues = await encuestas.pendientes(
      como(e.donanteUsuarioId),
      new Date(primerImpacto.getTime() + (DIAS_SEGUIMIENTO + 1) * DIA),
    );

    expect(antes.pendientes.map((p) => p.momento)).toEqual(['UNICA']);
    expect(despues.pendientes.map((p) => p.momento)).toEqual(['SEGUIMIENTO', 'UNICA']);
  });

  it('una linea base despues del primer impacto ya no es base: no se ofrece', async () => {
    const tardio = await donanteCon('tardio');
    await consentir(tardio);
    await impacto(tardio, new Date());

    const { pendientes } = await encuestas.pendientes(como(tardio));
    expect(pendientes.map((p) => p.momento)).toEqual(['UNICA']);
  });

  it('el SUS de quien registro un gasto cuenta como de la ONG', async () => {
    await consentir(e.operadorId);
    await e.donar(100, 4.44);
    await e.gastoAprobado(10);

    await encuestas.responder(como(e.operadorId, ['ONG_OPERADOR']), {
      codigo: SUS.codigo,
      version: SUS.version,
      momento: 'UNICA',
      valores: [4, 2, 4, 2, 4, 2, 4, 2, 4, 2],
    });

    const fila = await prisma.respuestaEncuesta.findFirstOrThrow({
      where: { seudonimo: encuestas.seudonimo(e.operadorId) },
    });
    expect(fila.rol).toBe('ONG');
    expect(Number(fila.puntaje)).toBe(75);
  });

  it('valida la escala del instrumento publicado', async () => {
    await expect(
      encuestas.responder(como(e.donanteUsuarioId), {
        codigo: SUS.codigo,
        version: SUS.version,
        momento: 'UNICA',
        valores: [9],
      }),
    ).rejects.toThrow('Responda los 10');
  });
});

describe('Instrumentos versionados', () => {
  it('entrega la version activa con su hash', async () => {
    const sus = await encuestas.instrumento(SUS.codigo);
    expect(sus.version).toBe(SUS.version);
    expect(sus.items).toHaveLength(10);
    expect(sus.hash).toMatch(/^[0-9a-f]{64}$/);
    await expect(encuestas.instrumento('NO_EXISTE')).rejects.toThrow('No hay una version activa');
  });

  it('la base no deja cambiar ni borrar un instrumento publicado', async () => {
    await expect(
      prisma.instrumentoEncuesta.updateMany({
        where: { codigo: SUS.codigo, version: SUS.version },
        data: { indicador: 'OTRO' },
      }),
    ).rejects.toThrow(/no cambia/);
    await expect(
      prisma.instrumentoEncuesta.deleteMany({ where: { codigo: SUS.codigo } }),
    ).rejects.toThrow(/no se borra/);
  });

  it('publicar otro contenido con la misma version falla con un motivo', async () => {
    const cambiado = { ...SUS, items: [...SUS.items.slice(0, 9), { numero: 10, texto: 'Otra' }] };
    await expect(publicarInstrumentos(prisma, [cambiado])).rejects.toThrow(
      'publique una version nueva',
    );
  });
});

describe('Revocar la investigacion', () => {
  it('desvincula lo que respondio: deja de poder emparejarse', async () => {
    const antes = await prisma.respuestaEncuesta.findMany({
      where: { seudonimo: encuestas.seudonimo(e.donanteUsuarioId) },
      select: { id: true },
    });
    desvinculadas.push(...antes.map((r) => r.id));
    await consentir(e.donanteUsuarioId, false);
    const despues = await prisma.respuestaEncuesta.count({
      where: { seudonimo: encuestas.seudonimo(e.donanteUsuarioId) },
    });
    const bitacora = await prisma.bitacoraAuditoria.findFirstOrThrow({
      where: { usuarioId: e.donanteUsuarioId, accion: 'CONSENTIMIENTO_REVOCADO' },
      orderBy: { creadoEn: 'desc' },
    });

    expect(antes).toHaveLength(1);
    expect(despues).toBe(0);
    expect(bitacora.valorNuevo).toMatchObject({ respuestasDesvinculadas: 1 });
  });

  it('la base no deja reescribir una respuesta, solo desvincularla', async () => {
    await expect(
      prisma.respuestaEncuesta.updateMany({
        where: { seudonimo: encuestas.seudonimo(e.operadorId) },
        data: { puntaje: 100 },
      }),
    ).rejects.toThrow(/solo se puede desvincular/);
  });
});

describe('T4.4 · SOC-1 y PSI-1 en el tablero', () => {
  /** Pares de linea base y seguimiento de personas que no son de la suite. */
  async function sembrarPares(cantidad: number, base: number, seguimiento: number) {
    const instrumento = await prisma.instrumentoEncuesta.findFirstOrThrow({
      where: { codigo: CONFIANZA_DONANTE.codigo, activo: true },
    });
    for (let i = 0; i < cantidad; i += 1) {
      const seudonimo = randomBytes(32).toString('hex');
      sembradas.push(seudonimo);
      for (const [momento, valor] of [
        ['LINEA_BASE', base],
        ['SEGUIMIENTO', seguimiento],
      ] as const) {
        await prisma.respuestaEncuesta.create({
          data: {
            instrumentoId: instrumento.id,
            momento,
            seudonimo,
            rol: 'DONANTE',
            valores: [],
            puntaje: valor,
          },
        });
      }
    }
  }

  const soc1 = async () =>
    (await indicadores.tabla3()).indicadores.find((i) => i.codigo === 'SOC-1')!;

  it('con menos pares que el umbral no publica el valor, y dice cuantos hay', async () => {
    // Las respuestas no se pueden atribuir a nadie, asi que una corrida
    // interrumpida no se limpia sola: si esto falla, la base trae pares de antes.
    expect((await soc1()).n).toBe(0);
    await sembrarPares(UMBRAL_PUBLICACION - 1, 50, 60);
    const indicador = await soc1();

    expect(indicador.valor).toBeNull();
    expect(indicador.n).toBe(UMBRAL_PUBLICACION - 1);
    expect(indicador.noMedible).toContain(`se publica desde ${UMBRAL_PUBLICACION}`);
  });

  it('desde el umbral publica la variacion de los pares', async () => {
    await sembrarPares(1, 50, 60);
    const indicador = await soc1();

    expect(indicador.n).toBe(UMBRAL_PUBLICACION);
    expect(indicador.valor).toBe(20);
    expect(indicador.cumple).toBe(true);
  });

  it('PSI-1 tampoco se publica con una sola respuesta', async () => {
    const psi1 = (await indicadores.tabla3()).indicadores.find((i) => i.codigo === 'PSI-1')!;
    expect(psi1.n).toBeGreaterThanOrEqual(1);
    if (psi1.n! < UMBRAL_PUBLICACION) expect(psi1.valor).toBeNull();
  });

  it('cada indicador del tablero dice sobre cuantos casos se calcula', async () => {
    const { indicadores: lista } = await indicadores.tabla3();
    const sinN = lista.filter((i) => i.n === undefined).map((i) => i.codigo);
    // INF-3 no se mide en esta version: no tiene casos que contar.
    expect(sinN).toEqual(['INF-3']);
  });
});
