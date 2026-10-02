import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'node:crypto';

import { BitacoraService, type ContextoPeticion } from '../../comun/bitacora/bitacora.service';
import { soles } from '../../comun/dinero';
import { PrismaService } from '../../comun/prisma/prisma.service';
import type { Anonimizar, RegistrarGasto, UrlSubidaEntrada } from './esquemas';
import {
  calcularDHash,
  calcularNitidez,
  comprimirEvidencia,
  difuminarRegiones,
  distanciaHamming,
  leerMetadatos,
  NITIDEZ_MINIMA,
  UMBRAL_DUPLICADO_PERCEPTUAL,
} from './imagen';
import { ALMACENAMIENTO, type AlmacenamientoArchivos } from './puertos/almacenamiento.port';

@Injectable()
export class GastosService {
  private readonly logger = new Logger(GastosService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly bitacora: BitacoraService,
    @Inject(ALMACENAMIENTO) private readonly almacen: AlmacenamientoArchivos,
  ) {}

  /** Emite una URL firmada para subir un archivo antes de registrar el gasto. */
  async urlDeSubida(usuarioId: string, datos: UrlSubidaEntrada) {
    await this.exigirOperador(usuarioId);
    return this.almacen.emitirUrlSubida({
      carpeta: datos.tipo === 'comprobante' ? 'comprobantes' : 'evidencias',
      extension: datos.extension,
      mime: datos.extension === 'pdf' ? 'application/pdf' : `image/${datos.extension}`,
    });
  }

  /**
   * CU10 · Registrar gasto con comprobante y evidencia.
   *
   * El gasto queda EN_ANALISIS y se encola su verificacion **en la misma
   * transaccion**: asi es imposible que exista un gasto cuyo analisis nunca
   * se encolo, que es la forma en que una cola externa pierde trabajos.
   *
   * La parte de IA (leer el comprobante, reconocer la escena) no ocurre aqui
   * ni en esta version. Lo que si ocurre es todo lo determinista: hashes,
   * huella perceptual, nitidez y rechazo de duplicados exactos.
   */
  async registrar(usuarioId: string, datos: RegistrarGasto, contexto: ContextoPeticion) {
    const fondo = await this.prisma.fondo.findUnique({
      where: { id: datos.fondoId },
      include: { campana: { include: { ong: true } } },
    });
    if (!fondo) throw new NotFoundException('No encontramos ese fondo.');

    await this.exigirMiembroDe(fondo.campana.ongId, usuarioId);

    if (new Prisma.Decimal(datos.montoDeclarado).greaterThan(fondo.saldoRetenido)) {
      throw new BadRequestException(
        `El fondo solo tiene S/ ${soles(fondo.saldoRetenido)} retenidos y el gasto declara ` +
          `S/ ${soles(datos.montoDeclarado)}. No se puede gastar lo que aun no se ha recaudado.`,
      );
    }

    const comprobante = await this.prepararComprobante(datos);
    const evidencias = await this.prepararEvidencias(datos);

    const gasto = await this.prisma.$transaction(async (tx) => {
      const creado = await tx.gasto.create({
        data: {
          fondoId: datos.fondoId,
          ongId: fondo.campana.ongId,
          registradoPor: usuarioId,
          montoDeclarado: datos.montoDeclarado,
          concepto: datos.concepto,
          proveedorNombre: datos.proveedorNombre,
          proveedorRuc: datos.proveedorRuc,
          fechaGasto: datos.fechaGasto,
          // La hora del dispositivo se conserva; la de sincronizacion es ahora.
          capturadoEn: datos.capturadoEn ?? new Date(),
          sincronizadoEn: new Date(),
          latitud: datos.latitud,
          longitud: datos.longitud,
          estado: 'EN_ANALISIS',
          comprobante: { create: comprobante },
          evidencias: { create: evidencias },
        },
        include: { comprobante: true, evidencias: true },
      });

      await tx.trabajoVerificacion.create({ data: { gastoId: creado.id } });

      return creado;
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: 'GASTO_REGISTRADO',
      entidad: 'gastos',
      entidadId: gasto.id,
      valorNuevo: {
        fondoId: datos.fondoId,
        monto: soles(gasto.montoDeclarado),
        comprobante: `${comprobante.tipo} ${comprobante.serie}-${comprobante.numero}`,
        evidencias: evidencias.length,
      },
      ...contexto,
    });

    const requierenAnonimizar = gasto.evidencias.filter(
      (e) => e.contienePersonas && !e.anonimizada,
    );

    return {
      id: gasto.id,
      estado: gasto.estado,
      monto: soles(gasto.montoDeclarado),
      evidencias: gasto.evidencias.map((e) => ({
        id: e.id,
        contienePersonas: e.contienePersonas,
        anonimizada: e.anonimizada,
        nitidez: e.nitidez ? Number(e.nitidez) : null,
        // Aviso temprano: mejor que el operador repita la foto ahora y no
        // que el auditor la rechace dias despues.
        advertencia:
          e.nitidez && Number(e.nitidez) < NITIDEZ_MINIMA
            ? 'La foto parece borrosa. Si puede, tomela de nuevo con mejor luz y pulso.'
            : null,
      })),
      siguientePaso: requierenAnonimizar.length
        ? 'Marque los rostros que deben difuminarse antes de que el donante vea la evidencia.'
        : 'Su gasto esta en analisis. Le avisaremos del resultado.',
    };
  }

