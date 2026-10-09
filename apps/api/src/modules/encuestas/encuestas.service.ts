import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, type MomentoEncuesta } from '@prisma/client';

import { PrismaService } from '../../comun/prisma/prisma.service';
import { seudonimoDe } from '../../comun/seudonimo';
import type { Configuracion } from '../../config/configuracion';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import {
  CONFIANZA_DONANTE,
  DIAS_SEGUIMIENTO,
  INSTRUMENTOS,
  SUS,
  puntaje,
  type Instrumento,
} from './instrumentos';
import { publicarInstrumentos } from './publicacion';

export interface Pendiente {
  codigo: string;
  version: number;
  momento: MomentoEncuesta;
  nombre: string;
  items: number;
  /** Por que se le pide ahora, en el idioma de quien responde. */
  motivo: string;
}

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * Encuestas de SOC-1 y PSI-1 (Fase 4 del plan transdisciplinario).
 *
 * Tres reglas que no dependen de nadie mas:
 *
 * 1. Nadie responde sin la finalidad INVESTIGACION otorgada (RF-DE-06). La
 *    encuesta se ofrece igual, para poder pedirla; responder no.
 * 2. La respuesta no guarda la cuenta, solo su seudonimo (D6).
 * 3. Solo se pregunta cuando la medicion tiene sentido: la linea base antes
 *    del primer impacto, el seguimiento despues, el SUS despues de una tarea
 *    real. Una linea base tomada despues del primer impacto ya no es base.
 */
