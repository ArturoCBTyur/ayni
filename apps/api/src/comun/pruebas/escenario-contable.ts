/**
 * Escenario contable para las pruebas: una ONG con su fondo, un donante y un
 * operador, y la manera de asentar donaciones y gastos en una fecha dada.
 *
 * Los estados mensuales se arman por periodo, y probarlos exige movimientos
 * en meses distintos. LibroService no acepta una fecha (en la aplicacion la
 * pone la base), asi que aqui se asienta con los mismos ASIENTOS y los mismos
 * pasos que LibroService y AplicacionFifoService, mas la fecha. El trigger de
 * encadenamiento corre igual: la secuencia y los hashes los sigue poniendo la
 * base.
 *
 * Fuera de dist/ por tsconfig.build.json: limpiar() apaga el trigger que
 * impide borrar movimientos del libro.
 */
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';

import { ASIENTOS } from '../../modules/contable/cuentas';
import type { PrismaService } from '../prisma/prisma.service';

export interface EscenarioContable {
  marca: string;
  ongId: string;
  ruc: string;
  campanaId: string;
  fondoId: string;
  donanteId: string;
  donanteUsuarioId: string;
  operadorId: string;
  /** Cuentas creadas por el escenario, para que la suite agregue las suyas. */
  usuarios: string[];
  /** Donacion confirmada con su pago y sus tres asientos. */
  donar(monto: number, comision: number, en?: Date): Promise<string>;
  /** Gasto aprobado por un analisis ALTO, aplicado FIFO y ejecutado. */
  gastoAprobado(monto: number, en?: Date): Promise<string>;
  /** Saca de lo retenido un monto hacia otro destino (REASIGNACION). */
  reasignar(monto: number, en?: Date): Promise<string>;
  limpiar(): Promise<void>;
}

