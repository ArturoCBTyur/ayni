import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma, type DestinoRemanente } from '@prisma/client';

import { BitacoraService, type ContextoPeticion } from '../../comun/bitacora/bitacora.service';
import { soles } from '../../comun/dinero';
import { ZONA_LIMA, fechaEnLima } from '../../comun/periodo';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { LibroService } from '../contable/libro.service';
import { PASARELA_PAGO, type PasarelaPago } from '../donaciones/puertos/pasarela-pago.port';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import { NarrativaService } from '../retorno/narrativa.service';
import { InformesCierreService } from './informes-cierre.service';
import {
  DESTINO_POR_DEFECTO,
  DIAS_AVISO_ONG,
  DIAS_ELECCION,
  GASTOS_EN_CURSO,
  iniciarCierreDeCausa,
  sumarDias,
} from './politica';

export interface ResumenAvance {
  abiertos: number;
  avisos: number;
  enEleccion: number;
  resueltos: number;
  informes: number;
  reembolsos: number;
  /** Cierres que no avanzaron, con el motivo. No detienen a los demas. */
  detenidos: Array<{ fondoId: string; motivo: string }>;
}

type CierreConFondo = Prisma.CierreCausaGetPayload<{
  include: { fondo: { include: { campana: { include: { ong: true } } } } };
}>;

/**
 * Cierre de causa (Fase 3 del plan transdisciplinario; D2 en politica.ts).
 *
 * El ciclo de un fondo cerrado:
 *
 *   JUSTIFICANDO  la ONG tiene DIAS_JUSTIFICACION para justificar lo retenido
 *                 con gastos; a los DIAS_AVISO_ONG se le avisa cuanto falta.
 *   ELIGIENDO     vencido el plazo, cada donante con saldo elige: devolucion
 *                 o traslado a otro fondo, durante DIAS_ELECCION.
 *   RESUELTO      cada remanente con su destino asentado en el libro, el
 *                 informe de cierre emitido y cada donante avisado.
 *
 * Lo mueve un job diario. Cada paso deja el cierre en un estado del que el
 * siguiente puede partir aunque el anterior se haya interrumpido.
 */
@Injectable()
export class CausasService {
  private readonly logger = new Logger(CausasService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly libro: LibroService,
    private readonly narrativa: NarrativaService,
    private readonly bitacora: BitacoraService,
    private readonly informes: InformesCierreService,
    @Inject(PASARELA_PAGO) private readonly pasarela: PasarelaPago,
  ) {}

  /** A las 4:00 de Lima, despues del cierre mensual y de la conciliacion. */
  @Cron('0 4 * * *', { name: 'cierre-de-causas', timeZone: ZONA_LIMA })
  async avanceDiario(): Promise<ResumenAvance> {
    const r = await this.avanzar();
    if (r.detenidos.length > 0) {
      this.logger.warn(
        `Cierres detenidos: ${r.detenidos.map((d) => `${d.fondoId}: ${d.motivo}`).join('; ')}`,
      );
    }
    this.logger.log(
      `Cierre de causas: ${r.abiertos} abierto(s), ${r.avisos} aviso(s), ${r.enEleccion} en ` +
        `eleccion, ${r.resueltos} resuelto(s), ${r.reembolsos} reembolso(s).`,
    );
    return r;
  }

