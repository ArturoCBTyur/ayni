/**
 * Seed base del sistema.
 *
 * Crea lo minimo para que la plataforma sea operable: roles, la regla de
 * umbrales vigente, el motor de verificacion registrado como version, los
 * instrumentos de SOC-1 y PSI-1, y las cinco cuentas de prueba de la Tabla 20
 * del Entregable 2.
 *
 * Es idempotente: se puede correr varias veces sin duplicar nada.
 *
 * El seed de demostracion (ONG, campañas, donaciones y gastos que recorren
 * el guion de la seccion 8.1) vive aparte, en seed-demo.ts.
 */
import { hash } from '@node-rs/argon2';
import { CategoriaGasto, PrismaClient } from '@prisma/client';

import { publicarInstrumentos } from '../src/modules/encuestas/publicacion';
import { calcularDigitoVerificadorRuc } from '../src/modules/verificacion/reglas/ruc';

const prisma = new PrismaClient();

/**
 * Contraseña unica de las cuentas de demostracion.
 *
 * Son datos ficticios a proposito: la seccion 8.2 del entregable pide no
 * usar datos personales reales en la demo, en coherencia con el bloque de
 * Derecho. Esta credencial no debe existir en un despliegue real.
 */
const CLAVE_DEMO = 'Demo.2026!tr';

const ROLES = [
  {
    codigo: 'DONANTE',
    nombre: 'Donante',
    descripcion: 'Aporta a fondos y recibe evidencia del impacto.',
  },
  {
    codigo: 'ONG_ADMIN',
    nombre: 'Administrador de ONG',
    descripcion: 'Crea campañas y fondos de su organizacion.',
  },
  {
    codigo: 'ONG_OPERADOR',
    nombre: 'Operador de ONG',
    descripcion: 'Registra gastos con comprobante y evidencia desde el celular.',
  },
  {
    codigo: 'AUDITOR',
    nombre: 'Auditor',
    descripcion: 'Verifica ONG, revisa casos de confianza media y audita la conciliacion.',
  },
  {
    codigo: 'ADMIN',
    nombre: 'Administrador de plataforma',
    descripcion: 'Gestiona usuarios, roles, umbrales e indicadores.',
  },
] as const;

const CUENTAS = [
  { correo: 'donante@demo.pe', nombres: 'Rosa Elena', apellidos: 'Chavez Flores', rol: 'DONANTE' },
  {
    correo: 'ong.admin@demo.pe',
    nombres: 'Miguel Angel',
    apellidos: 'Tapia Rojas',
    rol: 'ONG_ADMIN',
  },
  {
    correo: 'ong.operador@demo.pe',
    nombres: 'Lucia',
    apellidos: 'Vargas Huaman',
    rol: 'ONG_OPERADOR',
  },
  {
    correo: 'auditor@demo.pe',
    nombres: 'Carlos Alberto',
    apellidos: 'Mendoza Silva',
    rol: 'AUDITOR',
  },
  { correo: 'admin@demo.pe', nombres: 'Sofia', apellidos: 'Ramirez Leon', rol: 'ADMIN' },
] as const;

/** Construye un RUC valido por modulo 11 a partir de una base de 10 digitos. */
function rucValido(base10: string): string {
  return base10 + String(calcularDigitoVerificadorRuc(base10));
}

async function sembrarRoles() {
  for (const rol of ROLES) {
    await prisma.rol.upsert({
      where: { codigo: rol.codigo },
      update: { nombre: rol.nombre, descripcion: rol.descripcion },
      create: rol,
    });
  }
  console.info(`  roles: ${ROLES.length}`);
}

/**
 * Regla de umbrales vigente.
 *
 * ALTO > 90 viene del pitch deck. El limite de 60 entre MEDIO y BAJO es la
 * decision inicial del equipo declarada en el Anexo A, a calibrar con los
 * datos del piloto. Los pesos son los del ADR-0005.
 */
async function sembrarReglaConfianza() {
  const existente = await prisma.reglaConfianza.findFirst({ where: { activa: true } });
  if (existente) {
    console.info('  regla de confianza: ya existia una activa');
    return;
  }

  const regla = await prisma.reglaConfianza.create({
    data: {
      umbralAlto: 90,
      umbralMedio: 60,
      pesoDocumental: 0.45,
      pesoVisual: 0.25,
      pesoAnomalia: 0.3,
      activa: true,
    },
  });
  console.info(`  regla de confianza: ALTO>${regla.umbralAlto} MEDIO>=${regla.umbralMedio}`);
}

/**
 * Registra el motor de reglas como una version mas en modelos_ia.
 *
 * No es un adorno: es lo que permite que, cuando AIni entre, se puedan
 * comparar sus metricas contra esta linea base usando las etiquetas que los
 * auditores vayan dejando en revisiones_auditoria (RF-IA-11).
 */
