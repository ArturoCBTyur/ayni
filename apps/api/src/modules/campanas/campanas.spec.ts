/**
 * Pruebas de Campañas y Fondos (Fase 3).
 *
 * El buscador se lleva la mayor parte: es SQL escrito a mano con muchos
 * parametros opcionales, y ninguna prueba de tipos puede garantizar que la
 * consulta devuelva lo correcto. Tambien se verifica lo que el modelo no
 * debe permitir: publicar una campaña sin fondos o de una ONG sin verificar.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { randomUUID } from 'node:crypto';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import { cargarConfiguracion } from '../../config/configuracion';
import { calcularDigitoVerificadorRuc } from '../verificacion/reglas/ruc';
import { CampanasService } from './campanas.service';
import { OngsService } from './ongs.service';

const marca = randomUUID().slice(0, 8);

let prisma: PrismaService;
let campanas: CampanasService;
let ongs: OngsService;

const usuariosCreados: string[] = [];
const ongsCreadas: string[] = [];

/**
 * Genera un RUC valido por modulo 11, distinto en cada llamada.
 *
 * Los 8 digitos centrales son aleatorios en lugar de secuenciales: si una
 * corrida anterior fallo antes de limpiar, un contador volveria a chocar con
 * las mismas filas y las pruebas fallarian por una razon que no es la suya.
 */
function rucValido(): string {
  const base = `20${Math.floor(10_000_000 + Math.random() * 89_999_999)}`;
  return base + String(calcularDigitoVerificadorRuc(base));
}

async function crearUsuario(rol = 'DONANTE') {
  const filaRol = await prisma.rol.findUniqueOrThrow({ where: { codigo: rol } });
  const usuario = await prisma.usuario.create({
    data: {
      correo: `camp-${marca}-${usuariosCreados.length}@prueba.pe`,
      hashPassword: 'hash-ficticio',
      nombres: 'Usuario',
      apellidos: 'Campañas',
      estado: 'ACTIVO',
      roles: { create: { rolId: filaRol.id } },
    },
  });
  usuariosCreados.push(usuario.id);
  return usuario;
}

const datosOngBase = {
  razonSocial: 'Asociacion de Prueba',
  representanteLegal: 'Ana Maria Perez',
  documentoRepresentante: '44556677',
  direccion: 'Av. Siempre Viva 742',
  departamento: 'Huanuco',
  correoContacto: 'contacto@prueba.pe',
  descripcion: 'Organizacion creada para las pruebas automatizadas del sistema de trazabilidad.',
  aceptaTerminos: true as const,
  versionTerminos: '1.0',
};

/** Crea una ONG verificada con una campaña activa y un fondo. */
async function crearOngConCampana(opciones: {
  titulo: string;
  descripcion: string;
  causa: string;
  departamento?: string;
  verificada?: boolean;
  meta?: number;
  recaudado?: number;
}) {
  const admin = await crearUsuario();
  const auditor = await crearUsuario('AUDITOR');

  const ong = await ongs.registrar(admin.id, { ...datosOngBase, ruc: rucValido() }, {});
  ongsCreadas.push(ong.id);

  if (opciones.verificada !== false) {
    await ongs.verificar(
      ong.id,
      auditor.id,
      { decision: 'VERIFICADA', motivo: 'Documentacion conforme para la prueba automatizada.' },
      {},
    );
  }

  const campana = await campanas.crearCampana(
    ong.id,
    admin.id,
    {
      titulo: opciones.titulo,
      descripcion: opciones.descripcion,
      causa: opciones.causa,
      departamento: opciones.departamento ?? 'Huanuco',
      fechaInicio: new Date('2026-06-01'),
      fechaFin: new Date('2026-12-31'),
    },
    {},
  );

  const fondo = await campanas.crearFondo(
    campana.id,
    admin.id,
    {
      nombre: `Fondo ${marca}-${ongsCreadas.length}`,
      categoriaGasto: 'ALIMENTOS',
      meta: opciones.meta ?? 10_000,
    },
    {},
  );

  if (opciones.recaudado) {
    // El saldo lo mantiene el trigger del libro, no un UPDATE directo.
    await prisma.movimientoContable.create({
      data: {
        fondoId: fondo.id,
        tipo: 'INGRESO',
        cuentaDebe: '10.1 Caja',
        cuentaHaber: '20.1 Fondos por ejecutar',
        monto: opciones.recaudado,
        descripcion: 'Ingreso sembrado para la prueba',
      },
    });
  }

  if (opciones.verificada !== false) {
    await campanas.actualizarCampana(campana.id, admin.id, { estado: 'ACTIVA' }, {});
  }

  return { admin, auditor, ong, campana, fondo };
}

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [PrismaService, BitacoraService, CampanasService, OngsService],
  }).compile();

  prisma = modulo.get(PrismaService);
  campanas = modulo.get(CampanasService);
  ongs = modulo.get(OngsService);
  await prisma.$connect();
}, 30_000);