  /**
   * Un paso del ciclo para cada cierre pendiente. `soloFondos` existe para las
   * pruebas: un cierre no se deshace, y una prueba no puede tocar los fondos
   * de la demostracion.
   */
  async avanzar(ahora = new Date(), soloFondos?: string[]): Promise<ResumenAvance> {
    const filtro = soloFondos ? { fondoId: { in: soloFondos } } : {};
    const r: ResumenAvance = {
      abiertos: 0,
      avisos: 0,
      enEleccion: 0,
      resueltos: 0,
      informes: 0,
      reembolsos: 0,
      detenidos: [],
    };

    // Fondos cerrados antes de que existiera esta politica: su plazo corre desde hoy.
    const sinCierre = await this.prisma.fondo.findMany({
      where: {
        ...(soloFondos ? { id: { in: soloFondos } } : {}),
        cierreCausa: null,
        OR: [{ estado: 'CERRADO' }, { campana: { estado: 'CERRADA' } }],
      },
      select: { id: true },
    });
    for (const f of sinCierre) {
      if (await iniciarCierreDeCausa(this.prisma, f.id, ahora)) r.abiertos += 1;
    }

    const pendientes = await this.prisma.cierreCausa.findMany({
      where: { ...filtro, estado: { not: 'RESUELTO' } },
      include: { fondo: { include: { campana: { include: { ong: true } } } } },
      orderBy: { iniciadoEn: 'asc' },
    });

    for (const cierre of pendientes) {
      try {
        const paso = await this.avanzarUno(cierre, ahora);
        if (paso === 'aviso') r.avisos += 1;
        if (paso === 'eleccion') r.enEleccion += 1;
        if (paso === 'resuelto') r.resueltos += 1;
        if (typeof paso === 'object')
          r.detenidos.push({ fondoId: cierre.fondoId, motivo: paso.motivo });
      } catch (e) {
        r.detenidos.push({ fondoId: cierre.fondoId, motivo: (e as Error).message });
      }
    }

    // Lo que quedo a medias: un resuelto sin informe, una devolucion sin reembolso.
    const sinInforme = await this.prisma.cierreCausa.findMany({
      where: { ...filtro, estado: 'RESUELTO', informe: null },
    });
    for (const c of sinInforme) {
      try {
        await this.informes.generar(c.id);
        r.informes += 1;
      } catch (e) {
        r.detenidos.push({ fondoId: c.fondoId, motivo: `informe: ${(e as Error).message}` });
      }
    }
    r.reembolsos = await this.reembolsarPendientes(soloFondos);

    return r;
  }

  private async avanzarUno(
    cierre: CierreConFondo,
    ahora: Date,
  ): Promise<'aviso' | 'eleccion' | 'resuelto' | 'nada' | { motivo: string }> {
    if (cierre.estado === 'ELIGIENDO') {
      const sinElegir = await this.prisma.remanenteDonacion.count({
        where: { cierreId: cierre.id, destino: null },
      });
      if (sinElegir === 0 || ahora >= cierre.venceEleccionEn!) {
        await this.resolver(cierre, ahora);
        return 'resuelto';
      }
      return 'nada';
    }

    const [{ conRestriccion }, enCurso] = await Promise.all([
      this.libro.saldosClasificados(cierre.fondoId),
      this.prisma.gasto.count({
        where: { fondoId: cierre.fondoId, estado: { in: GASTOS_EN_CURSO } },
      }),
    ]);
    const vencido = ahora >= cierre.venceJustificacionEn;

    // Sin nada por justificar ni por verificar, no hay por que esperar el plazo.
    if (vencido || (conRestriccion.isZero() && enCurso === 0)) {
      if (enCurso > 0) {
        const motivo =
          `Hay ${enCurso} gasto(s) en verificacion: el remanente se calcula cuando se ` +
          'resuelvan, porque aprobarlos cambia cuanto queda.';
        await this.observar(cierre.id, motivo);
        return { motivo };
      }
      return this.abrirEleccion(cierre, ahora);
    }

    const avisoDesde = sumarDias(cierre.iniciadoEn, DIAS_AVISO_ONG);
    if (!cierre.avisoOngEn && ahora >= avisoDesde) {
      await this.avisarOng(cierre, conRestriccion, ahora);
      return 'aviso';
    }
    return 'nada';
  }