async function sembrarMotor() {
  // AIni queda registrada en EN_PRUEBAS y no ACTIVO: existir en el catalogo
  // es lo que permite comparar sus analisis contra los del motor de reglas,
  // pero declararla activa sin haberla evaluado seria afirmar algo que todavia
  // nadie midio. La activa el administrador cuando las metricas lo respalden.
  await prisma.modeloIa.upsert({
    where: { nombre_version: { nombre: 'motor-verificacion', version: 'aini-0.1-sklearn' } },
    update: {},
    create: {
      nombre: 'motor-verificacion',
      version: 'aini-0.1-sklearn',
      tipo: 'ML_CLASICO',
      descripcion:
        'AIni basica: Isolation Forest sobre el perfil del gasto (scikit-learn) y ' +
        'coherencia semantica concepto/categoria con vectores de palabras (spaCy ' +
        'es_core_news_md). Corre en apps/aini como servicio propio, sin API externa.',
      estado: 'EN_PRUEBAS',
      metricas: {
        nota:
          'El detector de anomalias se entreno con un conjunto mayoritariamente ' +
          'sintetico; reconoce lo que esa distribucion considera raro. Ver ' +
          'apps/aini/modelos/anomalia.ficha.json.',
      },
    },
  });

  const motor = await prisma.modeloIa.upsert({
    where: { nombre_version: { nombre: 'motor-verificacion', version: 'reglas-v0' } },
    update: { estado: 'ACTIVO' },
    create: {
      nombre: 'motor-verificacion',
      version: 'reglas-v0',
      tipo: 'REGLAS',
      descripcion:
        'Motor determinista sin IA: modulo 11 del RUC, aritmetica del comprobante, ' +
        'dHash perceptual y reglas estadisticas de anomalia. Linea base contra la ' +
        'que se comparara AIni.',
      estado: 'ACTIVO',
      activadoEn: new Date(),
      metricas: {
        nota: 'Linea base sin IA. Las metricas se llenan con el muestreo de auditoria (RN-08).',
      },
    },
  });
  console.info(`  motor: ${motor.nombre}@${motor.version} (${motor.estado})`);
}

async function sembrarCuentas() {
  const hashClave = await hash(CLAVE_DEMO);

  for (const cuenta of CUENTAS) {
    const usuario = await prisma.usuario.upsert({
      where: { correo: cuenta.correo },
      update: {},
      create: {
        correo: cuenta.correo,
        hashPassword: hashClave,
        nombres: cuenta.nombres,
        apellidos: cuenta.apellidos,
        estado: 'ACTIVO',
        correoVerificadoEn: new Date(),
      },
    });

    const rol = await prisma.rol.findUniqueOrThrow({ where: { codigo: cuenta.rol } });
    await prisma.usuarioRol.upsert({
      where: { usuarioId_rolId: { usuarioId: usuario.id, rolId: rol.id } },
      update: {},
      create: { usuarioId: usuario.id, rolId: rol.id },
    });

    // Consentimientos: tratamiento de datos y comunicaciones. Sin el de
    // comunicaciones, el trigger de la BD bloquea las narrativas.
    for (const finalidad of ['TRATAMIENTO_DATOS', 'COMUNICACIONES'] as const) {
      const ya = await prisma.consentimiento.findFirst({
        where: { usuarioId: usuario.id, finalidad, revocadoEn: null },
      });
      if (!ya) {
        await prisma.consentimiento.create({
          data: { usuarioId: usuario.id, finalidad, versionPolitica: '1.0', otorgado: true },
        });
      }
    }

    if (cuenta.rol === 'DONANTE') {
      await prisma.donante.upsert({
        where: { usuarioId: usuario.id },
        update: {},
        create: { usuarioId: usuario.id, alias: 'Rosa E.', frecuenciaNotificacion: 'CADA_GASTO' },
      });
    }
  }
  console.info(`  cuentas: ${CUENTAS.length} (clave comun: ${CLAVE_DEMO})`);
}

/**
 * ONG piloto: rescate y bienestar animal, el caso que el pitch deck usa
 * para ilustrar el viaje de la donacion.
 */
