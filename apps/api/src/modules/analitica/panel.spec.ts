/**
 * El inicio de cada rol (GET /analitica/panel).
 *
 * Lo que se fija: que cada seccion aparezca solo para quien tiene el rol o
 * la membresia que la justifica, y que sus cifras salgan de lo que de verdad
 * hay en la base. La base de pruebas tiene datos de otras suites, asi que lo
 * global (casos del auditor) se comprueba como "al menos", y lo propio de
 * esta suite (su ONG, su donante) con valores exactos.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { createHash, randomUUID } from 'node:crypto';

import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { PanelService } from './panel.service';

const marca = randomUUID().slice(0, 8);

let prisma: PrismaService;
let panel: PanelService;

const usuarios: string[] = [];
let ongId: string;
let donanteUsuarioId: string;
let miembroId: string;
let ajenoId: string;

async function crearUsuario(etiqueta: string, roles: string[], conDonante = false) {
  const catalogo = await prisma.rol.findMany({ where: { codigo: { in: roles } } });
  const u = await prisma.usuario.create({
    data: {
      correo: `panel-${etiqueta}-${marca}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: etiqueta,
      apellidos: 'Panel',
      estado: 'ACTIVO',
      roles: { create: catalogo.map((r) => ({ rolId: r.id })) },
      ...(conDonante ? { donante: { create: {} } } : {}),
    },
    include: { donante: true },
  });
  usuarios.push(u.id);
  return u;
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [PrismaService, PanelService],
  }).compile();
  prisma = modulo.get(PrismaService);
  panel = modulo.get(PanelService);
  await prisma.$connect();

  const miembro = await crearUsuario('miembro', ['ONG_ADMIN']);
  miembroId = miembro.id;
  ajenoId = (await crearUsuario('ajeno', ['ONG_OPERADOR'])).id;
  const donante = await crearUsuario('donante', ['DONANTE'], true);
  donanteUsuarioId = donante.id;

  const ong = await prisma.ong.create({
    data: {
      ruc: `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}1`,
      razonSocial: `ONG del panel ${marca}`,
      representanteLegal: 'Representante',
      documentoRepresentante: '00000000',
      direccion: 'Sin direccion',
      departamento: 'Huanuco',
      correoContacto: `panel-${marca}@prueba.pe`,
      estadoVerificacion: 'VERIFICADA',
      miembros: { create: { usuarioId: miembro.id, cargo: 'ADMINISTRADOR' } },
    },
  });
  ongId = ong.id;

  const activa = await prisma.campana.create({
    data: {
      ongId,
      titulo: `Activa ${marca}`,
      slug: `panel-activa-${marca}`,
      descripcion: 'Campaña activa del panel.',
      causa: 'Pruebas',
      fechaInicio: new Date('2026-01-01'),
      estado: 'ACTIVA',
    },
  });
  await prisma.campana.create({
    data: {
      ongId,
      titulo: `Borrador ${marca}`,
      slug: `panel-borrador-${marca}`,
      descripcion: 'Campaña en borrador del panel.',
      causa: 'Pruebas',
      fechaInicio: new Date('2026-01-01'),
    },
  });
  const fondo = await prisma.fondo.create({
    data: { campanaId: activa.id, nombre: `Fondo ${marca}`, categoriaGasto: 'ALIMENTOS', meta: 1000 },
  });

  await prisma.donacion.create({
    data: {
      donanteId: donante.donante!.id,
      fondoId: fondo.id,
      monto: 100,
      montoNeto: 100,
      estado: 'CONFIRMADA',
      confirmadaEn: new Date(),
    },
  });

  // Un caso en revision recibido hace dos semanas: fuera de las 48 h habiles.
  await prisma.gasto.create({
    data: {
      fondoId: fondo.id,
      ongId,
      registradoPor: miembro.id,
      montoDeclarado: 40,
      concepto: 'gasto del panel',
      proveedorNombre: 'Proveedor',
      fechaGasto: new Date('2026-09-01'),
      estado: 'EN_REVISION',
      creadoEn: new Date(Date.now() - 14 * 24 * 3_600_000),
      evidencias: {
        create: {
          archivoUrl: `evidencias/panel-${marca}.jpg`,
          archivoMime: 'image/jpeg',
          archivoBytes: 10,
          hashSha256: createHash('sha256').update(`panel-${marca}`).digest('hex'),
          contienePersonas: true,
          anonimizada: false,
        },
      },
    },
  });
}, 30_000);

afterAll(async () => {
  await prisma.evidencia.deleteMany({ where: { gasto: { ongId } } });
  await prisma.gasto.deleteMany({ where: { ongId } });
  await prisma.donacion.deleteMany({ where: { fondo: { campana: { ongId } } } });
  await prisma.fondo.deleteMany({ where: { campana: { ongId } } });
  await prisma.campana.deleteMany({ where: { ongId } });
  await prisma.ongMiembro.deleteMany({ where: { ongId } });
  await prisma.ong.delete({ where: { id: ongId } });
  await prisma.donante.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuarios } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuarios } } });
  await prisma.$disconnect();
});

describe('Inicio de cada rol', () => {
  it('el donante ve lo que aporto y lo que espera evidencia, y nada mas', async () => {
    const p = await panel.panel(donanteUsuarioId, ['DONANTE']);

    expect(p.donante).toMatchObject({
      aportes: 1,
      aportado: '100.00',
      ejecutado: '0.00',
      esperandoEvidencia: '100.00',
      causasApoyadas: 1,
    });
    expect(p.ongs).toBeNull();
    expect(p.auditor).toBeNull();
    expect(p.administrador).toBeNull();
  });

  it('la ONG ve sus campañas, sus gastos y las fotos que faltan difuminar', async () => {
    const p = await panel.panel(miembroId, ['ONG_ADMIN']);

    expect(p.ongs).toHaveLength(1);
    expect(p.ongs![0]).toMatchObject({
      id: ongId,
      cargo: 'ADMINISTRADOR',
      campanas: { ACTIVA: 1, BORRADOR: 1 },
      gastos: { EN_REVISION: 1 },
      meta: '1000.00',
      fotosPorDifuminar: 1,
      equipoActivo: 1,
    });
  });

  it('el rol no basta: sin membresia activa no hay seccion de ONG', async () => {
    const p = await panel.panel(ajenoId, ['ONG_OPERADOR']);
    expect(p.ongs).toBeNull();
  });

  it('el auditor ve la cola con los casos fuera de plazo', async () => {
    const p = await panel.panel(randomUUID(), ['AUDITOR']);

    expect(p.auditor!.casosEnRevision).toBeGreaterThanOrEqual(1);
    expect(p.auditor!.casosVencidos).toBeGreaterThanOrEqual(1);
    expect(p.auditor!.casosVencidos).toBeLessThanOrEqual(p.auditor!.casosEnRevision);
    expect(p.administrador).toBeNull();
  });

  it('el administrador ve tambien lo suyo', async () => {
    const p = await panel.panel(randomUUID(), ['ADMIN']);

    expect(p.auditor).not.toBeNull();
    expect(p.administrador).toEqual({
      arcoPendientes: expect.any(Number) as number,
      arcoVencidas: expect.any(Number) as number,
      colaPendiente: expect.any(Number) as number,
      colaFallida: expect.any(Number) as number,
      usuariosBloqueados: expect.any(Number) as number,
    });
  });
});