  /**
   * Vencio el plazo: el remanente de cada donacion es lo que el FIFO no le
   * aplico. Antes de pedirle a nadie que elija, se comprueba que esas partes
   * sumen lo retenido del fondo: si no, hay un descuadre, y repartir sobre un
   * descuadre seria repartir dinero que no esta.
   */
  private async abrirEleccion(
    cierre: CierreConFondo,
    ahora: Date,
  ): Promise<'eleccion' | 'resuelto' | { motivo: string }> {
    const [donaciones, saldos] = await Promise.all([
      this.prisma.donacion.findMany({
        where: { fondoId: cierre.fondoId, estado: 'CONFIRMADA' },
        include: { donante: { include: { usuario: true } } },
        orderBy: [{ confirmadaEn: 'asc' }, { creadoEn: 'asc' }],
      }),
      this.libro.saldosClasificados(cierre.fondoId),
    ]);
    const partes = donaciones
      .map((d) => ({ donacion: d, monto: d.montoNeto.minus(d.montoAplicado) }))
      .filter((p) => p.monto.greaterThan(0));
    const total = partes.reduce((t, p) => t.plus(p.monto), new Prisma.Decimal(0));

    if (!total.equals(saldos.conRestriccion)) {
      const motivo =
        `Lo que el FIFO deja sin aplicar (S/ ${soles(total)}) no coincide con lo retenido del ` +
        `fondo (S/ ${soles(saldos.conRestriccion)}). Revise la conciliacion antes de cerrar.`;
      await this.observar(cierre.id, motivo);
      return { motivo };
    }

    if (partes.length === 0) {
      await this.prisma.cierreCausa.update({
        where: { id: cierre.id },
        data: { remanenteTotal: 0, observacion: null },
      });
      await this.resolver(cierre, ahora);
      return 'resuelto';
    }

    const venceEleccionEn = sumarDias(ahora, DIAS_ELECCION);
    await this.prisma.$transaction([
      this.prisma.remanenteDonacion.createMany({
        data: partes.map((p) => ({
          cierreId: cierre.id,
          donacionId: p.donacion.id,
          monto: p.monto,
        })),
      }),
      this.prisma.cierreCausa.update({
        where: { id: cierre.id },
        data: { estado: 'ELIGIENDO', venceEleccionEn, remanenteTotal: total, observacion: null },
      }),
    ]);

    // RF-CO-03 · Cada donante recibe su parte y sus opciones, una vez.
    for (const p of partes) {
      await this.notificarDonante('cierre.eleccion', p.donacion, {
        monto: soles(p.monto),
        fondo: cierre.fondo.nombre,
        ong: cierre.fondo.campana.ong.nombreComercial ?? cierre.fondo.campana.ong.razonSocial,
        fecha: fechaEnLima(venceEleccionEn),
        destino: '',
      });
    }
    return 'eleccion';
  }