/**
 * Borra los movimientos sembrados por las pruebas.
 *
 * El libro es de solo insercion por diseño y sus triggers rechazan DELETE,
 * asi que no hay forma de limpiar sin desactivarlos. Se hace solo aqui, solo
 * para las filas de esta corrida, y se reactivan en el finally: si la
 * inmutabilidad quedara apagada, la prueba que la verifica en
 * integridad.spec.ts empezaria a pasar por el motivo equivocado.
 */
async function limpiarLibroDePrueba() {
  if (ongsCreadas.length === 0) return;

  await prisma.$executeRaw`ALTER TABLE movimientos_contables DISABLE TRIGGER tg_movimientos_no_delete`;
  try {
    await prisma.$executeRaw`
      DELETE FROM movimientos_contables
       WHERE fondo_id IN (
         SELECT f.id FROM fondos f
           JOIN campanas c ON c.id = f.campana_id
          WHERE c.ong_id = ANY(${ongsCreadas}::uuid[])
       )
    `;
  } finally {
    await prisma.$executeRaw`ALTER TABLE movimientos_contables ENABLE TRIGGER tg_movimientos_no_delete`;
  }
}

afterAll(async () => {
  await limpiarLibroDePrueba();
  await prisma.fondo.deleteMany({ where: { campana: { ongId: { in: ongsCreadas } } } });
  await prisma.campana.deleteMany({ where: { ongId: { in: ongsCreadas } } });
  await prisma.ongMiembro.deleteMany({ where: { ongId: { in: ongsCreadas } } });
  await prisma.ong.deleteMany({ where: { id: { in: ongsCreadas } } });
  await prisma.bitacoraAuditoria.deleteMany({ where: { usuarioId: { in: usuariosCreados } } });
  await prisma.usuarioRol.deleteMany({ where: { usuarioId: { in: usuariosCreados } } });
  await prisma.usuario.deleteMany({ where: { id: { in: usuariosCreados } } });
  await prisma.$disconnect();
});