  /**
   * Anonimiza una evidencia difuminando las regiones marcadas a mano.
   *
   * Sustituye a la deteccion automatica de rostros de AIni (RF-IA-01). El
   * archivo original se conserva y solo lo ve un auditor; lo que se publica
   * al donante es siempre la version anonimizada.
   */
  async anonimizar(
    evidenciaId: string,
    usuarioId: string,
    datos: Anonimizar,
    contexto: ContextoPeticion,
  ) {
    const evidencia = await this.prisma.evidencia.findUnique({
      where: { id: evidenciaId },
      include: { gasto: true },
    });
    if (!evidencia) throw new NotFoundException('No encontramos esa evidencia.');

    await this.exigirMiembroDe(evidencia.gasto.ongId, usuarioId);

    const original = await this.almacen.leer(evidencia.archivoUrl);
    const difuminada = await difuminarRegiones(original, datos.regiones);

    const objetoAnonimo = evidencia.archivoUrl.replace(/(\.[^.]+)$/, '-anonimizada$1');
    await this.almacen.guardar(objetoAnonimo, difuminada, evidencia.archivoMime);

    const actualizada = await this.prisma.evidencia.update({
      where: { id: evidenciaId },
      data: {
        archivoAnonimizadoUrl: objetoAnonimo,
        anonimizada: true,
        regionesDifuminadas: datos.regiones,
      },
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: 'EVIDENCIA_ANONIMIZADA',
      entidad: 'evidencias',
      entidadId: evidenciaId,
      valorAnterior: { anonimizada: false },
      valorNuevo: { anonimizada: true, regiones: datos.regiones.length },
      ...contexto,
    });

    return {
      id: actualizada.id,
      anonimizada: true,
      regiones: datos.regiones.length,
      urlVistaPrevia: this.almacen.emitirUrlDescarga(objetoAnonimo).url,
    };
  }

  /** Detalle del gasto para la ONG y para el auditor. */
  async detalle(gastoId: string, usuarioId: string, esAuditor: boolean) {
    const gasto = await this.prisma.gasto.findUnique({
      where: { id: gastoId },
      include: {
        comprobante: true,
        evidencias: true,
        fondo: { include: { campana: true } },
        analisis: { orderBy: { creadoEn: 'desc' }, take: 1 },
        alertas: { where: { estado: { in: ['ABIERTA', 'EN_SUBSANACION'] } } },
      },
    });
    if (!gasto) throw new NotFoundException('No encontramos ese gasto.');

    if (!esAuditor) await this.exigirMiembroDe(gasto.ongId, usuarioId);

    const analisis = gasto.analisis[0];

    return {
      id: gasto.id,
      estado: gasto.estado,
      monto: soles(gasto.montoDeclarado),
      montoAprobado: gasto.montoAprobado ? soles(gasto.montoAprobado) : null,
      concepto: gasto.concepto,
      proveedor: gasto.proveedorNombre,
      fechaGasto: gasto.fechaGasto,
      capturadoEn: gasto.capturadoEn,
      fondo: { id: gasto.fondo.id, nombre: gasto.fondo.nombre },
      campana: gasto.fondo.campana.titulo,
      comprobante: gasto.comprobante
        ? {
            tipo: gasto.comprobante.tipo,
            serie: gasto.comprobante.serie,
            numero: gasto.comprobante.numero,
            rucEmisor: gasto.comprobante.rucEmisor,
            total: soles(gasto.comprobante.total),
            validezCpe: gasto.comprobante.validezCpe,
            // Solo el auditor recibe URL del archivo original.
            url: esAuditor
              ? this.almacen.emitirUrlDescarga(gasto.comprobante.archivoUrl).url
              : null,
          }
        : null,
      evidencias: gasto.evidencias.map((e) => ({
        id: e.id,
        tipo: e.tipo,
        contienePersonas: e.contienePersonas,
        anonimizada: e.anonimizada,
        nitidez: e.nitidez ? Number(e.nitidez) : null,
        // El auditor ve el original; cualquier otro rol, solo la anonimizada.
        url: this.urlDeEvidencia(e, esAuditor),
      })),
      analisis: analisis
        ? {
            nivel: analisis.nivel,
            scoreFinal: Number(analisis.scoreFinal),
            explicacion: analisis.explicacion,
            creadoEn: analisis.creadoEn,
          }
        : null,
      alertasAbiertas: gasto.alertas.length,
    };
  }