  /**
   * Asienta el destino de cada remanente y cierra. Todo en una transaccion:
   * un cierre resuelto a medias dejaria remanentes asentados y otros no, y la
   * conciliacion no sabria cual es cual.
   */
  private async resolver(cierre: CierreConFondo, ahora: Date): Promise<void> {
    const remanentes = await this.prisma.remanenteDonacion.findMany({
      where: { cierreId: cierre.id, resueltoEn: null },
      include: { donacion: { include: { donante: true } } },
    });

    // Un destino que se cerro despues de elegirlo no recibe nada: el dinero
    // vuelve al donante, y el informe lo cuenta como devolucion sin eleccion.
    const destinos = new Map<string, boolean>();
    for (const r of remanentes) {
      if (r.destino === 'REASIGNACION' && r.fondoDestinoId && !destinos.has(r.fondoDestinoId)) {
        destinos.set(
          r.fondoDestinoId,
          await this.destinoDisponible(r.fondoDestinoId, r.donacion.donante.usuarioId),
        );
      }
    }

    const resueltos: Array<{
      id: string;
      destino: DestinoRemanente;
      fondoDestinoId: string | null;
    }> = [];
    await this.prisma.enTransaccionSerializable(async (tx) => {
      for (const r of remanentes) {
        let destino = r.destino ?? DESTINO_POR_DEFECTO;
        let elegidoPor = r.destino ? r.elegidoPor : 'PLAZO';
        if (destino === 'REASIGNACION' && !destinos.get(r.fondoDestinoId!)) {
          destino = 'DEVOLUCION';
          elegidoPor = 'DESTINO_NO_DISPONIBLE';
        }
        const motivo = `cierre de ${cierre.fondo.nombre}`;

        let donacionDestinoId: string | null = null;
        if (destino === 'DEVOLUCION') {
          await this.libro.asentarDevolucion(tx, {
            fondoId: cierre.fondoId,
            donacionId: r.donacionId,
            monto: r.monto,
            motivo,
          });
        } else {
          // La donacion nace confirmada y sin comision: no hubo cobro nuevo.
          const nueva = await tx.donacion.create({
            data: {
              donanteId: r.donacion.donanteId,
              fondoId: r.fondoDestinoId!,
              monto: r.monto,
              montoNeto: r.monto,
              anonima: r.donacion.anonima,
              estado: 'CONFIRMADA',
              confirmadaEn: ahora,
              donacionOrigenId: r.donacionId,
            },
          });
          donacionDestinoId = nueva.id;
          await this.libro.asentarTraslado(tx, {
            fondoOrigenId: cierre.fondoId,
            donacionOrigenId: r.donacionId,
            fondoDestinoId: r.fondoDestinoId!,
            donacionDestinoId: nueva.id,
            monto: r.monto,
            motivo,
          });
        }

        await tx.remanenteDonacion.update({
          where: { id: r.id },
          data: {
            destino,
            elegidoPor,
            elegidoEn: r.elegidoEn ?? ahora,
            fondoDestinoId: destino === 'REASIGNACION' ? r.fondoDestinoId : null,
            donacionDestinoId,
            resueltoEn: ahora,
          },
        });
        resueltos.push({
          id: r.id,
          destino,
          fondoDestinoId: destino === 'REASIGNACION' ? r.fondoDestinoId : null,
        });
      }

      await tx.cierreCausa.update({
        where: { id: cierre.id },
        data: { estado: 'RESUELTO', resueltoEn: ahora, observacion: null },
      });
    });

    await this.bitacora.registrar({
      accion: 'CAUSA_CERRADA',
      entidad: 'fondos',
      entidadId: cierre.fondoId,
      valorNuevo: {
        remanentes: resueltos.length,
        devoluciones: resueltos.filter((x) => x.destino === 'DEVOLUCION').length,
        traslados: resueltos.filter((x) => x.destino === 'REASIGNACION').length,
      },
    });

    // Lo que sigue puede fallar sin deshacer lo asentado: el job lo retoma.
    const informe = await this.informes.generar(cierre.id);
    await this.reembolsarPendientes([cierre.fondoId]);
    await this.avisarResolucion(cierre, resueltos, ahora, informe.id);
  }

  /** Reembolsa en la pasarela las devoluciones asentadas que todavia no se pagaron. */
  private async reembolsarPendientes(soloFondos?: string[]): Promise<number> {
    const pendientes = await this.prisma.remanenteDonacion.findMany({
      where: {
        destino: 'DEVOLUCION',
        resueltoEn: { not: null },
        reembolsadoEn: null,
        ...(soloFondos ? { cierre: { fondoId: { in: soloFondos } } } : {}),
      },
    });

    let hechos = 0;
    for (const r of pendientes) {
      const pago = await this.pagoOriginal(r.donacionId);
      if (!pago) {
        this.logger.error(`El remanente ${r.id} no tiene un cobro al que devolver.`);
        continue;
      }
      try {
        const { referencia } = await this.pasarela.reembolsar(
          pago.referenciaExterna,
          r.monto.toNumber(),
        );
        await this.prisma.remanenteDonacion.update({
          where: { id: r.id },
          data: { reembolsoReferencia: referencia, reembolsadoEn: new Date() },
        });
        hechos += 1;
      } catch (e) {
        // Asentado y sin pagar: queda para el proximo dia, no se pierde.
        this.logger.warn(`Reembolso del remanente ${r.id} pendiente: ${(e as Error).message}`);
      }
    }
    return hechos;
  }

