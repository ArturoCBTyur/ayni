import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BitacoraService, type ContextoPeticion } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { soles } from '../../comun/dinero';
import type { Constancia } from './constancia';
import { LibroService } from '../contable/libro.service';
import { urlPublicable } from '../gastos/evidencia-publica';
import { ALMACENAMIENTO, type AlmacenamientoArchivos } from '../gastos/puertos/almacenamiento.port';
import type { CambiarSuscripcion, Donar, EventoWebhookEntrada, Suscribir } from './esquemas';
import { PASARELA_PAGO, type PasarelaPago } from './puertos/pasarela-pago.port';

@Injectable()
export class DonacionesService {
  private readonly logger = new Logger(DonacionesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly libro: LibroService,
    private readonly bitacora: BitacoraService,
    @Inject(PASARELA_PAGO) private readonly pasarela: PasarelaPago,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoArchivos,
  ) {}

  /**
   * CU03 · Donar a un fondo especifico.
   *
   * La donacion nace PENDIENTE y **no toca el libro todavia**. Solo cuando la
   * pasarela confirma el cobro por webhook se asientan los movimientos. Es
   * deliberado: asentar un ingreso que despues resulta rechazado obligaria a
   * revertirlo, y el libro es de solo insercion.
   */
  async donar(usuarioId: string, datos: Donar, contexto: ContextoPeticion) {
    const donante = await this.prisma.donante.findUnique({ where: { usuarioId } });
    if (!donante) {
      throw new ForbiddenException('Complete su perfil de donante antes de aportar.');
    }

    const fondo = await this.prisma.fondo.findUnique({
      where: { id: datos.fondoId },
      include: { campana: { include: { ong: true } } },
    });

    this.exigirFondoDisponible(fondo);
    await this.exigirSinConflictoDeInteres(usuarioId, fondo!.campana.ongId);

    const usuario = await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });

    const donacion = await this.prisma.donacion.create({
      data: {
        donanteId: donante.id,
        fondoId: datos.fondoId,
        monto: datos.monto,
        // El neto real lo fija la comision que informe la pasarela.
        montoNeto: 0,
        anonima: datos.anonima || donante.anonimoPorDefecto,
        mensaje: datos.mensaje,
        estado: 'PENDIENTE',
      },
    });

    const cobro = await this.pasarela.cobrar({
      referenciaInterna: donacion.id,
      monto: datos.monto,
      moneda: 'PEN',
      descripcion: `Donacion a ${fondo!.nombre}`,
      tokenTarjeta: datos.tokenTarjeta,
      correoPagador: usuario.correo,
    });

    await this.prisma.pago.create({
      data: {
        donacionId: donacion.id,
        pasarela: this.pasarela.nombre,
        referenciaExterna: cobro.referenciaExterna,
        // Se guarda el token, nunca el numero de tarjeta (RNF-04).
        tokenTarjeta: datos.tokenTarjeta,
        monto: datos.monto,
        comision: cobro.comision,
        montoNeto: cobro.montoNeto,
        estado: 'PENDIENTE',
        metodo: cobro.metodo,
        ultimos4: cobro.ultimos4,
        marca: cobro.marca,
      },
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: 'DONACION_INICIADA',
      entidad: 'donaciones',
      entidadId: donacion.id,
      valorNuevo: {
        fondoId: datos.fondoId,
        monto: soles(donacion.monto),
        referenciaExterna: cobro.referenciaExterna,
      },
      ...contexto,
    });

    return {
      donacionId: donacion.id,
      estado: donacion.estado,
      monto: soles(donacion.monto),
      comisionEstimada: cobro.comision.toFixed(2),
      montoNetoEstimado: cobro.montoNeto.toFixed(2),
      referenciaExterna: cobro.referenciaExterna,
      mensaje:
        'Estamos confirmando su pago con la pasarela. En cuanto se acredite, su aporte ' +
        'quedara retenido en el fondo hasta que la organizacion demuestre el gasto.',
    };
  }

  /**
   * Procesa un evento de la pasarela.
   *
   * Dos garantias que un webhook necesita siempre: idempotencia, porque las
   * pasarelas reintentan y un mismo evento puede llegar varias veces; y
   * atomicidad, porque confirmar el pago y asentar el libro tienen que
   * ocurrir juntos o no ocurrir.
   */
  async procesarWebhook(evento: EventoWebhookEntrada) {
    const pago = await this.prisma.pago.findUnique({
      where: { referenciaExterna: evento.referenciaExterna },
      include: { donacion: { include: { fondo: true } } },
    });

    if (!pago) {
      // Se responde 200 igual: un 404 haria que la pasarela reintente para
      // siempre un cargo que no nos pertenece.
      this.logger.warn(`Webhook de un cargo desconocido: ${evento.referenciaExterna}`);
      return { procesado: false, motivo: 'referencia desconocida' };
    }

    // Descarte temprano, para no abrir una transaccion por cada reintento de
    // la pasarela. No es la guarda que protege: esa esta dentro de la
    // transaccion, porque esta lectura puede quedar vieja.
    if (pago.eventoIdempotencia === evento.eventoId) {
      return { procesado: false, motivo: 'evento ya aplicado' };
    }

    if (pago.estado !== 'PENDIENTE') {
      return { procesado: false, motivo: `el pago ya estaba en estado ${pago.estado}` };
    }

    if (evento.tipo === 'cargo.rechazado') {
      await this.prisma.$transaction([
        this.prisma.pago.update({
          where: { id: pago.id },
          data: {
            estado: 'RECHAZADO',
            eventoIdempotencia: evento.eventoId,
            motivoRechazo: evento.motivoRechazo,
            payload: { ...evento },
            procesadoEn: new Date(),
          },
        }),
        this.prisma.donacion.update({
          where: { id: pago.donacionId },
          data: { estado: 'FALLIDA' },
        }),
      ]);

      return { procesado: true, estado: 'RECHAZADO' };
    }

    // Aprobado: confirmar la donacion y asentar el libro en una sola
    // transaccion SERIALIZABLE, para que dos webhooks simultaneos del mismo
    // cargo no puedan duplicar los asientos.
    const resultado = await this.prisma.enTransaccionSerializable(async (tx) => {
      // Se relee el pago aqui adentro, y no se reutiliza el de arriba, por dos
      // razones que son la misma: otro webhook del mismo cargo pudo resolverlo
      // entre la lectura y esta transaccion, y si esta transaccion se reintenta
      // por un conflicto de serializacion, el dato de afuera ya no describe la
      // base. Sin esta relectura, el reintento asentaria el ingreso dos veces.
      const actual = await tx.pago.findUniqueOrThrow({ where: { id: pago.id } });

      if (actual.eventoIdempotencia === evento.eventoId) {
        return { yaResuelto: 'evento ya aplicado' };
      }
      if (actual.estado !== 'PENDIENTE') {
        return { yaResuelto: `el pago ya estaba en estado ${actual.estado}` };
      }

      const { neto } = await this.libro.asentarIngresoDonacion(tx, {
        fondoId: pago.donacion.fondoId,
        donacionId: pago.donacionId,
        montoBruto: evento.monto,
        comision: evento.comision,
      });

      await tx.pago.update({
        where: { id: pago.id },
        data: {
          estado: 'APROBADO',
          comision: evento.comision,
          montoNeto: neto,
          eventoIdempotencia: evento.eventoId,
          metodo: evento.metodo,
          ultimos4: evento.ultimos4,
          marca: evento.marca,
          payload: { ...evento },
          procesadoEn: new Date(),
        },
      });

      await tx.donacion.update({
        where: { id: pago.donacionId },
        data: { estado: 'CONFIRMADA', montoNeto: neto, confirmadaEn: new Date() },
      });

      return { neto };
    });

    if ('yaResuelto' in resultado) {
      return { procesado: false, motivo: resultado.yaResuelto };
    }

    await this.bitacora.registrar({
      accion: 'DONACION_CONFIRMADA',
      entidad: 'donaciones',
      entidadId: pago.donacionId,
      valorAnterior: { estado: 'PENDIENTE' },
      valorNuevo: {
        estado: 'CONFIRMADA',
        montoNeto: soles(resultado.neto),
        eventoId: evento.eventoId,
      },
    });

    return { procesado: true, estado: 'APROBADO', montoNeto: soles(resultado.neto) };
  }

  /** CU04 · Suscripcion mensual a un fondo. */
  async suscribir(usuarioId: string, datos: Suscribir, contexto: ContextoPeticion) {
    const donante = await this.prisma.donante.findUnique({ where: { usuarioId } });
    if (!donante) {
      throw new ForbiddenException('Complete su perfil de donante antes de aportar.');
    }

    const fondo = await this.prisma.fondo.findUnique({
      where: { id: datos.fondoId },
      include: { campana: { include: { ong: true } } },
    });
    this.exigirFondoDisponible(fondo);
    await this.exigirSinConflictoDeInteres(usuarioId, fondo!.campana.ongId);

    const activa = await this.prisma.suscripcion.findFirst({
      where: { donanteId: donante.id, fondoId: datos.fondoId, estado: 'ACTIVA' },
    });
    if (activa) {
      throw new BadRequestException('Ya tiene una donacion recurrente activa para ese fondo.');
    }

    const suscripcion = await this.prisma.suscripcion.create({
      data: {
        donanteId: donante.id,
        fondoId: datos.fondoId,
        ongId: fondo!.campana.ongId,
        monto: datos.monto,
        diaCobro: datos.diaCobro,
        tokenPago: datos.tokenTarjeta,
        proximoCobroEn: this.proximoCobro(datos.diaCobro),
        estado: 'ACTIVA',
      },
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: 'SUSCRIPCION_CREADA',
      entidad: 'suscripciones',
      entidadId: suscripcion.id,
      valorNuevo: { fondoId: datos.fondoId, monto: soles(suscripcion.monto) },
      ...contexto,
    });

    return {
      id: suscripcion.id,
      monto: soles(suscripcion.monto),
      diaCobro: suscripcion.diaCobro,
      proximoCobroEn: suscripcion.proximoCobroEn,
      estado: suscripcion.estado,
    };
  }

  /**
   * Pausar, reanudar o cancelar una suscripcion (RF-08).
   *
   * El entregable pide que se pueda hacer en un clic. Poner trabas a
   * cancelar una donacion recurrente erosiona justamente la confianza que el
   * proyecto quiere construir.
   */
  async cambiarSuscripcion(
    suscripcionId: string,
    usuarioId: string,
    datos: CambiarSuscripcion,
    contexto: ContextoPeticion,
  ) {
    const suscripcion = await this.prisma.suscripcion.findUnique({
      where: { id: suscripcionId },
      include: { donante: true },
    });

    if (!suscripcion || suscripcion.donante.usuarioId !== usuarioId) {
      throw new NotFoundException('No encontramos esa donacion recurrente.');
    }
    if (suscripcion.estado === 'CANCELADA') {
      throw new BadRequestException('Esa donacion recurrente ya estaba cancelada.');
    }

    const ahora = new Date();
    const cambios = {
      PAUSAR: { estado: 'PAUSADA' as const, pausadaEn: ahora },
      REANUDAR: {
        estado: 'ACTIVA' as const,
        pausadaEn: null,
        proximoCobroEn: this.proximoCobro(suscripcion.diaCobro),
      },
      CANCELAR: { estado: 'CANCELADA' as const, canceladaEn: ahora },
    }[datos.accion];

    const actualizada = await this.prisma.suscripcion.update({
      where: { id: suscripcionId },
      data: cambios,
    });

    if (datos.accion === 'CANCELAR') {
      await this.pasarela.cancelarSuscripcion(suscripcion.tokenPago);
    }

    await this.bitacora.registrar({
      usuarioId,
      accion: `SUSCRIPCION_${datos.accion}`,
      entidad: 'suscripciones',
      entidadId: suscripcionId,
      valorAnterior: { estado: suscripcion.estado },
      valorNuevo: { estado: actualizada.estado },
      ...contexto,
    });

    return { id: actualizada.id, estado: actualizada.estado };
  }

  /**
   * RF-13 · Historial del donante con la linea de tiempo de cada aporte.
   *
   * Los estados son los de RF-PS-01, en el lenguaje del donante y no en el
   * del modelo de datos: lo que reduce la incertidumbre es entender en que
   * punto esta su dinero, no conocer el nombre del enum.
   */
  async historial(usuarioId: string) {
    const donante = await this.prisma.donante.findUnique({ where: { usuarioId } });
    if (!donante) return { total: 0, donaciones: [] };

    const donaciones = await this.prisma.donacion.findMany({
      where: { donanteId: donante.id },
      orderBy: { creadoEn: 'desc' },
      include: {
        fondo: { include: { campana: { include: { ong: true } } } },
        pago: true,
        aplicaciones: { include: { gasto: true } },
        remanente: { include: { fondoDestino: true } },
        donacionOrigen: { include: { fondo: true } },
      },
    });

    return {
      total: donaciones.length,
      donaciones: donaciones.map((d) => {
        const aplicado = d.aplicaciones.reduce(
          (suma, a) => suma.plus(a.monto),
          new Prisma.Decimal(0),
        );
        const verificado = d.aplicaciones.filter((a) => a.gasto.estado === 'APROBADO').length;

        return {
          id: d.id,
          fecha: d.creadoEn,
          monto: soles(d.monto),
          montoNeto: soles(d.montoNeto),
          comision: d.pago ? soles(d.pago.comision) : '0.00',
          anonima: d.anonima,
          fondo: { id: d.fondo.id, nombre: d.fondo.nombre },
          campana: { titulo: d.fondo.campana.titulo, slug: d.fondo.campana.slug },
          ong: d.fondo.campana.ong.nombreComercial ?? d.fondo.campana.ong.razonSocial,
          estado: this.estadoParaDonante(d.estado, aplicado, d.montoNeto, verificado),
          montoAplicado: soles(aplicado),
          montoEsperandoEvidencia: soles(esperandoEvidencia(d.montoNeto, aplicado, d.remanente)),
          gastosFinanciados: d.aplicaciones.length,
          ...destinoDelSaldo(d),
        };
      }),
    };
  }

  /**
   * RF-13 · Un aporte por dentro: en que gastos se uso, cuanto de el en cada
   * uno, y la evidencia de cada gasto.
   *
   * El historial dice "financio 2 gastos"; esto dice cuales. Las fotos son
   * siempre la version publicable, y del comprobante va su identificacion,
   * no el archivo: es un documento de la ONG.
   */
  /**
   * RF-DE-07 · Constancia de una donacion confirmada, solo para su donante.
   *
   * Si la ONG estaba calificada como perceptora en la fecha de la donacion,
   * lo dice con su resolucion. Una calificacion posterior o vencida no se
   * aplica hacia atras.
   */
  async constancia(donacionId: string, usuarioId: string): Promise<Constancia> {
    const d = await this.prisma.donacion.findUnique({
      where: { id: donacionId },
      include: {
        donante: { include: { usuario: true } },
        pago: true,
        fondo: { include: { campana: { include: { ong: true } } } },
        aplicaciones: true,
        remanente: { include: { fondoDestino: true } },
        donacionOrigen: { include: { fondo: true } },
      },
    });
    if (!d || d.donante.usuarioId !== usuarioId) {
      throw new NotFoundException('No encontramos ese aporte.');
    }
    if (d.estado !== 'CONFIRMADA' || !d.confirmadaEn) {
      throw new BadRequestException(
        'La constancia se emite cuando el pago esta confirmado; este aporte todavia no lo esta.',
      );
    }

    const ong = d.fondo.campana.ong;
    const fecha = d.confirmadaEn;
    const vigente =
      ong.perceptoraDonaciones &&
      ong.perceptoraDesde !== null &&
      ong.perceptoraDesde <= fecha &&
      (ong.perceptoraHasta === null || fecha <= ong.perceptoraHasta);
    const aplicado = d.aplicaciones.reduce((t, a) => t.plus(a.monto), new Prisma.Decimal(0));
    const documento =
      d.donante.documentoTipo && d.donante.documentoNumero
        ? `${d.donante.documentoTipo} ${d.donante.documentoNumero}`
        : null;

    return {
      numero: `AYNI-${fecha.getUTCFullYear()}-${d.id.slice(0, 8).toUpperCase()}`,
      emitidaEn: new Date(),
      donatario: {
        razonSocial: ong.razonSocial,
        ruc: ong.ruc,
        direccion: ong.direccion,
        perceptora: vigente
          ? {
              resolucion: ong.perceptoraResolucion!,
              desde: ong.perceptoraDesde!,
              hasta: ong.perceptoraHasta,
            }
          : null,
      },
      donante: { nombre: `${d.donante.usuario.nombres} ${d.donante.usuario.apellidos}`, documento },
      donacion: {
        id: d.id,
        fecha,
        monto: soles(d.monto),
        comision: d.pago ? soles(d.pago.comision) : '0.00',
        neto: soles(d.montoNeto),
        medio: d.pago
          ? `${d.pago.marca ?? 'Tarjeta'} terminada en ${d.pago.ultimos4 ?? '----'}`
          : 'Traslado del saldo de un aporte anterior',
        referencia: d.pago?.referenciaExterna ?? null,
        fondo: d.fondo.nombre,
        campana: d.fondo.campana.titulo,
        trasladadaDesde: d.donacionOrigen?.fondo.nombre ?? null,
      },
      destino: {
        aplicado: soles(aplicado),
        esperandoEvidencia: soles(esperandoEvidencia(d.montoNeto, aplicado, d.remanente)),
        saldoDeCierre: d.remanente?.resueltoEn
          ? d.remanente.destino === 'DEVOLUCION'
            ? `S/ ${soles(d.remanente.monto)} devueltos`
            : `S/ ${soles(d.remanente.monto)} trasladados a ${d.remanente.fondoDestino?.nombre}`
          : null,
      },
    };
  }

  async detalle(donacionId: string, usuarioId: string) {
    const donacion = await this.prisma.donacion.findUnique({
      where: { id: donacionId },
      include: {
        donante: true,
        pago: true,
        fondo: { include: { campana: { include: { ong: true } } } },
        aplicaciones: {
          orderBy: { creadoEn: 'asc' },
          include: { gasto: { include: { comprobante: true, evidencias: true } } },
        },
        remanente: { include: { fondoDestino: true } },
        donacionOrigen: { include: { fondo: true } },
      },
    });

    // Un aporte ajeno se responde igual que uno inexistente: no se confirma
    // que exista.
    if (!donacion || donacion.donante.usuarioId !== usuarioId) {
      throw new NotFoundException('No encontramos ese aporte.');
    }

    const aplicado = donacion.aplicaciones.reduce(
      (suma, a) => suma.plus(a.monto),
      new Prisma.Decimal(0),
    );
    const verificados = donacion.aplicaciones.filter((a) => a.gasto.estado === 'APROBADO').length;

    return {
      id: donacion.id,
      fecha: donacion.creadoEn,
      monto: soles(donacion.monto),
      montoNeto: soles(donacion.montoNeto),
      comision: donacion.pago ? soles(donacion.pago.comision) : '0.00',
      anonima: donacion.anonima,
      estado: this.estadoParaDonante(donacion.estado, aplicado, donacion.montoNeto, verificados),
      fondo: { id: donacion.fondo.id, nombre: donacion.fondo.nombre },
      campana: { titulo: donacion.fondo.campana.titulo, slug: donacion.fondo.campana.slug },
      ong: donacion.fondo.campana.ong.nombreComercial ?? donacion.fondo.campana.ong.razonSocial,
      montoAplicado: soles(aplicado),
      montoEsperandoEvidencia: soles(
        esperandoEvidencia(donacion.montoNeto, aplicado, donacion.remanente),
      ),
      ...destinoDelSaldo(donacion),
      aplicaciones: donacion.aplicaciones.map((a) => ({
        monto: soles(a.monto),
        aplicadoEn: a.creadoEn,
        gasto: {
          id: a.gasto.id,
          concepto: a.gasto.concepto,
          proveedor: a.gasto.proveedorNombre,
          fechaGasto: a.gasto.fechaGasto,
          estado: a.gasto.estado,
          total: soles(a.gasto.montoAprobado ?? a.gasto.montoDeclarado),
          comprobante: a.gasto.comprobante
            ? `${a.gasto.comprobante.tipo} ${a.gasto.comprobante.serie}-${a.gasto.comprobante.numero}`
            : null,
          evidencias: a.gasto.evidencias
            .map((e) => urlPublicable(this.almacen, e))
            .filter((url): url is string => url !== null),
        },
      })),
    };
  }

  async misSuscripciones(usuarioId: string) {
    const donante = await this.prisma.donante.findUnique({ where: { usuarioId } });
    if (!donante) return [];

    const filas = await this.prisma.suscripcion.findMany({
      where: { donanteId: donante.id, estado: { not: 'CANCELADA' } },
      include: { fondo: { include: { campana: true } } },
      orderBy: { creadoEn: 'desc' },
    });

    return filas.map((s) => ({
      id: s.id,
      monto: soles(s.monto),
      estado: s.estado,
      diaCobro: s.diaCobro,
      proximoCobroEn: s.estado === 'ACTIVA' ? s.proximoCobroEn : null,
      fondo: s.fondo ? { id: s.fondo.id, nombre: s.fondo.nombre } : null,
      campana: s.fondo?.campana.titulo ?? null,
    }));
  }

  /** RF-PS-01 · Donado, Retenido, En verificacion, Ejecutado, Verificado. */
  private estadoParaDonante(
    estado: string,
    aplicado: Prisma.Decimal,
    neto: Prisma.Decimal,
    gastosVerificados: number,
  ): { codigo: string; etiqueta: string; descripcion: string } {
    if (estado === 'PENDIENTE') {
      return {
        codigo: 'DONADO',
        etiqueta: 'Confirmando el pago',
        descripcion: 'Estamos confirmando el cobro con la pasarela.',
      };
    }
    if (estado === 'FALLIDA') {
      return {
        codigo: 'FALLIDA',
        etiqueta: 'Pago rechazado',
        descripcion: 'El cobro no se completo. No se le hizo ningun cargo.',
      };
    }
    if (estado === 'REVERSADA') {
      return {
        codigo: 'REVERSADA',
        etiqueta: 'Devuelta',
        descripcion: 'La donacion fue revertida.',
      };
    }
    if (aplicado.isZero()) {
      return {
        codigo: 'RETENIDO',
        etiqueta: 'Retenido: esperando evidencia',
        descripcion:
          'Su aporte esta reservado para este fondo. La organizacion aun no lo ha usado, ' +
          'y no podra hacerlo sin comprobante y evidencia.',
      };
    }
    if (aplicado.lessThan(neto)) {
      return {
        codigo: 'PARCIAL',
        etiqueta: 'Parcialmente ejecutado',
        descripcion: `Parte de su aporte ya financio ${gastosVerificados} gasto(s) verificado(s); el resto sigue retenido.`,
      };
    }
    return {
      codigo: 'VERIFICADO',
      etiqueta: 'Ejecutado y verificado',
      descripcion: 'Todo su aporte financio gastos con comprobante y evidencia verificados.',
    };
  }

  private exigirFondoDisponible(
    fondo: { estado: string; campana: { estado: string; ong: { estadoVerificacion: string } } } | null,
  ): void {
    if (!fondo) throw new NotFoundException('No encontramos ese fondo.');

    if (fondo.campana.ong.estadoVerificacion !== 'VERIFICADA') {
      throw new BadRequestException(
        'Esa organizacion no esta verificada, asi que no puede recibir donaciones.',
      );
    }
    if (fondo.campana.estado !== 'ACTIVA') {
      throw new BadRequestException('Esa campaña no esta recibiendo aportes en este momento.');
    }
    if (fondo.estado !== 'ACTIVO') {
      throw new BadRequestException('Ese fondo esta cerrado. Elija otro destino de la campaña.');
    }
  }

  /**
   * Quien trabaja en una ONG no dona a esa misma ONG.
   *
   * No es una regla de cortesia: el que registra los gastos de un fondo y a
   * la vez lo financia puede inflar la recaudacion de su propia campaña, y
   * su aporte se mezcla en el FIFO con el de donantes que no la conocen por
   * dentro. A otras organizaciones si puede donar, si tiene rol de donante.
   */
  private async exigirSinConflictoDeInteres(usuarioId: string, ongId: string): Promise<void> {
    const miembro = await this.prisma.ongMiembro.findFirst({
      where: { usuarioId, ongId, activo: true },
      select: { id: true },
    });
    if (miembro) {
      throw new ForbiddenException(
        'No puede donar a una organizacion de la que es miembro. Puede aportar a las causas ' +
          'de otras organizaciones.',
      );
    }
  }

  /** Proximo cobro: el dia indicado del mes siguiente. */
  private proximoCobro(dia: number): Date {
    const fecha = new Date();
    fecha.setMonth(fecha.getMonth() + 1, dia);
    fecha.setHours(9, 0, 0, 0);
    return fecha;
  }
}