async function sembrarOngPiloto() {
  const ruc = rucValido('2060103057');
  const auditor = await prisma.usuario.findUniqueOrThrow({ where: { correo: 'auditor@demo.pe' } });

  const ong = await prisma.ong.upsert({
    where: { ruc },
    update: {},
    create: {
      ruc,
      razonSocial: 'Asociacion Refugio Huellas del Ande',
      nombreComercial: 'Huellas del Ande',
      representanteLegal: 'Maria Isabel Quispe Ccahuana',
      documentoRepresentante: '44215678',
      direccion: 'Jr. Ayacucho 512',
      departamento: 'Huanuco',
      provincia: 'Huanuco',
      distrito: 'Amarilis',
      correoContacto: 'contacto@huellasdelande.demo.pe',
      telefono: '962555111',
      descripcion:
        'Refugio de rescate y bienestar animal. Atiende perros y gatos en situacion de ' +
        'abandono: alimentacion, atencion veterinaria y campañas de esterilizacion.',
      estadoVerificacion: 'VERIFICADA',
      verificadaEn: new Date(),
      verificadaPor: auditor.id,
      puntajeConfianza: 72.5,
      desglosePuntaje: {
        cumplimientoEvidencias: 80,
        tiempoRespuesta: 70,
        observacionesResueltas: 65,
        nota: 'Puntaje inicial del piloto. Se recalcula con cada gasto resuelto (RF-IA-12).',
      },
      cuentaRecaudacion: '191-2345678-0-12',
      banco: 'BCP',
      terminosAceptadosEn: new Date(),
      versionTerminos: '1.0',
    },
  });

  // Vincular el administrador y el operador de ONG.
  for (const [correo, cargo] of [
    ['ong.admin@demo.pe', 'ADMINISTRADOR'],
    ['ong.operador@demo.pe', 'OPERADOR'],
  ] as const) {
    const u = await prisma.usuario.findUniqueOrThrow({ where: { correo } });
    await prisma.ongMiembro.upsert({
      where: { ongId_usuarioId: { ongId: ong.id, usuarioId: u.id } },
      update: {},
      create: { ongId: ong.id, usuarioId: u.id, cargo },
    });
  }

  const campanas = [
    {
      slug: 'rescate-invierno-2026',
      titulo: 'Rescate de invierno 2026',
      causa: 'Bienestar animal',
      descripcion:
        'Cada invierno aumentan los rescates de animales en abandono. Esta campaña cubre ' +
        'alimentacion y atencion veterinaria de los rescatados entre junio y setiembre.',
      fondos: [
        {
          nombre: 'Alimentos para rescate animal',
          categoriaGasto: CategoriaGasto.ALIMENTOS,
          meta: 8000,
        },
        {
          nombre: 'Atencion veterinaria',
          categoriaGasto: CategoriaGasto.ATENCION_VETERINARIA,
          meta: 12000,
        },
      ],
    },
    {
      slug: 'esterilizacion-comunitaria',
      titulo: 'Esterilizacion comunitaria',
      causa: 'Bienestar animal',
      descripcion:
        'Jornadas de esterilizacion gratuita en barrios de Amarilis, para reducir la ' +
        'poblacion de animales sin hogar de forma sostenible.',
      fondos: [
        {
          nombre: 'Jornadas de esterilizacion',
          categoriaGasto: CategoriaGasto.ESTERILIZACION,
          meta: 15000,
        },
        {
          nombre: 'Medicamentos post operatorios',
          categoriaGasto: CategoriaGasto.MEDICAMENTOS,
          meta: 4000,
        },
      ],
    },
  ];

  for (const c of campanas) {
    const campana = await prisma.campana.upsert({
      where: { slug: c.slug },
      update: {},
      create: {
        ongId: ong.id,
        titulo: c.titulo,
        slug: c.slug,
        descripcion: c.descripcion,
        causa: c.causa,
        departamento: 'Huanuco',
        fechaInicio: new Date('2026-06-01'),
        fechaFin: new Date('2026-12-31'),
        estado: 'ACTIVA',
      },
    });

    for (const f of c.fondos) {
      const ya = await prisma.fondo.findFirst({
        where: { campanaId: campana.id, nombre: f.nombre },
      });
      if (!ya) {
        await prisma.fondo.create({ data: { campanaId: campana.id, ...f } });
      }
    }
  }

  const fondos = await prisma.fondo.count();
  console.info(
    `  ONG piloto: ${ong.nombreComercial} (RUC ${ruc}) · ${campanas.length} campañas · ${fondos} fondos`,
  );
}

async function main() {
  console.info('Sembrando datos base de Ayni...');
  await sembrarRoles();
  await sembrarReglaConfianza();
  await sembrarMotor();
  // Fase 4: sin una version activa, nadie podria responder las encuestas.
  const instrumentos = await publicarInstrumentos(prisma);
  console.info(
    `  instrumentos: ${instrumentos.length ? instrumentos.join(', ') : 'ya publicados'}`,
  );
  await sembrarCuentas();
  await sembrarOngPiloto();
  console.info('Listo.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => void prisma.$disconnect());