  /**
   * El cobro de origen de una donacion. Una donacion trasladada desde otra
   * causa no tiene cobro propio: se devuelve sobre el de la original.
   */
  private async pagoOriginal(donacionId: string) {
    let id: string | null = donacionId;
    for (let saltos = 0; id && saltos < 20; saltos += 1) {
      const d: {
        donacionOrigenId: string | null;
        pago: { referenciaExterna: string } | null;
      } | null = await this.prisma.donacion.findUnique({
        where: { id },
        select: { donacionOrigenId: true, pago: { select: { referenciaExterna: true } } },
      });
      if (!d) return null;
      if (d.pago) return d.pago;
      id = d.donacionOrigenId;
    }
    return null;
  }

  // ----- Lo que ve y decide el donante -------------------------------------

  /** Sus saldos de causas cerradas: los que esperan su eleccion y los resueltos. */
  async misSaldos(usuario: CargaAcceso) {
    const filas = await this.prisma.remanenteDonacion.findMany({
      where: { donacion: { donante: { usuarioId: usuario.sub } } },
      include: {
        cierre: { include: { informe: { select: { id: true } } } },
        donacion: { include: { fondo: { include: { campana: { include: { ong: true } } } } } },
        fondoDestino: true,
      },
      orderBy: { creadoEn: 'desc' },
    });

    return filas.map((r) => ({
      id: r.id,
      monto: soles(r.monto),
      fondo: r.donacion.fondo.nombre,
      campana: r.donacion.fondo.campana.titulo,
      ong: r.donacion.fondo.campana.ong.nombreComercial ?? r.donacion.fondo.campana.ong.razonSocial,
      categoriaGasto: r.donacion.fondo.categoriaGasto,
      puedeElegir: r.cierre.estado === 'ELIGIENDO' && r.resueltoEn === null,
      venceEleccionEn: r.cierre.venceEleccionEn,
      destino: r.destino,
      elegidoPor: r.elegidoPor,
      fondoDestino: r.fondoDestino
        ? { id: r.fondoDestino.id, nombre: r.fondoDestino.nombre }
        : null,
      resueltoEn: r.resueltoEn,
      informeId: r.cierre.informe?.id ?? null,
    }));
  }

  /** Fondos a los que puede trasladar su saldo: los de su misma categoria primero. */
  async destinosPosibles(usuario: CargaAcceso, remanenteId: string) {
    const r = await this.remanenteDe(usuario, remanenteId);
    const fondos = await this.prisma.fondo.findMany({
      where: this.condicionDestino(usuario.sub, r.cierre.fondoId),
      include: { campana: { include: { ong: true } } },
      orderBy: { creadoEn: 'desc' },
      take: 50,
    });
    const categoria = r.donacion.fondo.categoriaGasto;

    return fondos
      .sort(
        (a, b) => Number(b.categoriaGasto === categoria) - Number(a.categoriaGasto === categoria),
      )
      .map((f) => ({
        id: f.id,
        nombre: f.nombre,
        categoriaGasto: f.categoriaGasto,
        campana: f.campana.titulo,
        ong: f.campana.ong.nombreComercial ?? f.campana.ong.razonSocial,
        mismaCategoria: f.categoriaGasto === categoria,
      }));
  }

