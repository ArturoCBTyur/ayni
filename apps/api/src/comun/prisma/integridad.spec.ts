/**
 * Pruebas de las reglas de integridad de la seccion 6.6.
 *
 * Estas pruebas no verifican codigo de la aplicacion: verifican que la base
 * de datos se defienda sola. Cada caso intenta deliberadamente romper una
 * regla y espera que PostgreSQL lo rechace. Si alguna de estas pruebas pasa
 * a verde por el motivo equivocado, la trazabilidad del sistema deja de ser
 * demostrable, asi que todas afirman tambien el mensaje del error.
 *
 * Requieren una base real con las migraciones aplicadas.
 */
import { randomUUID } from 'node:crypto';

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** Etiqueta unica por corrida, para no chocar con el seed ni entre pruebas. */
const marca = randomUUID().slice(0, 8);

let ongId: string;
let campanaId: string;
let usuarioId: string;
let donanteId: string;

/** Crea un fondo limpio. Cada prueba usa el suyo para no interferir. */
async function crearFondo(nombre: string, meta = 10_000) {
  return prisma.fondo.create({
    data: { campanaId, nombre: `${nombre}-${marca}`, categoriaGasto: 'ALIMENTOS', meta },
  });
}

/** Donacion confirmada con su monto neto disponible para aplicar. */
async function crearDonacion(fondoId: string, monto: number, comision = 0) {
  return prisma.donacion.create({
    data: {
      donanteId,
      fondoId,
      monto,
      montoNeto: monto - comision,
      estado: 'CONFIRMADA',
      confirmadaEn: new Date(),
    },
  });
}

async function crearGasto(fondoId: string, montoDeclarado: number) {
  return prisma.gasto.create({
    data: {
      fondoId,
      ongId,
      registradoPor: usuarioId,
      montoDeclarado,
      concepto: 'Compra de alimento balanceado',
      proveedorNombre: 'Agroveterinaria El Establo',
      fechaGasto: new Date('2026-09-10'),
      estado: 'EN_ANALISIS',
    },
  });
}

async function movimiento(
  fondoId: string,
  tipo: 'INGRESO' | 'RETENCION' | 'EJECUCION' | 'COMISION',
  monto: number,
  extra: { donacionId?: string; gastoId?: string } = {},
) {
  return prisma.movimientoContable.create({
    data: {
      fondoId,
      tipo,
      cuentaDebe: tipo === 'INGRESO' ? '10.1 Caja' : '20.1 Fondos por ejecutar',
      cuentaHaber: tipo === 'INGRESO' ? '20.1 Fondos por ejecutar' : '10.1 Caja',
      monto,
      descripcion: `Movimiento de prueba ${tipo}`,
      ...extra,
    },
  });
}

beforeAll(async () => {
  const usuario = await prisma.usuario.findFirstOrThrow({ where: { correo: 'ong.operador@demo.pe' } });
  usuarioId = usuario.id;
  ongId = (await prisma.ong.findFirstOrThrow()).id;
  campanaId = (await prisma.campana.findFirstOrThrow({ where: { ongId } })).id;
  donanteId = (await prisma.donante.findFirstOrThrow()).id;
});