export async function crearEscenarioContable(
  prisma: PrismaService,
  etiqueta: string,
): Promise<EscenarioContable> {
  const marca = randomUUID().slice(0, 8);
  const usuarios: string[] = [];
  let contador = 0;

  const ruc = `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`;
  const ong = await prisma.ong.create({
    data: {
      ruc,
      razonSocial: `ONG de pruebas ${etiqueta} ${marca}`,
      representanteLegal: 'Representante de Prueba',
      documentoRepresentante: '00000000',
      direccion: 'Sin direccion',
      departamento: 'Huanuco',
      correoContacto: `${etiqueta}-${marca}@prueba.pe`,
      descripcion: `Organizacion creada por las pruebas de ${etiqueta}.`,
      estadoVerificacion: 'VERIFICADA',
    },
  });

  const campana = await prisma.campana.create({
    data: {
      ongId: ong.id,
      titulo: `Campaña de ${etiqueta} ${marca}`,
      slug: `${etiqueta}-${marca}`,
      descripcion: `Campaña creada por las pruebas de ${etiqueta}.`,
      causa: `Pruebas ${marca}`,
      fechaInicio: new Date('2026-01-01'),
      estado: 'ACTIVA',
    },
  });

  const fondo = await prisma.fondo.create({
    data: {
      campanaId: campana.id,
      nombre: `Fondo ${etiqueta} ${marca}`,
      categoriaGasto: 'ATENCION_VETERINARIA',
      meta: 50_000,
      // El fondo existe desde antes de los movimientos con fecha del pasado.
      creadoEn: new Date('2026-01-01T12:00:00Z'),
    },
  });

  const [rolOperador, rolDonante] = await Promise.all([
    prisma.rol.findUniqueOrThrow({ where: { codigo: 'ONG_OPERADOR' } }),
    prisma.rol.findUniqueOrThrow({ where: { codigo: 'DONANTE' } }),
  ]);

  const operador = await prisma.usuario.create({
    data: {
      correo: `op-${etiqueta}-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Operador',
      apellidos: 'De Prueba',
      estado: 'ACTIVO',
      roles: { create: { rolId: rolOperador.id } },
      membresias: { create: { ongId: ong.id, cargo: 'OPERADOR' } },
    },
  });
  usuarios.push(operador.id);

  const donanteUsuario = await prisma.usuario.create({
    data: {
      correo: `don-${etiqueta}-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Donante',
      apellidos: 'De Prueba',
      estado: 'ACTIVO',
      roles: { create: { rolId: rolDonante.id } },
      donante: { create: {} },
    },
    include: { donante: true },
  });
  usuarios.push(donanteUsuario.id);
  const donanteId = donanteUsuario.donante!.id;

  const movimiento = (
    tx: Prisma.TransactionClient,
    tipo: keyof typeof ASIENTOS,
    monto: Prisma.Decimal | number,
    datos: { donacionId?: string; gastoId?: string; en?: Date },
  ) =>
    tx.movimientoContable.create({
      data: {
        fondoId: fondo.id,
        tipo,
        cuentaDebe: ASIENTOS[tipo].debe,
        cuentaHaber: ASIENTOS[tipo].haber,
        monto,
        descripcion: `${tipo} de ${etiqueta}`,
        donacionId: datos.donacionId,
        gastoId: datos.gastoId,
        creadoEn: datos.en,
      },
    });

  const [modelo, regla] = await Promise.all([
    prisma.modeloIa.findFirstOrThrow({ where: { version: 'reglas-v0' } }),
    prisma.reglaConfianza.findFirstOrThrow({ where: { activa: true } }),
  ]);

  return {
    marca,
    ongId: ong.id,
    ruc,
    campanaId: campana.id,
    fondoId: fondo.id,
    donanteId,
    donanteUsuarioId: donanteUsuario.id,
    operadorId: operador.id,
    usuarios,

    async donar(monto, comision, en) {
      const neto = new Prisma.Decimal(monto).minus(comision);
      contador += 1;

      return prisma.$transaction(async (tx) => {
        const donacion = await tx.donacion.create({
          data: {
            donanteId,
            fondoId: fondo.id,
            monto,
            montoNeto: neto,
            estado: 'CONFIRMADA',
            confirmadaEn: en ?? new Date(),
            creadoEn: en,
            pago: {
              create: {
                pasarela: 'fake',
                referenciaExterna: `fk_${etiqueta}_${marca}_${contador}`,
                monto,
                comision,
                montoNeto: neto,
                estado: 'APROBADO',
                procesadoEn: en ?? new Date(),
              },
            },
          },
        });

        await movimiento(tx, 'INGRESO', monto, { donacionId: donacion.id, en });
        if (comision > 0) {
          await movimiento(tx, 'COMISION', comision, { donacionId: donacion.id, en });
        }
        await movimiento(tx, 'RETENCION', neto, { donacionId: donacion.id, en });
        return donacion.id;
      });
    },

    async gastoAprobado(monto, en) {
      contador += 1;
      const fecha = en ?? new Date();

      const gasto = await prisma.gasto.create({
        data: {
          fondoId: fondo.id,
          ongId: ong.id,
          registradoPor: operador.id,
          montoDeclarado: monto,
          concepto: `Consulta veterinaria ${contador}`,
          proveedorNombre: 'Clinica de Prueba',
          fechaGasto: fecha,
          estado: 'EN_ANALISIS',
          creadoEn: en,
        },
      });

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
          explicacion: { motivos: [], resumen: `Aprobado para las pruebas de ${etiqueta}.` },
        },
      });

      // Los mismos pasos de AplicacionFifoService, con la fecha del escenario.
      await prisma.$transaction(async (tx) => {
        let restante = new Prisma.Decimal(monto);
        const disponibles = await tx.donacion.findMany({
          where: { fondoId: fondo.id, estado: 'CONFIRMADA' },
          orderBy: [{ confirmadaEn: 'asc' }, { creadoEn: 'asc' }],
        });

        for (const d of disponibles) {
          if (restante.lessThanOrEqualTo(0)) break;
          const disponible = d.montoNeto.minus(d.montoAplicado);
          if (disponible.lessThanOrEqualTo(0)) continue;

          const aplicar = Prisma.Decimal.min(restante, disponible);
          await tx.aplicacionDonacion.create({
            data: { gastoId: gasto.id, donacionId: d.id, monto: aplicar },
          });
          restante = restante.minus(aplicar);
        }
        if (restante.greaterThan(0)) {
          throw new Error(`El escenario no tiene donaciones para cubrir ${monto}.`);
        }

        await movimiento(tx, 'EJECUCION', monto, { gastoId: gasto.id, en });
        await tx.gasto.update({
          where: { id: gasto.id },
          data: { estado: 'APROBADO', montoAprobado: monto, aprobadoEn: fecha },
        });
      });

      return gasto.id;
    },

    async reasignar(monto, en) {
      const m = await prisma.$transaction((tx) => movimiento(tx, 'REASIGNACION', monto, { en }));
      return m.id;
    },

    async limpiar() {
      const enElFondo = { gasto: { fondoId: fondo.id } };
      await prisma.notificacion.deleteMany({ where: { usuarioId: { in: usuarios } } });
      await prisma.analisisAini.deleteMany({ where: enElFondo });
      await prisma.aplicacionDonacion.deleteMany({ where: enElFondo });
      await prisma.trabajoVerificacion.deleteMany({ where: enElFondo });

      await prisma.$executeRaw`ALTER TABLE movimientos_contables DISABLE TRIGGER tg_movimientos_no_delete`;
      try {
        await prisma.$executeRaw`DELETE FROM movimientos_contables WHERE fondo_id = ${fondo.id}::uuid`;
      } finally {
        await prisma.$executeRaw`ALTER TABLE movimientos_contables ENABLE TRIGGER tg_movimientos_no_delete`;
      }

      await prisma.gasto.deleteMany({ where: { fondoId: fondo.id } });
      await prisma.pago.deleteMany({ where: { donacion: { fondoId: fondo.id } } });
      await prisma.donacion.deleteMany({ where: { fondoId: fondo.id } });
      await prisma.fondo.deleteMany({ where: { campanaId: campana.id } });
      await prisma.campana.delete({ where: { id: campana.id } });
      await prisma.ongMiembro.deleteMany({ where: { ongId: ong.id } });
      await prisma.ong.delete({ where: { id: ong.id } });
      await prisma.bitacoraAuditoria.deleteMany({ where: { usuarioId: { in: usuarios } } });
      await prisma.donante.deleteMany({ where: { usuarioId: { in: usuarios } } });
      await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarios } } });
      await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
    },
  };
}