@Injectable()
export class EncuestasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Configuracion, true>,
  ) {}

  seudonimo(usuarioId: string): string {
    return seudonimoDe(usuarioId, this.config.get('ENCUESTAS_CLAVE', { infer: true }));
  }

  /** Ver publicacion.ts. */
  async publicarInstrumentos(instrumentos: Instrumento[] = INSTRUMENTOS) {
    return publicarInstrumentos(this.prisma, instrumentos);
  }

  /** La version activa de un instrumento, tal como se publico. */
  async instrumento(codigo: string) {
    const fila = await this.prisma.instrumentoEncuesta.findFirst({
      where: { codigo, activo: true },
    });
    if (!fila) throw new NotFoundException('No hay una version activa de esa encuesta.');

    return {
      ...(JSON.parse(fila.contenido) as Instrumento),
      hash: fila.hashContenido,
    };
  }

  /** Lo que esta persona puede responder hoy, y si ya dio el consentimiento. */
  async pendientes(usuario: CargaAcceso, ahora = new Date()) {
    const [consentimiento, activos] = await Promise.all([
      this.tieneConsentimiento(usuario.sub),
      this.prisma.instrumentoEncuesta.findMany({ where: { activo: true } }),
    ]);
    const seudonimo = this.seudonimo(usuario.sub);
    const respondidas = await this.prisma.respuestaEncuesta.findMany({
      where: { seudonimo, instrumentoId: { in: activos.map((a) => a.id) } },
      select: { instrumentoId: true, momento: true },
    });
    const yaRespondio = (id: string, momento: MomentoEncuesta) =>
      respondidas.some((r) => r.instrumentoId === id && r.momento === momento);

    const pendientes: Pendiente[] = [];
    const confianza = activos.find((a) => a.codigo === CONFIANZA_DONANTE.codigo);
    const sus = activos.find((a) => a.codigo === SUS.codigo);

    if (confianza) {
      const momento = await this.momentoDeConfianza(usuario.sub, ahora, (m) =>
        yaRespondio(confianza.id, m),
      );
      if (momento) pendientes.push(this.pendiente(confianza, momento.momento, momento.motivo));
    }

    if (sus && !yaRespondio(sus.id, 'UNICA')) {
      const tarea = await this.tareaTerminada(usuario.sub);
      if (tarea) pendientes.push(this.pendiente(sus, 'UNICA', tarea.motivo));
    }

    return { consentimiento, pendientes };
  }

  /** RF-SO-05 · Registra una respuesta, si a esta persona le tocaba responderla. */
  async responder(
    usuario: CargaAcceso,
    datos: { codigo: string; version: number; momento: MomentoEncuesta; valores: number[] },
    ahora = new Date(),
  ) {
    if (!(await this.tieneConsentimiento(usuario.sub))) {
      throw new ForbiddenException(
        'Para responder hace falta autorizar el uso de sus respuestas para investigacion. ' +
          'Puede hacerlo desde la encuesta o en Mis datos y privacidad.',
      );
    }

    const { pendientes } = await this.pendientes(usuario, ahora);
    const pendiente = pendientes.find(
      (p) =>
        p.codigo === datos.codigo && p.version === datos.version && p.momento === datos.momento,
    );
    if (!pendiente) {
      throw new BadRequestException(
        'Esa encuesta no le corresponde ahora: ya la respondio o todavia no es el momento.',
      );
    }

    const fila = await this.prisma.instrumentoEncuesta.findUniqueOrThrow({
      where: { codigo_version: { codigo: datos.codigo, version: datos.version } },
    });
    const instrumento = JSON.parse(fila.contenido) as Instrumento;

    let valor: number;
    try {
      valor = puntaje(instrumento, datos.valores);
    } catch (e) {
      throw new BadRequestException((e as Error).message);
    }

    try {
      await this.prisma.respuestaEncuesta.create({
        data: {
          instrumentoId: fila.id,
          momento: datos.momento,
          seudonimo: this.seudonimo(usuario.sub),
          rol: await this.rolQueResponde(usuario, instrumento),
          valores: datos.valores,
          puntaje: new Prisma.Decimal(valor),
        },
      });
    } catch (e) {
      // Dos envios a la vez: la base deja pasar uno solo (unique).
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new BadRequestException('Esa encuesta ya esta respondida.');
      }
      throw e;
    }

    return { registrada: true, codigo: datos.codigo, momento: datos.momento };
  }

  /**
   * Desvincula las respuestas de una persona: su seudonimo pasa a ser uno
   * aleatorio. Las respuestas siguen contando en los agregados que no
   * necesitan emparejar (PSI-1), pero ya no se pueden atribuir a nadie, ni
   * emparejar en SOC-1. Lo llama la revocacion de INVESTIGACION (D6).
   */
  static async desvincular(tx: Prisma.TransactionClient, seudonimo: string): Promise<number> {
    return tx.$executeRaw`
      UPDATE respuestas_encuesta
         SET seudonimo = encode(gen_random_bytes(32), 'hex')
       WHERE seudonimo = ${seudonimo}
    `;
  }

  private pendiente(
    fila: { codigo: string; version: number; contenido: string },
    momento: MomentoEncuesta,
    motivo: string,
  ): Pendiente {
    const instrumento = JSON.parse(fila.contenido) as Instrumento;
    return {
      codigo: fila.codigo,
      version: fila.version,
      momento,
      nombre: instrumento.nombre,
      items: instrumento.items.length,
      motivo,
    };
  }

  private async tieneConsentimiento(usuarioId: string): Promise<boolean> {
    const vigente = await this.prisma.consentimiento.findFirst({
      where: { usuarioId, finalidad: 'INVESTIGACION', revocadoEn: null },
      orderBy: { otorgadoEn: 'desc' },
    });
    return vigente?.otorgado === true;
  }

  /**
   * D3 · Linea base al donar por primera vez, antes del primer impacto;
   * seguimiento a los DIAS_SEGUIMIENTO dias del primer impacto.
   */
  private async momentoDeConfianza(
    usuarioId: string,
    ahora: Date,
    yaRespondio: (m: MomentoEncuesta) => boolean,
  ): Promise<{ momento: MomentoEncuesta; motivo: string } | null> {
    const [donaciones, primerImpacto] = await Promise.all([
      this.prisma.donacion.count({ where: { donante: { usuarioId }, estado: 'CONFIRMADA' } }),
      this.prisma.notificacion.findFirst({
        where: { usuarioId, tipo: 'IMPACTO' },
        orderBy: { creadoEn: 'asc' },
        select: { creadoEn: true },
      }),
    ]);
    if (donaciones === 0) return null;

    if (!yaRespondio('LINEA_BASE')) {
      // Despues del primer impacto la persona ya vio la plataforma funcionar:
      // su respuesta no es una linea base, y mezclarla sesgaria SOC-1.
      return primerImpacto
        ? null
        : {
            momento: 'LINEA_BASE',
            motivo: 'Antes de que le contemos en qué se usó su aporte.',
          };
    }

    if (
      !yaRespondio('SEGUIMIENTO') &&
      primerImpacto &&
      ahora.getTime() - primerImpacto.creadoEn.getTime() >= DIAS_SEGUIMIENTO * DIA_MS
    ) {
      return {
        momento: 'SEGUIMIENTO',
        motivo: 'Ya vio en qué se usó su aporte: las mismas preguntas, otra vez.',
      };
    }
    return null;
  }

  /** D3 · El SUS se pide despues de una tarea real: donar o registrar un gasto. */
  private async tareaTerminada(usuarioId: string): Promise<{ motivo: string } | null> {
    const [gastos, donaciones] = await Promise.all([
      this.prisma.gasto.count({ where: { registradoPor: usuarioId } }),
      this.prisma.donacion.count({ where: { donante: { usuarioId }, estado: 'CONFIRMADA' } }),
    ]);
    if (gastos > 0) return { motivo: 'Ya registró un gasto en la aplicación.' };
    if (donaciones > 0) return { motivo: 'Ya donó a través de la aplicación.' };
    return null;
  }

  /** El rol de la tarea que se evalua, no el principal de la cuenta. */
  private async rolQueResponde(usuario: CargaAcceso, instrumento: Instrumento): Promise<string> {
    if (instrumento.calculo === 'SUS') {
      const gastos = await this.prisma.gasto.count({ where: { registradoPor: usuario.sub } });
      return gastos > 0 ? 'ONG' : 'DONANTE';
    }
    return 'DONANTE';
  }
}
