import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BitacoraService, type ContextoPeticion } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import type { ActualizarCampana, BuscarCausas, CrearCampana, CrearFondo } from './esquemas';
import { soles } from '../../comun/dinero';
import { calcularAvance } from './ongs.service';

/** Fila que devuelve la consulta de busqueda por texto. */
interface FilaBusqueda {
  campana_id: string;
  slug: string;
  titulo: string;
  descripcion: string;
  causa: string;
  imagen_url: string | null;
  departamento: string | null;
  ong_id: string;
  razon_social: string;
  nombre_comercial: string | null;
  puntaje_confianza: Prisma.Decimal;
  verificada: boolean;
  meta_total: Prisma.Decimal;
  recaudado_total: Prisma.Decimal;
  fondos: number;
  relevancia: number;
  total: bigint;
}

@Injectable()
export class CampanasService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly bitacora: BitacoraService,
  ) {}

  /**
   * Verifica que el usuario pueda operar sobre la ONG indicada.
   *
   * Pertenecer a una ONG no basta: el operador de campo registra gastos pero
   * no crea campañas. Comprobarlo aqui evita repetir la condicion en cada
   * metodo y, sobre todo, evita olvidarla en alguno.
   */
  private async exigirMembresia(
    ongId: string,
    usuarioId: string,
    cargos: Array<'ADMINISTRADOR' | 'OPERADOR'> = ['ADMINISTRADOR'],
  ) {
    const membresia = await this.prisma.ongMiembro.findUnique({
      where: { ongId_usuarioId: { ongId, usuarioId } },
      include: { ong: true },
    });

    if (!membresia?.activo) {
      throw new ForbiddenException('No pertenece a esa organizacion.');
    }
    if (!cargos.includes(membresia.cargo)) {
      throw new ForbiddenException(
        'Su cargo en la organizacion no permite esta accion. Solicitela a un administrador.',
      );
    }

    return membresia;
  }

  async crearCampana(
    ongId: string,
    usuarioId: string,
    datos: CrearCampana,
    contexto: ContextoPeticion,
  ) {
    const { ong } = await this.exigirMembresia(ongId, usuarioId);

    if (datos.fechaFin && datos.fechaFin <= datos.fechaInicio) {
      throw new BadRequestException('La fecha de cierre debe ser posterior a la de inicio.');
    }

    const campana = await this.prisma.campana.create({
      data: {
        ongId,
        titulo: datos.titulo,
        slug: await this.generarSlug(datos.titulo),
        descripcion: datos.descripcion,
        causa: datos.causa,
        imagenUrl: datos.imagenUrl,
        departamento: datos.departamento ?? ong.departamento,
        fechaInicio: datos.fechaInicio,
        fechaFin: datos.fechaFin,
        estado: 'BORRADOR',
      },
    });

    await this.bitacora.registrar({
      usuarioId,
      accion: 'CAMPANA_CREADA',
      entidad: 'campanas',
      entidadId: campana.id,
      valorNuevo: { titulo: campana.titulo, ongId },
      ...contexto,
    });

    return campana;
  }

  /**
   * Cambia datos o estado de la campaña.
   *
   * Publicar exige que la ONG este verificada y que la campaña tenga al
   * menos un fondo: una causa sin destino concreto para el dinero seria
   * exactamente la caja negra que el proyecto existe para eliminar.
   */
  async actualizarCampana(
    campanaId: string,
    usuarioId: string,
    datos: ActualizarCampana,
    contexto: ContextoPeticion,
  ) {
    const campana = await this.prisma.campana.findUnique({
      where: { id: campanaId },
      include: { ong: true, fondos: true },
    });
    if (!campana) throw new NotFoundException('No encontramos esa campaña.');

    await this.exigirMembresia(campana.ongId, usuarioId);

    if (datos.estado === 'ACTIVA') {
      if (campana.ong.estadoVerificacion !== 'VERIFICADA') {
        throw new BadRequestException(
          'Su organizacion todavia no esta verificada, asi que la campaña no puede publicarse.',
        );
      }
      if (campana.fondos.length === 0) {
        throw new BadRequestException(
          'Agregue al menos un fondo antes de publicar: el donante necesita saber a que ' +
            'destino concreto va su aporte.',
        );
      }
    }

    const actualizada = await this.prisma.campana.update({
      where: { id: campanaId },
      data: {
        titulo: datos.titulo,
        descripcion: datos.descripcion,
        causa: datos.causa,
        imagenUrl: datos.imagenUrl,
        departamento: datos.departamento,
        fechaInicio: datos.fechaInicio,
        fechaFin: datos.fechaFin,
        estado: datos.estado,
      },
    });

    await this.bitacora.registrarCambio({
      usuarioId,
      accion: 'CAMPANA_ACTUALIZADA',
      entidad: 'campanas',
      entidadId: campanaId,
      antes: { ...campana },
      despues: { ...actualizada },
      campos: ['titulo', 'descripcion', 'causa', 'estado', 'fechaInicio', 'fechaFin'],
      ...contexto,
    });

    return actualizada;
  }

  async crearFondo(
    campanaId: string,
    usuarioId: string,
    datos: CrearFondo,
    contexto: ContextoPeticion,
  ) {
    const campana = await this.prisma.campana.findUnique({ where: { id: campanaId } });
    if (!campana) throw new NotFoundException('No encontramos esa campaña.');

    await this.exigirMembresia(campana.ongId, usuarioId);

    try {
      const fondo = await this.prisma.fondo.create({
        data: {
          campanaId,
          nombre: datos.nombre,
          descripcion: datos.descripcion,
          categoriaGasto: datos.categoriaGasto,
          meta: datos.meta,
        },
      });

      await this.bitacora.registrar({
        usuarioId,
        accion: 'FONDO_CREADO',
        entidad: 'fondos',
        entidadId: fondo.id,
        valorNuevo: {
          nombre: fondo.nombre,
          categoriaGasto: fondo.categoriaGasto,
          meta: soles(fondo.meta),
        },
        ...contexto,
      });

      return fondo;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException(
          'Ya existe un fondo con ese nombre en la campaña. Use un nombre distinto para ' +
            'que el donante pueda diferenciarlos.',
        );
      }
      throw error;
    }
  }

  /** Estado de fondos de una ONG: recaudado, retenido y ejecutado (CU12). */
  async estadoFondos(ongId: string, usuarioId: string) {
    await this.exigirMembresia(ongId, usuarioId, ['ADMINISTRADOR', 'OPERADOR']);

    const campanas = await this.prisma.campana.findMany({
      where: { ongId },
      include: { fondos: { orderBy: { creadoEn: 'asc' } } },
      orderBy: { creadoEn: 'desc' },
    });

    return campanas.map((c) => ({
      id: c.id,
      titulo: c.titulo,
      estado: c.estado,
      fondos: c.fondos.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        categoriaGasto: f.categoriaGasto,
        estado: f.estado,
        meta: soles(f.meta),
        recaudado: soles(f.saldoRecaudado),
        // Lo retenido es lo que la ONG todavia debe justificar con evidencia.
        retenido: soles(f.saldoRetenido),
        ejecutado: soles(f.saldoEjecutado),
        avance: calcularAvance(f.saldoRecaudado.toNumber(), f.meta.toNumber()),
      })),
    }));
  }

  /**
   * Buscador de causas (RF-06, CU02).
   *
   * Usa la columna generada `busqueda` y su indice GIN, en español, de modo
   * que "veterinaria" encuentre "veterinarias" y los acentos no importen.
   * Se escribe en SQL porque Prisma no modela tsvector; los parametros van
   * enlazados, nunca interpolados.
   */
  async buscarCausas(filtros: BuscarCausas) {
    const desplazamiento = (filtros.pagina - 1) * filtros.porPagina;
    const texto = filtros.q?.trim() || null;

    const filas = await this.prisma.$queryRaw<FilaBusqueda[]>`
      WITH candidatas AS (
        SELECT
          c.id                AS campana_id,
          c.slug, c.titulo, c.descripcion, c.causa, c.imagen_url, c.departamento,
          o.id                AS ong_id,
          o.razon_social, o.nombre_comercial, o.puntaje_confianza,
          (o.estado_verificacion = 'VERIFICADA') AS verificada,
          COALESCE(SUM(f.meta), 0)             AS meta_total,
          COALESCE(SUM(f.saldo_recaudado), 0)  AS recaudado_total,
          COUNT(f.id)                          AS fondos,
          CASE
            WHEN ${texto}::text IS NULL THEN 0
            ELSE ts_rank(c.busqueda, plainto_tsquery('spanish', ${texto}::text))
          END AS relevancia
        FROM campanas c
        JOIN ongs o   ON o.id = c.ong_id
        LEFT JOIN fondos f ON f.campana_id = c.id AND f.estado = 'ACTIVO'
        WHERE c.estado = 'ACTIVA'
          AND o.estado_verificacion = 'VERIFICADA'
          AND (${texto}::text IS NULL OR c.busqueda @@ plainto_tsquery('spanish', ${texto}::text))
          AND (${filtros.causa ?? null}::text IS NULL OR c.causa ILIKE ${filtros.causa ?? null}::text)
          AND (${filtros.departamento ?? null}::text IS NULL OR c.departamento ILIKE ${filtros.departamento ?? null}::text)
          AND (${filtros.ongId ?? null}::uuid IS NULL OR o.id = ${filtros.ongId ?? null}::uuid)
          AND (${filtros.puntajeMinimo ?? null}::numeric IS NULL OR o.puntaje_confianza >= ${filtros.puntajeMinimo ?? null}::numeric)
        GROUP BY c.id, o.id
      )
      SELECT *, COUNT(*) OVER () AS total
      FROM candidatas
      WHERE (${filtros.avanceMinimo ?? null}::numeric IS NULL
             OR (meta_total > 0 AND (recaudado_total / meta_total) * 100 >= ${filtros.avanceMinimo ?? null}::numeric))
      ORDER BY
        CASE WHEN ${filtros.orden} = 'relevancia'  THEN relevancia END DESC NULLS LAST,
        CASE WHEN ${filtros.orden} = 'confianza'   THEN puntaje_confianza END DESC NULLS LAST,
        CASE WHEN ${filtros.orden} = 'avance'
             THEN CASE WHEN meta_total > 0 THEN recaudado_total / meta_total ELSE 0 END END DESC NULLS LAST,
        campana_id DESC
      LIMIT ${filtros.porPagina} OFFSET ${desplazamiento}
    `;

    const total = filas.length > 0 ? Number(filas[0].total) : 0;

    return {
      total,
      pagina: filtros.pagina,
      porPagina: filtros.porPagina,
      paginas: Math.ceil(total / filtros.porPagina),
      resultados: filas.map((f) => ({
        id: f.campana_id,
        slug: f.slug,
        titulo: f.titulo,
        descripcion: f.descripcion,
        causa: f.causa,
        imagenUrl: f.imagen_url,
        departamento: f.departamento,
        fondos: Number(f.fondos),
        meta: soles(f.meta_total),
        recaudado: soles(f.recaudado_total),
        avance: calcularAvance(f.recaudado_total.toNumber(), f.meta_total.toNumber()),
        ong: {
          id: f.ong_id,
          nombre: f.nombre_comercial ?? f.razon_social,
          verificada: f.verificada,
          puntajeConfianza: soles(f.puntaje_confianza),
        },
      })),
    };
  }

  /** Ficha publica de una campaña con sus fondos (CU02). */
  async detalleCampana(slug: string) {
    const campana = await this.prisma.campana.findUnique({
      where: { slug },
      include: {
        ong: true,
        fondos: { where: { estado: 'ACTIVO' }, orderBy: { creadoEn: 'asc' } },
      },
    });

    if (!campana || campana.estado !== 'ACTIVA') {
      throw new NotFoundException('No encontramos esa campaña.');
    }

    return {
      id: campana.id,
      slug: campana.slug,
      titulo: campana.titulo,
      descripcion: campana.descripcion,
      causa: campana.causa,
      imagenUrl: campana.imagenUrl,
      departamento: campana.departamento,
      fechaInicio: campana.fechaInicio,
      fechaFin: campana.fechaFin,
      ong: {
        id: campana.ong.id,
        nombre: campana.ong.nombreComercial ?? campana.ong.razonSocial,
        verificada: campana.ong.estadoVerificacion === 'VERIFICADA',
        puntajeConfianza: soles(campana.ong.puntajeConfianza),
        desglosePuntaje: campana.ong.desglosePuntaje,
      },
      fondos: campana.fondos.map((f) => ({
        id: f.id,
        nombre: f.nombre,
        descripcion: f.descripcion,
        categoriaGasto: f.categoriaGasto,
        meta: soles(f.meta),
        recaudado: soles(f.saldoRecaudado),
        // El donante ve cuanto espera evidencia: es el corazon del modelo.
        retenido: soles(f.saldoRetenido),
        ejecutado: soles(f.saldoEjecutado),
        avance: calcularAvance(f.saldoRecaudado.toNumber(), f.meta.toNumber()),
      })),
    };
  }

  /** Slug legible y unico, derivado del titulo. */
  private async generarSlug(titulo: string): Promise<string> {
    const base = titulo
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);

    let candidato = base || 'campana';
    let sufijo = 1;

    while (await this.prisma.campana.findUnique({ where: { slug: candidato } })) {
      sufijo += 1;
      candidato = `${base}-${sufijo}`;
    }

    return candidato;
  }
}