describe('Registro y verificacion de ONG (CU08, CU14)', () => {
  it('registra la ONG en estado pendiente y deja al solicitante como administrador', async () => {
    const usuario = await crearUsuario();
    const ong = await ongs.registrar(usuario.id, { ...datosOngBase, ruc: rucValido() }, {});
    ongsCreadas.push(ong.id);

    expect(ong.estadoVerificacion).toBe('PENDIENTE');

    const membresia = await prisma.ongMiembro.findUniqueOrThrow({
      where: { ongId_usuarioId: { ongId: ong.id, usuarioId: usuario.id } },
    });
    expect(membresia.cargo).toBe('ADMINISTRADOR');

    // Y gana el rol de administrador de ONG sin perder el de donante.
    const roles = await prisma.usuarioRol.findMany({
      where: { usuarioId: usuario.id },
      include: { rol: true },
    });
    expect(roles.map((r) => r.rol.codigo).sort()).toEqual(['DONANTE', 'ONG_ADMIN']);
  });

  it('rechaza un RUC ya registrado', async () => {
    const usuario = await crearUsuario();
    const ruc = rucValido();

    const primera = await ongs.registrar(usuario.id, { ...datosOngBase, ruc }, {});
    ongsCreadas.push(primera.id);

    const otro = await crearUsuario();
    await expect(ongs.registrar(otro.id, { ...datosOngBase, ruc }, {})).rejects.toThrow(
      /Ya existe una organizacion/i,
    );
  });

  it('el auditor la verifica y queda el rastro de quien y cuando', async () => {
    const usuario = await crearUsuario();
    const auditor = await crearUsuario('AUDITOR');
    const ong = await ongs.registrar(usuario.id, { ...datosOngBase, ruc: rucValido() }, {});
    ongsCreadas.push(ong.id);

    const r = await ongs.verificar(
      ong.id,
      auditor.id,
      { decision: 'VERIFICADA', motivo: 'RUC activo y documentacion conforme.' },
      { ip: '10.0.0.1' },
    );

    expect(r.estadoVerificacion).toBe('VERIFICADA');
    expect(r.verificadaEn).not.toBeNull();

    const guardada = await prisma.ong.findUniqueOrThrow({ where: { id: ong.id } });
    expect(guardada.verificadaPor).toBe(auditor.id);

    const rastro = await prisma.bitacoraAuditoria.findFirst({
      where: { entidadId: ong.id, accion: 'ONG_VERIFICACION' },
    });
    expect(rastro?.valorAnterior).toMatchObject({ estadoVerificacion: 'PENDIENTE' });
  });

  it('el rechazo conserva el motivo para que la ONG sepa que corregir', async () => {
    const usuario = await crearUsuario();
    const auditor = await crearUsuario('AUDITOR');
    const ong = await ongs.registrar(usuario.id, { ...datosOngBase, ruc: rucValido() }, {});
    ongsCreadas.push(ong.id);

    await ongs.verificar(
      ong.id,
      auditor.id,
      { decision: 'RECHAZADA', motivo: 'Falta la vigencia de poder del representante legal.' },
      {},
    );

    const guardada = await prisma.ong.findUniqueOrThrow({ where: { id: ong.id } });
    expect(guardada.motivoRechazo).toContain('vigencia de poder');
    expect(guardada.verificadaEn).toBeNull();
  });

  it('una ONG rechazada no tiene ficha publica', async () => {
    const usuario = await crearUsuario();
    const auditor = await crearUsuario('AUDITOR');
    const ong = await ongs.registrar(usuario.id, { ...datosOngBase, ruc: rucValido() }, {});
    ongsCreadas.push(ong.id);

    await ongs.verificar(ong.id, auditor.id, { decision: 'RECHAZADA', motivo: 'No corresponde.' }, {});

    await expect(ongs.fichaPublica(ong.id)).rejects.toThrow(/No encontramos/i);
  });
});

describe('Campañas y fondos (CU09)', () => {
  it('no publica una campaña si la ONG no esta verificada', async () => {
    const usuario = await crearUsuario();
    const ong = await ongs.registrar(usuario.id, { ...datosOngBase, ruc: rucValido() }, {});
    ongsCreadas.push(ong.id);

    const campana = await campanas.crearCampana(
      ong.id,
      usuario.id,
      {
        titulo: 'Campaña sin verificar',
        descripcion: 'Descripcion suficientemente larga para pasar la validacion del esquema.',
        causa: 'Bienestar animal',
        fechaInicio: new Date('2026-06-01'),
      },
      {},
    );

    await expect(
      campanas.actualizarCampana(campana.id, usuario.id, { estado: 'ACTIVA' }, {}),
    ).rejects.toThrow(/no esta verificada/i);
  });

  it('no publica una campaña sin fondos', async () => {
    const { ong, admin } = await crearOngConCampana({
      titulo: 'Campaña base para prueba de fondos',
      descripcion: 'Descripcion suficientemente larga para pasar la validacion del esquema.',
      causa: 'Bienestar animal',
    });

    const otra = await campanas.crearCampana(
      ong.id,
      admin.id,
      {
        titulo: 'Campaña sin fondos todavia',
        descripcion: 'Una causa sin destino concreto para el dinero seria la caja negra misma.',
        causa: 'Bienestar animal',
        fechaInicio: new Date('2026-06-01'),
      },
      {},
    );

    await expect(
      campanas.actualizarCampana(otra.id, admin.id, { estado: 'ACTIVA' }, {}),
    ).rejects.toThrow(/al menos un fondo/i);
  });

  it('impide dos fondos con el mismo nombre en una campaña', async () => {
    const { campana, admin } = await crearOngConCampana({
      titulo: 'Campaña con fondos duplicados',
      descripcion: 'Descripcion suficientemente larga para pasar la validacion del esquema.',
      causa: 'Bienestar animal',
    });

    const datos = { nombre: 'Alimentos', categoriaGasto: 'ALIMENTOS' as const, meta: 5000 };
    await campanas.crearFondo(campana.id, admin.id, datos, {});

    await expect(campanas.crearFondo(campana.id, admin.id, datos, {})).rejects.toThrow(
      /Ya existe un fondo con ese nombre/i,
    );
  });

  it('un operador no puede crear campañas', async () => {
    const { ong } = await crearOngConCampana({
      titulo: 'Campaña para prueba de cargos',
      descripcion: 'Descripcion suficientemente larga para pasar la validacion del esquema.',
      causa: 'Bienestar animal',
    });

    const operador = await crearUsuario();
    await prisma.ongMiembro.create({
      data: { ongId: ong.id, usuarioId: operador.id, cargo: 'OPERADOR' },
    });

    await expect(
      campanas.crearCampana(
        ong.id,
        operador.id,
        {
          titulo: 'Campaña de un operador',
          descripcion: 'Descripcion suficientemente larga para pasar la validacion del esquema.',
          causa: 'Bienestar animal',
          fechaInicio: new Date('2026-06-01'),
        },
        {},
      ),
    ).rejects.toThrow(/cargo en la organizacion no permite/i);
  });

  it('quien no pertenece a la ONG no puede tocarla', async () => {
    const { ong } = await crearOngConCampana({
      titulo: 'Campaña ajena',
      descripcion: 'Descripcion suficientemente larga para pasar la validacion del esquema.',
      causa: 'Bienestar animal',
    });

    const extrano = await crearUsuario();
    await expect(campanas.estadoFondos(ong.id, extrano.id)).rejects.toThrow(/No pertenece/i);
  });

  it('genera slugs unicos y legibles', async () => {
    const { ong, admin } = await crearOngConCampana({
      titulo: 'Rescate de invierno',
      descripcion: 'Descripcion suficientemente larga para pasar la validacion del esquema.',
      causa: 'Bienestar animal',
    });

    const segunda = await campanas.crearCampana(
      ong.id,
      admin.id,
      {
        titulo: 'Rescate de invierno',
        descripcion: 'Otra campaña con el mismo titulo para comprobar el sufijo del slug.',
        causa: 'Bienestar animal',
        fechaInicio: new Date('2026-06-01'),
      },
      {},
    );

    expect(segunda.slug).toMatch(/^rescate-de-invierno-\d+$/);
  });
});