afterAll(async () => {
  // Se borra de adentro hacia afuera; el libro no admite DELETE, asi que los
  // fondos de prueba quedan y se limpian con TRUNCATE en el reset de la BD.
  await prisma.notificacion.deleteMany({ where: { asunto: { contains: marca } } });
  await prisma.aplicacionDonacion.deleteMany({ where: { gasto: { fondo: { nombre: { contains: marca } } } } });
  await prisma.gasto.deleteMany({ where: { fondo: { nombre: { contains: marca } } } });
  await prisma.donacion.deleteMany({ where: { fondo: { nombre: { contains: marca } } } });
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------

describe('Inmutabilidad del libro de movimientos (RNF-07, RN-03)', () => {
  it('rechaza UPDATE sobre movimientos_contables', async () => {
    const fondo = await crearFondo('libro-update');
    const mov = await movimiento(fondo.id, 'INGRESO', 100);

    await expect(
      prisma.$executeRaw`UPDATE movimientos_contables SET monto = 999 WHERE id = ${mov.id}::uuid`,
    ).rejects.toThrow(/solo insercion/i);

    // El monto original sigue intacto.
    const sinCambios = await prisma.movimientoContable.findUniqueOrThrow({ where: { id: mov.id } });
    expect(sinCambios.monto.toString()).toBe('100');
  });

  it('rechaza DELETE sobre movimientos_contables', async () => {
    const fondo = await crearFondo('libro-delete');
    const mov = await movimiento(fondo.id, 'INGRESO', 50);

    await expect(
      prisma.$executeRaw`DELETE FROM movimientos_contables WHERE id = ${mov.id}::uuid`,
    ).rejects.toThrow(/solo insercion/i);

    expect(await prisma.movimientoContable.count({ where: { id: mov.id } })).toBe(1);
  });

  it('el mensaje de error orienta hacia el movimiento de REVERSO', async () => {
    const fondo = await crearFondo('libro-mensaje');
    const mov = await movimiento(fondo.id, 'INGRESO', 10);

    await expect(
      prisma.$executeRaw`DELETE FROM movimientos_contables WHERE id = ${mov.id}::uuid`,
    ).rejects.toThrow(/REVERSO/);
  });
});

describe('Cadena de hashes (RNF-07)', () => {
  it('asigna secuencia y encadena hash_previo con hash_actual', async () => {
    const fondo = await crearFondo('cadena-ok');

    const m1 = await movimiento(fondo.id, 'INGRESO', 300);
    const m2 = await movimiento(fondo.id, 'COMISION', 11);
    const m3 = await movimiento(fondo.id, 'RETENCION', 289);

    expect([m1.secuencia, m2.secuencia, m3.secuencia]).toEqual([1n, 2n, 3n]);
    expect(m1.hashPrevio).toBeNull();
    expect(m2.hashPrevio).toBe(m1.hashActual);
    expect(m3.hashPrevio).toBe(m2.hashActual);
    // SHA-256 en hexadecimal.
    expect(m1.hashActual).toMatch(/^[0-9a-f]{64}$/);
  });

  it('la aplicacion no puede imponer secuencia ni hash: los calcula la base', async () => {
    const fondo = await crearFondo('cadena-impuesta');
    await movimiento(fondo.id, 'INGRESO', 100);

    // Se intenta insertar con secuencia y hash falsos.
    await prisma.$executeRaw`
      INSERT INTO movimientos_contables
        (id, fondo_id, tipo, cuenta_debe, cuenta_haber, monto, descripcion, secuencia, hash_actual)
      VALUES
        (gen_random_uuid(), ${fondo.id}::uuid, 'INGRESO', 'a', 'b', 25, 'intento', 99, repeat('0', 64))
    `;

    const insertado = await prisma.movimientoContable.findFirstOrThrow({
      where: { fondoId: fondo.id, descripcion: 'intento' },
    });

    // El trigger sobrescribio ambos valores.
    expect(insertado.secuencia).toBe(2n);
    expect(insertado.hashActual).not.toBe('0'.repeat(64));
  });

  it('la verificacion reporta la cadena intacta', async () => {
    const fondo = await crearFondo('cadena-verificada');
    await movimiento(fondo.id, 'INGRESO', 500);
    await movimiento(fondo.id, 'RETENCION', 500);

    const [r] = await prisma.$queryRaw<{ movimientos: bigint; rota: boolean }[]>`
      SELECT movimientos, rota FROM fn_verificar_cadena(${fondo.id}::uuid)
    `;
    expect(Number(r.movimientos)).toBe(2);
    expect(r.rota).toBe(false);
  });

  it('la verificacion detecta una alteracion hecha por fuera del trigger', async () => {
    const fondo = await crearFondo('cadena-rota');
    await movimiento(fondo.id, 'INGRESO', 400);
    await movimiento(fondo.id, 'RETENCION', 400);

    // Se desactiva el trigger para simular una manipulacion directa de la
    // base: es el escenario que la cadena de hashes existe para detectar.
    await prisma.$executeRaw`ALTER TABLE movimientos_contables DISABLE TRIGGER tg_movimientos_no_update`;
    try {
      await prisma.$executeRaw`
        UPDATE movimientos_contables SET monto = 4000
         WHERE fondo_id = ${fondo.id}::uuid AND secuencia = 1
      `;
    } finally {
      await prisma.$executeRaw`ALTER TABLE movimientos_contables ENABLE TRIGGER tg_movimientos_no_update`;
    }

    const [r] = await prisma.$queryRaw<{ rota: boolean; secuencia_rota: bigint | null }[]>`
      SELECT rota, secuencia_rota FROM fn_verificar_cadena(${fondo.id}::uuid)
    `;
    expect(r.rota).toBe(true);
    expect(Number(r.secuencia_rota)).toBe(1);
  });
});

describe('Saldos del fondo derivados del libro (RF-CF-01)', () => {
  it('INGRESO, COMISION, RETENCION y EJECUCION mueven los saldos correctos', async () => {
    const fondo = await crearFondo('saldos');

    await movimiento(fondo.id, 'INGRESO', 200);
    await movimiento(fondo.id, 'COMISION', 7.88);
    await movimiento(fondo.id, 'RETENCION', 192.12);

    let f = await prisma.fondo.findUniqueOrThrow({ where: { id: fondo.id } });
    expect(f.saldoRecaudado.toString()).toBe('192.12');
    expect(f.saldoRetenido.toString()).toBe('192.12');
    expect(f.saldoEjecutado.toString()).toBe('0');

    await movimiento(fondo.id, 'EJECUCION', 60);

    f = await prisma.fondo.findUniqueOrThrow({ where: { id: fondo.id } });
    expect(f.saldoRetenido.toString()).toBe('132.12');
    expect(f.saldoEjecutado.toString()).toBe('60');
  });
});

describe('Unicidad del comprobante (seccion 6.6)', () => {
  it('rechaza dos comprobantes con el mismo hash SHA-256', async () => {
    const fondo = await crearFondo('comp-hash');
    const g1 = await crearGasto(fondo.id, 100);
    const g2 = await crearGasto(fondo.id, 100);
    const hashRepetido = 'a'.repeat(64);

    const base = {
      tipo: 'BOLETA' as const,
      rucEmisor: '20601030579',
      fechaEmision: new Date('2026-09-09'),
      subtotal: 84.75,
      igv: 15.25,
      total: 100,
      archivoUrl: 'local://prueba.jpg',
      archivoMime: 'image/jpeg',
      archivoBytes: 1024,
    };

    await prisma.comprobante.create({
      data: { ...base, gastoId: g1.id, serie: 'B001', numero: '111', hashSha256: hashRepetido },
    });

    await expect(
      prisma.comprobante.create({
        // Serie y numero distintos: lo unico repetido es el archivo.
        data: { ...base, gastoId: g2.id, serie: 'B001', numero: '222', hashSha256: hashRepetido },
      }),
    ).rejects.toThrow(/hash_sha256|Unique constraint/i);
  });

  it('rechaza reutilizar la misma serie y numero del mismo emisor', async () => {
    const fondo = await crearFondo('comp-serie');
    const g1 = await crearGasto(fondo.id, 100);
    const g2 = await crearGasto(fondo.id, 100);

    const base = {
      tipo: 'FACTURA' as const,
      rucEmisor: '20131312955',
      serie: 'F001',
      numero: '9001',
      fechaEmision: new Date('2026-09-09'),
      subtotal: 84.75,
      igv: 15.25,
      total: 100,
      archivoUrl: 'local://prueba.pdf',
      archivoMime: 'application/pdf',
      archivoBytes: 2048,
    };

    await prisma.comprobante.create({ data: { ...base, gastoId: g1.id, hashSha256: 'b'.repeat(64) } });

    await expect(
      prisma.comprobante.create({
        // Archivo distinto, pero es el mismo comprobante fiscal.
        data: { ...base, gastoId: g2.id, hashSha256: 'c'.repeat(64) },
      }),
    ).rejects.toThrow(/Unique constraint|ruc_emisor/i);
  });

  it('rechaza un comprobante cuya aritmetica no cuadra', async () => {
    const fondo = await crearFondo('comp-aritmetica');
    const g = await crearGasto(fondo.id, 100);

    await expect(
      prisma.comprobante.create({
        data: {
          gastoId: g.id,
          tipo: 'BOLETA',
          rucEmisor: '20601030579',
          serie: 'B002',
          numero: '1',
          fechaEmision: new Date('2026-09-09'),
          subtotal: 50,
          igv: 9,
          total: 100, // 50 + 9 no da 100
          archivoUrl: 'local://x.jpg',
          archivoMime: 'image/jpeg',
          archivoBytes: 10,
          hashSha256: 'd'.repeat(64),
        },
      }),
    ).rejects.toThrow(/suma_coherente|check constraint/i);
  });
});

describe('Aplicacion de gastos a donaciones (RN-04, RF-CF-03)', () => {
  it('rechaza aplicar mas de lo disponible en la donacion', async () => {
    const fondo = await crearFondo('aplic-exceso');
    const don = await crearDonacion(fondo.id, 100, 5); // neto 95
    const gasto = await crearGasto(fondo.id, 200);

    await expect(
      prisma.aplicacionDonacion.create({
        data: { gastoId: gasto.id, donacionId: don.id, monto: 96 },
      }),
    ).rejects.toThrow(/excede el saldo disponible/i);
  });

  it('rechaza aplicar una donacion de otro fondo (RN-01)', async () => {
    const fondoA = await crearFondo('aplic-fondo-a');
    const fondoB = await crearFondo('aplic-fondo-b');
    const donB = await crearDonacion(fondoB.id, 100);
    const gastoA = await crearGasto(fondoA.id, 50);

    await expect(
      prisma.aplicacionDonacion.create({
        data: { gastoId: gastoA.id, donacionId: donB.id, monto: 50 },
      }),
    ).rejects.toThrow(/pertenece a otro fondo/i);
  });

  it('rechaza aplicar una donacion no confirmada', async () => {
    const fondo = await crearFondo('aplic-pendiente');
    const don = await prisma.donacion.create({
      data: { donanteId, fondoId: fondo.id, monto: 100, montoNeto: 100, estado: 'PENDIENTE' },
    });
    const gasto = await crearGasto(fondo.id, 50);

    await expect(
      prisma.aplicacionDonacion.create({
        data: { gastoId: gasto.id, donacionId: don.id, monto: 50 },
      }),
    ).rejects.toThrow(/donaciones confirmadas/i);
  });

  it('acumula monto_aplicado y consume en orden FIFO sin pasarse', async () => {
    const fondo = await crearFondo('aplic-fifo');
    const d1 = await crearDonacion(fondo.id, 40);
    const d2 = await crearDonacion(fondo.id, 40);
    const gasto = await crearGasto(fondo.id, 60);

    // El gasto de 60 consume los 40 de la primera donacion y 20 de la segunda.
    await prisma.aplicacionDonacion.create({ data: { gastoId: gasto.id, donacionId: d1.id, monto: 40 } });
    await prisma.aplicacionDonacion.create({ data: { gastoId: gasto.id, donacionId: d2.id, monto: 20 } });

    const [r1, r2] = await Promise.all([
      prisma.donacion.findUniqueOrThrow({ where: { id: d1.id } }),
      prisma.donacion.findUniqueOrThrow({ where: { id: d2.id } }),
    ]);
    expect(r1.montoAplicado.toString()).toBe('40');
    expect(r2.montoAplicado.toString()).toBe('20');

    // La primera queda agotada: no admite un sol mas.
    await expect(
      prisma.aplicacionDonacion.create({
        data: { gastoId: (await crearGasto(fondo.id, 5)).id, donacionId: d1.id, monto: 1 },
      }),
    ).rejects.toThrow(/excede el saldo disponible/i);
  });

  it('exige que la suma aplicada iguale el monto aprobado del gasto', async () => {
    const fondo = await crearFondo('aplic-cuadre');
    await movimiento(fondo.id, 'INGRESO', 100);
    await movimiento(fondo.id, 'RETENCION', 100);
    const don = await crearDonacion(fondo.id, 100);
    const gasto = await crearGasto(fondo.id, 100);

    // Se aprueba por 100 pero se aplican solo 60: el constraint diferido
    // debe hacer fallar el commit de la transaccion.
    await expect(
      prisma.$transaction(async (tx) => {
        await tx.revisionAuditoria.create({
          data: {
            gastoId: gasto.id,
            auditorId: (await tx.usuario.findFirstOrThrow({ where: { correo: 'auditor@demo.pe' } })).id,
            decision: 'APROBAR',
            comentario: 'Aprobado en prueba de cuadre',
            montoAprobado: 100,
          },
        });
        await tx.gasto.update({
          where: { id: gasto.id },
          data: { estado: 'APROBADO', montoAprobado: 100, aprobadoEn: new Date() },
        });
        await tx.aplicacionDonacion.create({
          data: { gastoId: gasto.id, donacionId: don.id, monto: 60 },
        });
      }),
    ).rejects.toThrow(/no iguala el monto aprobado/i);
  });
});

describe('Coherencia de estados del gasto (seccion 6.6)', () => {
  it('no permite APROBADO sin analisis ALTO ni revision APROBAR', async () => {
    const fondo = await crearFondo('estado-sin-respaldo');
    const gasto = await crearGasto(fondo.id, 80);

    await expect(
      prisma.gasto.update({
        where: { id: gasto.id },
        data: { estado: 'APROBADO', montoAprobado: 80 },
      }),
    ).rejects.toThrow(/sin un analisis de nivel ALTO/i);
  });

  it('no permite APROBADO sin monto aprobado', async () => {
    const fondo = await crearFondo('estado-sin-monto');
    const gasto = await crearGasto(fondo.id, 80);
    const auditor = await prisma.usuario.findFirstOrThrow({ where: { correo: 'auditor@demo.pe' } });

    await prisma.revisionAuditoria.create({
      data: {
        gastoId: gasto.id,
        auditorId: auditor.id,
        decision: 'APROBAR',
        comentario: 'Respaldo para la prueba',
      },
    });

    await expect(
      prisma.gasto.update({ where: { id: gasto.id }, data: { estado: 'APROBADO' } }),
    ).rejects.toThrow(/requiere monto_aprobado/i);
  });

  it('permite APROBADO cuando existe una revision con decision APROBAR', async () => {
    const fondo = await crearFondo('estado-con-revision');
    const gasto = await crearGasto(fondo.id, 80);
    const auditor = await prisma.usuario.findFirstOrThrow({ where: { correo: 'auditor@demo.pe' } });

    await prisma.revisionAuditoria.create({
      data: {
        gastoId: gasto.id,
        auditorId: auditor.id,
        decision: 'APROBAR',
        comentario: 'Comprobante y evidencia coherentes',
        montoAprobado: 80,
      },
    });

    const actualizado = await prisma.gasto.update({
      where: { id: gasto.id },
      data: { estado: 'APROBADO', montoAprobado: 80, aprobadoEn: new Date() },
    });
    expect(actualizado.estado).toBe('APROBADO');
  });
});

describe('Privacidad y consentimiento en notificaciones (RNF-06, RF-DE-01)', () => {
  it('no permite notificar una evidencia sin anonimizar', async () => {
    const fondo = await crearFondo('notif-sin-anonimizar');
    const gasto = await crearGasto(fondo.id, 50);
    const donante = await prisma.donante.findUniqueOrThrow({ where: { id: donanteId } });

    const evidencia = await prisma.evidencia.create({
      data: {
        gastoId: gasto.id,
        archivoUrl: 'local://foto.jpg',
        archivoMime: 'image/jpeg',
        archivoBytes: 5000,
        hashSha256: 'e'.repeat(64),
        contienePersonas: true,
        anonimizada: false,
      },
    });

    await expect(
      prisma.notificacion.create({
        data: {
          usuarioId: donante.usuarioId,
          tipo: 'IMPACTO',
          canal: 'IN_APP',
          asunto: `Prueba ${marca}`,
          cuerpo: 'Su aporte hizo esto posible',
          evidenciaId: evidencia.id,
          transaccional: true,
        },
      }),
    ).rejects.toThrow(/no esta anonimizada/i);
  });

  it('permite notificar una evidencia anonimizada', async () => {
    const fondo = await crearFondo('notif-anonimizada');
    const gasto = await crearGasto(fondo.id, 50);
    const donante = await prisma.donante.findUniqueOrThrow({ where: { id: donanteId } });

    const evidencia = await prisma.evidencia.create({
      data: {
        gastoId: gasto.id,
        archivoUrl: 'local://foto2.jpg',
        archivoAnonimizadoUrl: 'local://foto2-anon.jpg',
        archivoMime: 'image/jpeg',
        archivoBytes: 5000,
        hashSha256: 'f'.repeat(64),
        contienePersonas: true,
        anonimizada: true,
      },
    });

    const n = await prisma.notificacion.create({
      data: {
        usuarioId: donante.usuarioId,
        tipo: 'IMPACTO',
        canal: 'IN_APP',
        asunto: `Prueba ok ${marca}`,
        cuerpo: 'Su aporte hizo esto posible',
        evidenciaId: evidencia.id,
        transaccional: true,
      },
    });
    expect(n.id).toBeTruthy();
  });

  it('exige consentimiento vigente para notificaciones no transaccionales', async () => {
    // Usuario nuevo, sin consentimiento de comunicaciones.
    const sinConsentimiento = await prisma.usuario.create({
      data: {
        correo: `sin-consentimiento-${marca}@demo.pe`,
        hashPassword: 'x',
        nombres: 'Sin',
        apellidos: 'Consentimiento',
        estado: 'ACTIVO',
      },
    });

    await expect(
      prisma.notificacion.create({
        data: {
          usuarioId: sinConsentimiento.id,
          tipo: 'RESUMEN',
          canal: 'CORREO',
          asunto: `Boletin ${marca}`,
          cuerpo: 'Resumen mensual',
          transaccional: false,
        },
      }),
    ).rejects.toThrow(/consentimiento vigente/i);

    // La misma notificacion, marcada como transaccional, si pasa.
    const ok = await prisma.notificacion.create({
      data: {
        usuarioId: sinConsentimiento.id,
        tipo: 'PAGO',
        canal: 'CORREO',
        asunto: `Constancia ${marca}`,
        cuerpo: 'Su donacion fue registrada',
        transaccional: true,
      },
    });
    expect(ok.id).toBeTruthy();

    await prisma.notificacion.deleteMany({ where: { usuarioId: sinConsentimiento.id } });
    await prisma.usuario.delete({ where: { id: sinConsentimiento.id } });
  });
});

describe('Restricciones de importe (seccion 6.6)', () => {
  it('rechaza una donacion de monto cero o negativo', async () => {
    const fondo = await crearFondo('monto-cero');

    for (const monto of [0, -50]) {
      await expect(
        prisma.donacion.create({
          data: { donanteId, fondoId: fondo.id, monto, montoNeto: 0, estado: 'PENDIENTE' },
        }),
      ).rejects.toThrow(/monto_positivo|check constraint/i);
    }
  });

  it('rechaza una regla de confianza con pesos que no suman 1', async () => {
    await expect(
      prisma.reglaConfianza.create({
        data: {
          umbralAlto: 90,
          umbralMedio: 60,
          pesoDocumental: 0.5,
          pesoVisual: 0.5,
          pesoAnomalia: 0.5,
          activa: false,
        },
      }),
    ).rejects.toThrow(/pesos_suman_uno|check constraint/i);
  });

  it('rechaza umbrales invertidos', async () => {
    await expect(
      prisma.reglaConfianza.create({
        data: {
          umbralAlto: 50,
          umbralMedio: 80,
          pesoDocumental: 0.45,
          pesoVisual: 0.25,
          pesoAnomalia: 0.3,
          activa: false,
        },
      }),
    ).rejects.toThrow(/umbrales_ordenados|check constraint/i);
  });
});