  /** Gastos de una ONG, para su panel. */
  async listarPorOng(ongId: string, usuarioId: string) {
    await this.exigirMiembroDe(ongId, usuarioId);

    const gastos = await this.prisma.gasto.findMany({
      where: { ongId },
      orderBy: { creadoEn: 'desc' },
      take: 100,
      include: {
        fondo: true,
        analisis: { orderBy: { creadoEn: 'desc' }, take: 1 },
      },
    });

    return gastos.map((g) => {
      const analisis = g.analisis[0];
      const explicacion = analisis?.explicacion as
        | { resumen?: string; motivos?: { resultado?: string; mensaje?: string }[] }
        | undefined;

      return {
        id: g.id,
        estado: g.estado,
        monto: soles(g.montoDeclarado),
        concepto: g.concepto,
        proveedor: g.proveedorNombre,
        fechaGasto: g.fechaGasto,
        fondo: g.fondo.nombre,
        nivel: analisis?.nivel ?? null,
        scoreFinal: analisis ? Number(analisis.scoreFinal) : null,

        // La explicacion tambien va a la ONG, no solo al auditor.
        //
        // Sin esto, el operador ve "OBSERVADO · BAJO 0" y no tiene como saber
        // que corregir: la explicacion existe, la exige el RNF-09, y se quedaba
        // del lado de quien audita en vez de llegar a quien tiene que subsanar.
        //
        // Solo viajan los motivos que piden accion. Los "ok" son utiles para
        // auditar una decision, pero aqui multiplicarian por diez el tamaño de
        // una lista de cien gastos sin decirle nada nuevo a quien la lee.
        resumen: explicacion?.resumen ?? null,
        observaciones:
          explicacion?.motivos
            ?.filter((m) => m.resultado !== 'ok')
            .map((m) => m.mensaje)
            .filter((m): m is string => Boolean(m)) ?? [],
      };
    });
  }

  // -------------------------------------------------------------------------

  private async prepararComprobante(datos: RegistrarGasto) {
    const contenido = await this.almacen.leer(datos.comprobante.objeto);
    const hashSha256 = createHash('sha256').update(contenido).digest('hex');

    // Rechazo inmediato de duplicado exacto: no hace falta esperar al motor
    // para saber que este archivo ya se uso.
    const repetido = await this.prisma.comprobante.findUnique({ where: { hashSha256 } });
    if (repetido) {
      throw new BadRequestException(
        'Ese archivo de comprobante ya fue presentado en otro gasto. Si es un gasto ' +
          'distinto, adjunte el comprobante que le corresponde.',
      );
    }

    const mismoNumero = await this.prisma.comprobante.findFirst({
      where: {
        rucEmisor: datos.comprobante.rucEmisor,
        tipo: datos.comprobante.tipo,
        serie: datos.comprobante.serie,
        numero: datos.comprobante.numero,
      },
    });
    if (mismoNumero) {
      throw new BadRequestException(
        `El comprobante ${datos.comprobante.serie}-${datos.comprobante.numero} del RUC ` +
          `${datos.comprobante.rucEmisor} ya fue registrado.`,
      );
    }

    return {
      tipo: datos.comprobante.tipo,
      rucEmisor: datos.comprobante.rucEmisor,
      razonSocialEmisor: datos.comprobante.razonSocialEmisor,
      serie: datos.comprobante.serie.toUpperCase(),
      numero: datos.comprobante.numero,
      fechaEmision: datos.comprobante.fechaEmision,
      subtotal: datos.comprobante.subtotal,
      igv: datos.comprobante.igv,
      total: datos.comprobante.total,
      archivoUrl: datos.comprobante.objeto,
      archivoMime: datos.comprobante.mime,
      archivoBytes: contenido.byteLength,
      hashSha256,
    };
  }

