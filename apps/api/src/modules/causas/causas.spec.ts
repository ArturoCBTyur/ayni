/**
 * Cierre de causa (Fase 3 del plan transdisciplinario).
 *
 * Recorre el ciclo entero con el reloj adelantado: un fondo que recibio dos
 * donaciones y gasto parte, se cierra, avisa a la ONG a los 60 dias, espera a
 * que se resuelva un gasto en verificacion, reparte el remanente al vencer y
 * lo asienta cuando los donantes eligen o se acaba su plazo. Uno elige
 * trasladar su saldo a otro fondo; el otro no elige y se le devuelve.
 *
 * Las cifras se escriben a mano. Solo se avanzan los fondos de la suite: un
 * cierre no se deshace, y la base de desarrollo es la de la demostracion.
 */
import { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import sharp from 'sharp';
import request from 'supertest';

import { BitacoraModule } from '../../comun/bitacora/bitacora.module';
import { PrismaModule } from '../../comun/prisma/prisma.module';
import { PrismaService } from '../../comun/prisma/prisma.service';
import {
  crearEscenarioContable,
  type EscenarioContable,
} from '../../comun/pruebas/escenario-contable';
import { cargarConfiguracion } from '../../config/configuracion';
import { ConciliacionService } from '../analitica/conciliacion.service';
import { fechaEnLima } from '../../comun/periodo';
import { clasificacionCuadra } from '../contable/clasificacion';
import { ASIENTOS } from '../contable/cuentas';
import { ContableModule } from '../contable/contable.module';
import { LibroService } from '../contable/libro.service';
import { DonacionesModule } from '../donaciones/donaciones.module';
import { GastosModule } from '../gastos/gastos.module';
import { GastosService } from '../gastos/gastos.service';
import { ALMACENAMIENTO, type AlmacenamientoArchivos } from '../gastos/puertos/almacenamiento.port';
import { IdentidadModule } from '../identidad/identidad.module';
import type { CargaAcceso } from '../identidad/servicios/tokens.service';
import { RetornoModule } from '../retorno/retorno.module';
import { CausasModule } from './causas.module';
import { CausasService } from './causas.service';
import { InformesCierreService, type InformeContenido } from './informes-cierre.service';
import { iniciarCierreDeCausa } from './politica';

let app: INestApplication;
let prisma: PrismaService;
let causas: CausasService;
let informes: InformesCierreService;
let libro: LibroService;
let conciliacion: ConciliacionService;
let gastos: GastosService;
let almacen: AlmacenamientoArchivos;

let origen: EscenarioContable;
let destino: EscenarioContable;
let segundoDonante: { usuarioId: string; donanteId: string; correo: string };
let gastoAprobado: string;
let objetoFoto: string;

const DIA = 24 * 60 * 60 * 1000;
const t0 = new Date();
const dia = (n: number) => new Date(t0.getTime() + n * DIA);
const contexto = { ip: '127.0.0.1', userAgent: 'jest' };
const como = (usuarioId: string): CargaAcceso => ({
  sub: usuarioId,
  correo: `${usuarioId}@prueba.pe`,
  roles: ['DONANTE'],
  ongs: [],
});
const avanzar = (n: number) => causas.avanzar(dia(n), [origen.fondoId, destino.fondoId]);
const api = () => request(app.getHttpServer() as Server);

async function cierre() {
  return prisma.cierreCausa.findUniqueOrThrow({
    where: { fondoId: origen.fondoId },
    include: { remanentes: { orderBy: { monto: 'asc' } }, informe: true },
  });
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [
      ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] }),
      PrismaModule,
      BitacoraModule,
      ContableModule,
      IdentidadModule,
      RetornoModule,
      GastosModule,
      DonacionesModule,
      CausasModule,
    ],
    providers: [ConciliacionService],
  }).compile();

  app = modulo.createNestApplication();
  await app.init();
  prisma = modulo.get(PrismaService);
  causas = modulo.get(CausasService);
  informes = modulo.get(InformesCierreService);
  libro = modulo.get(LibroService);
  conciliacion = modulo.get(ConciliacionService);
  gastos = modulo.get(GastosService);
  almacen = modulo.get(ALMACENAMIENTO);

  origen = await crearEscenarioContable(prisma, 'cierre-causa');
  destino = await crearEscenarioContable(prisma, 'cierre-causa-destino');

  const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: 'DONANTE' } });
  const usuario = await prisma.usuario.create({
    data: {
      correo: `segundo-${origen.marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Marisol',
      apellidos: 'Segunda Donante',
      estado: 'ACTIVO',
      roles: { create: { rolId: rol.id } },
      donante: { create: {} },
    },
    include: { donante: true },
  });
  origen.usuarios.push(usuario.id);
  segundoDonante = {
    usuarioId: usuario.id,
    donanteId: usuario.donante!.id,
    correo: usuario.correo,
  };

  // 200 - 7.88 = 192.12 del primero; 100 - 4.44 = 95.56 del segundo.
  await origen.donar(200, 7.88);
  await origen.donar(100, 4.44, undefined, segundoDonante.donanteId);
  // El FIFO toma 150 del primero: le quedan 42.12; al segundo, 95.56.
  gastoAprobado = await origen.gastoAprobado(150);
  // D4 · 30 animales atendidos con esos 150: S/ 5.00 por animal.
  await prisma.gasto.update({ where: { id: gastoAprobado }, data: { unidadesImpacto: 30 } });

  // Una foto publicable del gasto, para el informe.
  const jpeg = await sharp({
    create: { width: 64, height: 48, channels: 3, background: { r: 30, g: 120, b: 90 } },
  })
    .jpeg()
    .toBuffer();
  objetoFoto = `evidencias/cierre-${origen.marca}.jpg`;
  await almacen.guardar(objetoFoto, jpeg, 'image/jpeg');
  await prisma.evidencia.create({
    data: {
      gastoId: gastoAprobado,
      archivoUrl: objetoFoto,
      archivoMime: 'image/jpeg',
      archivoBytes: jpeg.length,
      hashSha256: createHash('sha256').update(jpeg).digest('hex'),
      contienePersonas: false,
      anonimizada: true,
    },
  });
}, 60_000);

afterAll(async () => {
  await almacen.eliminar(objetoFoto).catch(() => undefined);
  await prisma.evidencia.deleteMany({ where: { gasto: { fondoId: origen.fondoId } } });
  // El destino primero: su donacion nueva apunta a una del origen.
  await destino.limpiar();
  await origen.limpiar();
  await app.close();
});

describe('RF-CF-11 · Apertura del cierre', () => {
  it('un fondo que nunca recibio dinero no abre cierre', async () => {
    const vacio = await prisma.fondo.create({
      data: {
        campanaId: origen.campanaId,
        nombre: `Fondo vacio ${origen.marca}`,
        categoriaGasto: 'ALIMENTOS',
        meta: 100,
      },
    });
    expect(await iniciarCierreDeCausa(prisma, vacio.id)).toBe(false);
    await prisma.fondo.delete({ where: { id: vacio.id } });
  });

  it('el job abre el cierre de un fondo cerrado antes de que existiera la politica', async () => {
    await prisma.fondo.update({ where: { id: origen.fondoId }, data: { estado: 'CERRADO' } });
    const r = await avanzar(0);
    const c = await cierre();

    expect(r.abiertos).toBe(1);
    expect(c.estado).toBe('JUSTIFICANDO');
    expect(c.venceJustificacionEn.getTime()).toBe(dia(90).getTime());
    // Abrirlo de nuevo no duplica nada.
    expect(await iniciarCierreDeCausa(prisma, origen.fondoId)).toBe(false);
  });

  it('dentro del plazo no pasa nada, y a los 60 dias avisa a la ONG una vez', async () => {
    expect((await avanzar(30)).avisos).toBe(0);
    expect((await avanzar(61)).avisos).toBe(1);
    expect((await avanzar(62)).avisos).toBe(0);

    const avisos = await prisma.notificacion.findMany({
      where: { usuarioId: origen.operadorId, tipo: 'CIERRE_CAUSA' },
    });
    expect(avisos).toHaveLength(1);
    expect(avisos[0].asunto).toBe(
      `Quedan 29 días para justificar Fondo cierre-causa ${origen.marca}`,
    );
    expect(avisos[0].cuerpo).toContain('S/ 137.68 retenidos');
  });
});

describe('RF-CF-11 · Vencimiento del plazo', () => {
  it('con un gasto todavia en verificacion, espera y dice por que', async () => {
    const enAnalisis = await prisma.gasto.create({
      data: {
        fondoId: origen.fondoId,
        ongId: origen.ongId,
        registradoPor: origen.operadorId,
        montoDeclarado: 10,
        concepto: 'Gasto en verificacion',
        proveedorNombre: 'Proveedor',
        fechaGasto: new Date(),
        estado: 'EN_ANALISIS',
      },
    });

    const r = await avanzar(91);
    expect(r.detenidos[0]?.motivo).toContain('1 gasto(s) en verificacion');
    expect((await cierre()).estado).toBe('JUSTIFICANDO');

    await prisma.gasto.update({ where: { id: enAnalisis.id }, data: { estado: 'RECHAZADO' } });
  });

  it('vencido el plazo no se registran gastos nuevos', async () => {
    // Antes del vencimiento real (la fecha de la base es hoy) se forza el estado.
    await prisma.cierreCausa.update({
      where: { fondoId: origen.fondoId },
      data: { venceJustificacionEn: new Date(Date.now() - 1000) },
    });
    await expect(
      gastos.registrar(
        origen.operadorId,
        { fondoId: origen.fondoId, montoDeclarado: 5 } as never,
        contexto,
      ),
    ).rejects.toThrow('El plazo para justificar este fondo vencio');
    await prisma.cierreCausa.update({
      where: { fondoId: origen.fondoId },
      data: { venceJustificacionEn: dia(90) },
    });
  });

  it('reparte lo retenido entre las donaciones que el FIFO no uso, y pide elegir', async () => {
    const r = await avanzar(91);
    const c = await cierre();

    expect(r.enEleccion).toBe(1);
    expect(c.estado).toBe('ELIGIENDO');
    expect(c.remanenteTotal?.toFixed(2)).toBe('137.68');
    expect(c.remanentes.map((x) => x.monto.toFixed(2))).toEqual(['42.12', '95.56']);
    expect(c.venceEleccionEn!.getTime()).toBe(dia(121).getTime());

    const aviso = await prisma.notificacion.findFirstOrThrow({
      where: { usuarioId: segundoDonante.usuarioId, tipo: 'CIERRE_CAUSA' },
    });
    expect(aviso.asunto).toBe('Una causa que apoyaste cerró: decide qué hacer con tu saldo');
    expect(aviso.cuerpo).toContain('S/ 95.56 de tu aporte');
    expect(aviso.transaccional).toBe(true);
  });
});

describe('RF-CF-11 · Eleccion del donante', () => {
  const delPrimero = async () =>
    (await cierre()).remanentes.find((x) => x.monto.toFixed(2) === '42.12')!;

  it('ofrece primero los fondos de su misma categoria, y nunca el que cierra', async () => {
    const r = await delPrimero();
    const destinos = await causas.destinosPosibles(como(origen.donanteUsuarioId), r.id);

    expect(destinos.map((d) => d.id)).not.toContain(origen.fondoId);
    expect(destinos.find((d) => d.id === destino.fondoId)?.mismaCategoria).toBe(true);
    expect(destinos[0].mismaCategoria).toBe(true);
  });

  it('nadie mas que su donante ve o elige su saldo', async () => {
    const r = await delPrimero();
    await expect(
      causas.elegir(como(segundoDonante.usuarioId), r.id, { destino: 'DEVOLUCION' }, contexto),
    ).rejects.toThrow('No encontramos ese saldo');
  });

  it('no se traslada al mismo fondo ni sin decir a cual', async () => {
    const r = await delPrimero();
    await expect(
      causas.elegir(
        como(origen.donanteUsuarioId),
        r.id,
        { destino: 'REASIGNACION', fondoDestinoId: origen.fondoId },
        contexto,
      ),
    ).rejects.toThrow('no puede recibir su saldo');
    await expect(
      causas.elegir(como(origen.donanteUsuarioId), r.id, { destino: 'REASIGNACION' }, contexto),
    ).rejects.toThrow('Elija a que fondo');
  });

  it('elige trasladar su saldo a otra causa', async () => {
    const r = await delPrimero();
    await causas.elegir(
      como(origen.donanteUsuarioId),
      r.id,
      { destino: 'REASIGNACION', fondoDestinoId: destino.fondoId },
      contexto,
    );
    const saldos = await causas.misSaldos(como(origen.donanteUsuarioId));

    expect(saldos[0]).toMatchObject({ destino: 'REASIGNACION', puedeElegir: true, monto: '42.12' });
    expect(saldos[0].fondoDestino?.id).toBe(destino.fondoId);
  });

  it('mientras falte alguien por elegir y el plazo no venza, no se resuelve', async () => {
    expect((await avanzar(100)).resueltos).toBe(0);
  });
});

describe('RF-CF-11 · Resolucion', () => {
  let contenido: InformeContenido;

  it('al vencer la eleccion asienta cada destino; sin eleccion, devuelve', async () => {
    const r = await avanzar(122);
    const c = await cierre();

    expect(r.resueltos).toBe(1);
    expect(c.estado).toBe('RESUELTO');
    const [primero, segundo] = c.remanentes;
    expect(primero).toMatchObject({ destino: 'REASIGNACION', elegidoPor: 'DONANTE' });
    expect(segundo).toMatchObject({ destino: 'DEVOLUCION', elegidoPor: 'PLAZO' });
    // La devolucion se pago en la pasarela simulada.
    expect(segundo.reembolsoReferencia).toMatch(/^rf_/);
    expect(segundo.reembolsadoEn).not.toBeNull();
  });

  it('el fondo queda sin nada retenido y la clasificacion sigue siendo una particion', async () => {
    const saldos = await libro.saldosClasificados(origen.fondoId);
    const fondo = await prisma.fondo.findUniqueOrThrow({ where: { id: origen.fondoId } });

    expect(saldos.conRestriccion.isZero()).toBe(true);
    expect(saldos.devuelto.toFixed(2)).toBe('95.56');
    expect(saldos.trasladado.toFixed(2)).toBe('42.12');
    expect(saldos.reasignadoPendiente.isZero()).toBe(true);
    expect(clasificacionCuadra(saldos)).toBe(true);
    expect(fondo.saldoRetenido.isZero()).toBe(true);
  });

  it('el traslado nace como donacion confirmada del mismo donante, retenida en el destino', async () => {
    const nueva = await prisma.donacion.findFirstOrThrow({
      where: { fondoId: destino.fondoId, donacionOrigenId: { not: null } },
    });
    const saldos = await libro.saldosClasificados(destino.fondoId);

    expect(nueva.donanteId).toBe(origen.donanteId);
    expect(nueva.montoNeto.toFixed(2)).toBe('42.12');
    expect(saldos.recibidoPorTraslado.toFixed(2)).toBe('42.12');
    expect(saldos.conRestriccion.toFixed(2)).toBe('42.12');
    expect(clasificacionCuadra(saldos)).toBe(true);
  });

  it('las cadenas siguen integras y la conciliacion cuadra en los dos fondos', async () => {
    expect((await libro.verificarCadena(origen.fondoId)).rota).toBe(false);
    expect((await libro.verificarCadena(destino.fondoId)).rota).toBe(false);

    const r = await conciliacion.conciliar();
    const nuestros = r.descuadres.filter(
      (d) =>
        d.entidadId === origen.fondoId ||
        d.entidadId === destino.fondoId ||
        d.comprobacion === 'traslados_salida_vs_entrada',
    );
    expect(nuestros).toEqual([]);
  });

  it('avisa a cada donante del destino de su saldo, con la plantilla que le toca', async () => {
    const ultimo = (usuarioId: string) =>
      prisma.notificacion.findFirstOrThrow({
        where: { usuarioId, tipo: 'CIERRE_CAUSA' },
        orderBy: { creadoEn: 'desc' },
      });

    expect((await ultimo(origen.donanteUsuarioId)).cuerpo).toContain(
      `pasaron el ${fechaEnLima(dia(122))}`,
    );
    expect((await ultimo(origen.donanteUsuarioId)).asunto).toBe('Tu saldo ahora apoya otra causa');
    expect((await ultimo(origen.donanteUsuarioId)).cuerpo).toContain(
      `Fondo cierre-causa-destino ${destino.marca}`,
    );
    expect((await ultimo(segundoDonante.usuarioId)).asunto).toBe(
      'Te devolvimos el saldo de tu aporte',
    );
  });

  it('RF-CF-12 · emite el informe de cierre, con su hash y sin nombres de donantes', async () => {
    const c = await cierre();
    const fila = c.informe!;
    contenido = JSON.parse(fila.contenido) as InformeContenido;

    expect(createHash('sha256').update(fila.contenido, 'utf8').digest('hex')).toBe(
      fila.hashContenido,
    );
    expect(contenido.resumen).toMatchObject({
      donaciones: 2,
      donantes: 2,
      gastosAprobados: 1,
      recaudadoBruto: '300.00',
      liberados: '150.00',
      devuelto: '95.56',
      trasladado: '42.12',
      conRestriccion: '0.00',
      particionCuadra: true,
    });
    expect(contenido.remanente.devolucion).toEqual({
      monto: '95.56',
      donaciones: 1,
      porDefecto: 1,
    });
    expect(contenido.remanente.traslado.fondos).toEqual([
      {
        id: destino.fondoId,
        nombre: `Fondo cierre-causa-destino ${destino.marca}`,
        monto: '42.12',
      },
    ]);
    expect(contenido.impacto).toMatchObject({
      unidad: 'animales atendidos',
      unidades: 30,
      costoPorUnidad: '5.00',
    });
    expect(fila.contenido).not.toContain('Marisol');
    expect(fila.contenido).not.toContain(segundoDonante.correo);
  });

  it('el informe guarda el hash de la foto que publica', async () => {
    const foto = contenido.gastos[0].evidencias[0];
    const bytes = await almacen.leer(objetoFoto);
    expect(foto.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('la base no deja cambiar ni borrar un informe, ni guardar uno con otro hash', async () => {
    const { informe } = await cierre();
    await expect(
      prisma.informeCierre.updateMany({ where: { id: informe!.id }, data: { contenido: '{}' } }),
    ).rejects.toThrow(/solo insercion/);
    await expect(prisma.informeCierre.deleteMany({ where: { id: informe!.id } })).rejects.toThrow(
      /solo insercion/,
    );

    const otro = await prisma.cierreCausa.create({
      data: { fondoId: destino.fondoId, venceJustificacionEn: dia(90) },
    });
    await expect(
      prisma.informeCierre.create({
        data: {
          id: randomUUID(),
          cierreId: otro.id,
          fondoId: destino.fondoId,
          contenido: JSON.stringify({ fondo: { id: destino.fondoId }, cierre: { id: otro.id } }),
          hashContenido: 'f'.repeat(64),
        },
      }),
    ).rejects.toThrow(/ck_informes_hash_del_contenido/);
    await prisma.cierreCausa.delete({ where: { id: otro.id } });
  });

  it('volver a avanzar no repite nada', async () => {
    const r = await avanzar(200);
    expect(r).toMatchObject({ resueltos: 0, informes: 0, reembolsos: 0, enEleccion: 0 });
  });
});

describe('RF-IN-05 · Verificacion publica', () => {
  const informeId = async () => (await cierre()).informe!.id;

  it('recalcula ahora y concluye que el informe se sostiene', async () => {
    const v = await informes.verificar(await informeId());
    expect(v).toMatchObject({
      hashCoincide: true,
      cadena: { integra: true },
      ultimoMovimiento: { coincide: true },
      movimientosPosteriores: 0,
      sostiene: true,
    });
  });

  it('la pagina es publica, en HTML, y tambien responde en JSON', async () => {
    const id = await informeId();
    const html = await api().get(`/publico/informes/${id}`);
    const json = await api().get(`/publico/informes/${id}`).query({ formato: 'json' });

    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(html.text).toContain('El informe se sostiene');
    expect(html.text).toContain((await cierre()).informe!.hashContenido);
    expect((json.body as { sostiene: boolean }).sostiene).toBe(true);
  });

  it('el PDF lleva la foto, el QR y la direccion de la verificacion', async () => {
    const id = await informeId();
    const r = await api()
      .get(`/publico/informes/${id}/pdf`)
      .buffer(true)
      .parse((res, fin) => {
        const partes: Buffer[] = [];
        res.on('data', (p: Buffer) => partes.push(p));
        res.on('end', () => fin(null, Buffer.concat(partes)));
      });
    const pdf = (r.body as Buffer).toString('latin1');

    expect(r.status).toBe(200);
    expect(pdf.startsWith('%PDF-1.4')).toBe(true);
    expect(pdf).toContain('/Subtype /Image');
    expect(pdf).toContain(`/publico/informes/${id}`);
    // Los modulos del QR son rectangulos rellenos.
    expect((pdf.match(/ re /g) ?? []).length).toBeGreaterThan(100);
  });

  it('un movimiento posterior al cierre se informa, sin invalidar lo que ya se cerro', async () => {
    // Una retencion suelta: el fondo cerrado ya no tiene nada retenido que mover.
    await prisma.movimientoContable.create({
      data: {
        fondoId: origen.fondoId,
        tipo: 'RETENCION',
        cuentaDebe: ASIENTOS.RETENCION.debe,
        cuentaHaber: ASIENTOS.RETENCION.haber,
        monto: 0.01,
        descripcion: 'Movimiento posterior al cierre',
      },
    });
    const v = await informes.verificar(await informeId());
    expect(v.movimientosPosteriores).toBe(1);
    expect(v.sostiene).toBe(true);
    expect(v.conclusion).toContain('1 movimiento(s) posteriores');
  });

  it('un informe que no existe da 404, y un id que no es UUID, 400', async () => {
    expect((await api().get(`/publico/informes/${randomUUID()}`)).status).toBe(404);
    expect((await api().get('/publico/informes/no-es-uuid')).status).toBe(400);
  });
});

describe('Prisma.Decimal en los remanentes', () => {
  it('los montos del remanente suman lo que se repartio', async () => {
    const c = await cierre();
    const suma = c.remanentes.reduce((t, r) => t.plus(r.monto), new Prisma.Decimal(0));
    expect(suma.equals(c.remanenteTotal!)).toBe(true);
  });
});