  /** RF-CF-11 · El donante elige el destino de su saldo, mientras el plazo corre. */
  async elegir(
    usuario: CargaAcceso,
    remanenteId: string,
    datos: { destino: DestinoRemanente; fondoDestinoId?: string },
    contexto: ContextoPeticion,
    ahora = new Date(),
  ) {
    const r = await this.remanenteDe(usuario, remanenteId);
    if (r.cierre.estado !== 'ELIGIENDO' || r.resueltoEn || ahora >= r.cierre.venceEleccionEn!) {
      throw new BadRequestException('El plazo para elegir termino: su saldo ya tiene destino.');
    }

    if (datos.destino === 'REASIGNACION') {
      if (!datos.fondoDestinoId) {
        throw new BadRequestException('Elija a que fondo pasa su saldo.');
      }
      // AND y no un spread: condicionDestino trae su propio `id` (distinto del
      // que cierra), y al mezclarlos el del destino se perdia.
      const valido = await this.prisma.fondo.count({
        where: {
          AND: [{ id: datos.fondoDestinoId }, this.condicionDestino(usuario.sub, r.cierre.fondoId)],
        },
      });
      if (valido === 0) {
        throw new BadRequestException(
          'Ese fondo no puede recibir su saldo: tiene que estar activo, en una campaña ' +
            'publicada de una organizacion verificada de la que usted no sea miembro.',
        );
      }
    }

    await this.prisma.remanenteDonacion.update({
      where: { id: r.id },
      data: {
        destino: datos.destino,
        fondoDestinoId: datos.destino === 'REASIGNACION' ? datos.fondoDestinoId : null,
        elegidoPor: 'DONANTE',
        elegidoEn: ahora,
      },
    });

    await this.bitacora.registrar({
      usuarioId: usuario.sub,
      accion: 'REMANENTE_ELEGIDO',
      entidad: 'remanentes_donacion',
      entidadId: r.id,
      valorAnterior: { destino: r.destino, fondoDestinoId: r.fondoDestinoId },
      valorNuevo: { destino: datos.destino, fondoDestinoId: datos.fondoDestinoId ?? null },
      ...contexto,
    });

    return { id: r.id, destino: datos.destino, fondoDestinoId: datos.fondoDestinoId ?? null };
  }

  /** Solo el donante de la donacion ve o decide sobre su saldo. */
  private async remanenteDe(usuario: CargaAcceso, remanenteId: string) {
    const r = await this.prisma.remanenteDonacion.findUnique({
      where: { id: remanenteId },
      include: { cierre: true, donacion: { include: { donante: true, fondo: true } } },
    });
    // 404 y no 403: a quien no es el donante no se le confirma que existe.
    if (!r || r.donacion.donante.usuarioId !== usuario.sub) {
      throw new NotFoundException('No encontramos ese saldo.');
    }
    return r;
  }

  /**
   * Un fondo que puede recibir un traslado: activo, en una campaña publicada
   * de una ONG verificada, que no sea el que cierra, y de una organizacion de
   * la que el donante no es miembro (la misma regla que para donar).
   */
  private condicionDestino(usuarioId: string, fondoOrigenId?: string): Prisma.FondoWhereInput {
    return {
      ...(fondoOrigenId ? { id: { not: fondoOrigenId } } : {}),
      estado: 'ACTIVO',
      campana: {
        estado: 'ACTIVA',
        ong: {
          estadoVerificacion: 'VERIFICADA',
          miembros: { none: { usuarioId, activo: true } },
        },
      },
    };
  }

  private async destinoDisponible(fondoId: string, usuarioId: string): Promise<boolean> {
    return (
      (await this.prisma.fondo.count({
        where: { AND: [{ id: fondoId }, this.condicionDestino(usuarioId)] },
      })) > 0
    );
  }

  // ----- Avisos ------------------------------------------------------------

  private async observar(cierreId: string, observacion: string): Promise<void> {
    await this.prisma.cierreCausa.update({ where: { id: cierreId }, data: { observacion } });
  }