  private async prepararEvidencias(datos: RegistrarGasto) {
    const preparadas = [];

    for (const evidencia of datos.evidencias) {
      const contenido = await this.almacen.leer(evidencia.objeto);
      const esImagen = evidencia.mime.startsWith('image/');

      let hashPerceptual: string | null = null;
      let nitidez: number | null = null;
      let ancho: number | null = null;
      let alto: number | null = null;
      let exifCapturadoEn: Date | null = null;
      let guardado = contenido;

      if (esImagen) {
        guardado = await comprimirEvidencia(contenido);
        await this.almacen.guardar(evidencia.objeto, guardado, 'image/jpeg');

        const meta = await leerMetadatos(contenido);
        ancho = meta.ancho;
        alto = meta.alto;
        exifCapturadoEn = meta.capturadaEn;
        hashPerceptual = await calcularDHash(guardado);
        nitidez = await calcularNitidez(guardado);

        await this.rechazarSiEsReutilizada(hashPerceptual);
      }

      const hashSha256 = createHash('sha256').update(guardado).digest('hex');

      preparadas.push({
        tipo: evidencia.tipo,
        archivoUrl: evidencia.objeto,
        archivoMime: esImagen ? 'image/jpeg' : evidencia.mime,
        archivoBytes: guardado.byteLength,
        ancho,
        alto,
        hashSha256,
        hashPerceptual,
        nitidez,
        exifCapturadoEn,
        latitud: evidencia.latitud,
        longitud: evidencia.longitud,
        contienePersonas: evidencia.contienePersonas,
        consentimientoImagen: evidencia.consentimientoImagen,
        // Sin personas no hay nada que anonimizar: la evidencia ya es
        // publicable y la restriccion de la base se satisface.
        anonimizada: !evidencia.contienePersonas,
      });
    }

    return preparadas;
  }

  /**
   * RF-IA-05 · Detecta una evidencia reutilizada, sin IA.
   *
   * Compara la huella perceptual contra todo el historico. Cambiar el tamaño
   * o recomprimir una foto destruye su SHA-256 pero apenas mueve el dHash,
   * asi que esta comparacion atrapa reciclajes que el hash exacto no ve.
   *
   * Se consulta con una funcion de la base para no traer el historico
   * completo a memoria: la comparacion de bits ocurre en PostgreSQL.
   */
  private async rechazarSiEsReutilizada(hashPerceptual: string): Promise<void> {
    const candidatas = await this.prisma.$queryRaw<
      { id: string; hash_perceptual: string; gasto_id: string }[]
    >`
      SELECT id, hash_perceptual, gasto_id
        FROM evidencias
       WHERE hash_perceptual IS NOT NULL
       ORDER BY creado_en DESC
       LIMIT 5000
    `;

    for (const candidata of candidatas) {
      if (distanciaHamming(hashPerceptual, candidata.hash_perceptual) < UMBRAL_DUPLICADO_PERCEPTUAL) {
        throw new BadRequestException(
          'Esa imagen ya se presento como evidencia de otro gasto, aunque se haya ' +
            'recortado o vuelto a guardar. Adjunte una foto de este gasto en particular.',
        );
      }
    }
  }

  private urlDeEvidencia(
    evidencia: { archivoUrl: string; archivoAnonimizadoUrl: string | null; anonimizada: boolean },
    esAuditor: boolean,
  ): string | null {
    if (esAuditor) return this.almacen.emitirUrlDescarga(evidencia.archivoUrl).url;
    if (evidencia.archivoAnonimizadoUrl) {
      return this.almacen.emitirUrlDescarga(evidencia.archivoAnonimizadoUrl).url;
    }
    // Sin personas, el original ya es la version publicable.
    return evidencia.anonimizada ? this.almacen.emitirUrlDescarga(evidencia.archivoUrl).url : null;
  }

  private async exigirMiembroDe(ongId: string, usuarioId: string) {
    const membresia = await this.prisma.ongMiembro.findUnique({
      where: { ongId_usuarioId: { ongId, usuarioId } },
    });
    if (!membresia?.activo) {
      throw new ForbiddenException('No pertenece a esa organizacion.');
    }
    return membresia;
  }

  private async exigirOperador(usuarioId: string) {
    const membresias = await this.prisma.ongMiembro.count({
      where: { usuarioId, activo: true },
    });
    if (membresias === 0) {
      throw new ForbiddenException('Solo los miembros de una ONG pueden registrar gastos.');
    }
  }
}