describe('Buscador de causas (RF-06, CU02)', () => {
  it('encuentra por texto con raiz y sin acentos', async () => {
    await crearOngConCampana({
      titulo: `Atencion veterinaria de urgencia ${marca}`,
      descripcion: 'Cubrimos cirugias y tratamientos veterinarios para animales rescatados.',
      causa: `Salud animal ${marca}`,
    });

    // "veterinarias" en plural debe encontrar "veterinaria" y "veterinarios":
    // es lo que aporta la configuracion en español del indice.
    const r = await campanas.buscarCausas({
      q: 'veterinarias',
      orden: 'relevancia',
      pagina: 1,
      porPagina: 12,
    });

    expect(r.resultados.some((c) => c.titulo.includes(marca))).toBe(true);
  });

  it('solo muestra campañas activas de ONG verificadas', async () => {
    const { campana, admin } = await crearOngConCampana({
      titulo: `Campaña que sera pausada ${marca}`,
      descripcion: 'Esta campaña se pausa a mitad de la prueba para comprobar que desaparece.',
      causa: `Causa pausable ${marca}`,
    });

    let r = await campanas.buscarCausas({
      causa: `Causa pausable ${marca}`,
      orden: 'recientes',
      pagina: 1,
      porPagina: 12,
    });
    expect(r.total).toBe(1);

    await campanas.actualizarCampana(campana.id, admin.id, { estado: 'PAUSADA' }, {});

    r = await campanas.buscarCausas({
      causa: `Causa pausable ${marca}`,
      orden: 'recientes',
      pagina: 1,
      porPagina: 12,
    });
    expect(r.total).toBe(0);
  });

  it('filtra por departamento y por puntaje minimo', async () => {
    const causa = `Causa regional ${marca}`;
    await crearOngConCampana({
      titulo: `Campaña en Lima ${marca}`,
      descripcion: 'Campaña ubicada en Lima para comprobar el filtro por departamento.',
      causa,
      departamento: 'Lima',
    });
    await crearOngConCampana({
      titulo: `Campaña en Cusco ${marca}`,
      descripcion: 'Campaña ubicada en Cusco para comprobar el filtro por departamento.',
      causa,
      departamento: 'Cusco',
    });

    const lima = await campanas.buscarCausas({
      causa,
      departamento: 'Lima',
      orden: 'recientes',
      pagina: 1,
      porPagina: 12,
    });
    expect(lima.total).toBe(1);
    expect(lima.resultados[0].departamento).toBe('Lima');

    // Las ONG nuevas arrancan en el puntaje neutro, asi que exigir mas de
    // ese valor debe dejarlas fuera.
    const exigente = await campanas.buscarCausas({
      causa,
      puntajeMinimo: 80,
      orden: 'confianza',
      pagina: 1,
      porPagina: 12,
    });
    expect(exigente.total).toBe(0);
  });

  it('calcula el avance de la meta y permite filtrar por el', async () => {
    const causa = `Causa con avance ${marca}`;
    await crearOngConCampana({
      titulo: `Campaña muy avanzada ${marca}`,
      descripcion: 'Campaña con recaudacion alta para comprobar el calculo del avance.',
      causa,
      meta: 1000,
      recaudado: 800,
    });
    await crearOngConCampana({
      titulo: `Campaña apenas iniciada ${marca}`,
      descripcion: 'Campaña con recaudacion baja para comprobar el filtro de avance minimo.',
      causa,
      meta: 1000,
      recaudado: 50,
    });

    const todas = await campanas.buscarCausas({
      causa,
      orden: 'avance',
      pagina: 1,
      porPagina: 12,
    });
    expect(todas.total).toBe(2);
    // Ordenado por avance: la de 80 % va primero.
    expect(todas.resultados[0].avance).toBe(80);

    const avanzadas = await campanas.buscarCausas({
      causa,
      avanceMinimo: 50,
      orden: 'avance',
      pagina: 1,
      porPagina: 12,
    });
    expect(avanzadas.total).toBe(1);
  });

  it('pagina sin perder ni repetir resultados', async () => {
    const causa = `Causa paginada ${marca}`;
    for (let i = 0; i < 3; i += 1) {
      await crearOngConCampana({
        titulo: `Campaña paginada ${i} ${marca}`,
        descripcion: 'Campaña creada para comprobar que la paginacion no pierde resultados.',
        causa,
      });
    }

    const p1 = await campanas.buscarCausas({ causa, orden: 'recientes', pagina: 1, porPagina: 2 });
    const p2 = await campanas.buscarCausas({ causa, orden: 'recientes', pagina: 2, porPagina: 2 });

    expect(p1.total).toBe(3);
    expect(p1.paginas).toBe(2);
    expect(p1.resultados).toHaveLength(2);
    expect(p2.resultados).toHaveLength(1);

    const ids = [...p1.resultados, ...p2.resultados].map((c) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('una busqueda sin coincidencias devuelve vacio, no un error', async () => {
    const r = await campanas.buscarCausas({
      q: 'xyzzyplughquux',
      orden: 'relevancia',
      pagina: 1,
      porPagina: 12,
    });

    expect(r.total).toBe(0);
    expect(r.resultados).toEqual([]);
    expect(r.paginas).toBe(0);
  });
});

describe('Ficha publica y puntaje (RF-SO-01)', () => {
  it('expone el sello y el desglose del puntaje', async () => {
    const { ong } = await crearOngConCampana({
      titulo: `Campaña con ficha ${marca}`,
      descripcion: 'Campaña usada para comprobar la ficha publica de la organizacion.',
      causa: `Causa con ficha ${marca}`,
    });

    const ficha = await ongs.fichaPublica(ong.id);

    expect(ficha.verificada).toBe(true);
    expect(ficha.confianza.componentes).toHaveLength(3);
    // Sin gastos todavia, el puntaje es neutro y lo dice explicitamente.
    expect(ficha.confianza.historialInsuficiente).toBe(true);
    expect(ficha.campanas.length).toBeGreaterThan(0);
    expect(ficha.campanas[0].fondos[0].avance).toBe(0);
  });

  it('el recalculo persiste el puntaje y su desglose', async () => {
    const { ong } = await crearOngConCampana({
      titulo: `Campaña para recalculo ${marca}`,
      descripcion: 'Campaña usada para comprobar que el recalculo del puntaje se persiste.',
      causa: `Causa recalculo ${marca}`,
    });

    await ongs.calcularPuntaje(ong.id);

    const guardada = await prisma.ong.findUniqueOrThrow({ where: { id: ong.id } });
    expect(Number(guardada.puntajeConfianza)).toBe(50);
    expect(guardada.desglosePuntaje).toMatchObject({ historialInsuficiente: true });
  });
});