  private async avisarOng(cierre: CierreConFondo, retenido: Prisma.Decimal, ahora: Date) {
    await this.notificarOng(
      cierre,
      `Quedan ${Math.ceil((cierre.venceJustificacionEn.getTime() - ahora.getTime()) / 86_400_000)} días para justificar ${cierre.fondo.nombre}`,
      `El fondo tiene S/ ${soles(retenido)} retenidos. Lo que no se justifique con gastos antes ` +
        `del ${fechaEnLima(cierre.venceJustificacionEn)} vuelve a sus donantes o pasa a la causa ` +
        'que ellos elijan.',
    );
    await this.prisma.cierreCausa.update({ where: { id: cierre.id }, data: { avisoOngEn: ahora } });
  }

  private async avisarResolucion(
    cierre: CierreConFondo,
    resueltos: Array<{ id: string; destino: DestinoRemanente; fondoDestinoId: string | null }>,
    ahora: Date,
    informeId: string,
  ) {
    const filas = await this.prisma.remanenteDonacion.findMany({
      where: { id: { in: resueltos.map((r) => r.id) } },
      include: {
        donacion: { include: { donante: { include: { usuario: true } } } },
        fondoDestino: true,
      },
    });
    const ong = cierre.fondo.campana.ong.nombreComercial ?? cierre.fondo.campana.ong.razonSocial;

    for (const r of filas) {
      await this.notificarDonante(
        r.destino === 'REASIGNACION' ? 'cierre.traslado' : 'cierre.devolucion',
        r.donacion,
        {
          monto: soles(r.monto),
          fondo: cierre.fondo.nombre,
          ong,
          fecha: fechaEnLima(ahora),
          destino: r.fondoDestino?.nombre ?? '',
        },
      );
    }

    await this.notificarOng(
      cierre,
      `Se cerró ${cierre.fondo.nombre}`,
      `La causa quedó resuelta el ${fechaEnLima(ahora)}: ${filas.length} saldo(s) con su ` +
        `destino asentado. El informe de cierre está disponible en Fondos (${informeId}).`,
    );
  }

  private async notificarDonante(
    codigo: 'cierre.eleccion' | 'cierre.devolucion' | 'cierre.traslado',
    donacion: {
      id: string;
      donante: { alias: string | null; usuarioId: string; usuario?: { nombres: string } };
    },
    datos: { monto: string; fondo: string; ong: string; fecha: string; destino: string },
  ) {
    const usuario =
      donacion.donante.usuario ??
      (await this.prisma.usuario.findUniqueOrThrow({ where: { id: donacion.donante.usuarioId } }));
    const { asunto, cuerpo, plantilla } = this.narrativa.redactarCierre(codigo, {
      donante: donacion.donante.alias ?? usuario.nombres,
      ...datos,
    });

    await this.prisma.notificacion.create({
      data: {
        usuarioId: donacion.donante.usuarioId,
        tipo: 'CIERRE_CAUSA',
        canal: 'IN_APP',
        asunto,
        cuerpo,
        narrativa: cuerpo,
        donacionId: donacion.id,
        plantilla,
        // Habla del destino del dinero de esta persona: es transaccional.
        transaccional: true,
        estado: 'ENVIADA',
        enviadaEn: new Date(),
      },
    });
  }

  private async notificarOng(cierre: CierreConFondo, asunto: string, cuerpo: string) {
    const miembros = await this.prisma.ongMiembro.findMany({
      where: { ongId: cierre.fondo.campana.ongId, activo: true },
      select: { usuarioId: true },
    });
    await this.prisma.notificacion.createMany({
      data: miembros.map((m) => ({
        usuarioId: m.usuarioId,
        tipo: 'CIERRE_CAUSA',
        canal: 'IN_APP' as const,
        asunto,
        cuerpo,
        transaccional: true,
        estado: 'ENVIADA' as const,
        enviadaEn: new Date(),
      })),
    });
  }
}