/**
 * D2 · Lo que de un aporte todavia espera evidencia. Si su causa cerro y el
 * saldo ya salio (devuelto o trasladado), ese saldo no espera nada aqui: se
 * devolvio, o espera en el fondo de destino, como otra donacion.
 */
function esperandoEvidencia(
  neto: Prisma.Decimal,
  aplicado: Prisma.Decimal,
  remanente: { monto: Prisma.Decimal; resueltoEn: Date | null } | null,
): Prisma.Decimal {
  const salio = remanente?.resueltoEn ? remanente.monto : new Prisma.Decimal(0);
  return Prisma.Decimal.max(neto.minus(aplicado).minus(salio), 0);
}

/** D2 · De donde vino un aporte trasladado, y a donde fue el saldo de uno cerrado. */
function destinoDelSaldo(d: {
  remanente: {
    monto: Prisma.Decimal;
    destino: string | null;
    resueltoEn: Date | null;
    fondoDestino: { id: string; nombre: string } | null;
  } | null;
  donacionOrigen: { id: string; fondo: { nombre: string } } | null;
}) {
  return {
    saldoDeCierre: d.remanente
      ? {
          monto: soles(d.remanente.monto),
          destino: d.remanente.destino,
          resuelto: d.remanente.resueltoEn !== null,
          fondoDestino: d.remanente.fondoDestino
            ? { id: d.remanente.fondoDestino.id, nombre: d.remanente.fondoDestino.nombre }
            : null,
        }
      : null,
    trasladadoDesde: d.donacionOrigen
      ? { donacionId: d.donacionOrigen.id, fondo: d.donacionOrigen.fondo.nombre }
      : null,
  };
}
