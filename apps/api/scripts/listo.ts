/**
 * ¿Está todo listo para demostrar en vivo?
 *
 *   npm run demo:listo
 *
 * Una lista de comprobación en prosa se lee por encima y se da por buena. Esto
 * lo comprueba: los tres servicios, el motor que de verdad está conectado, el
 * estado de los seis gastos del guion, el saldo que queda para subir uno nuevo,
 * los archivos que se van a adjuntar, y los códigos del segundo factor con lo
 * que les queda de vida.
 *
 * Termina diciendo LISTO o lo que falta. Correrlo cinco minutos antes es la
 * diferencia entre descubrir un problema a solas y descubrirlo con público.
 *
 * No modifica nada: solo lee.
 */
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { PrismaClient } from '@prisma/client';
import { authenticator } from 'otplib';

import { abrirTexto, contextoTotp, crearLlavero } from '../src/comun/cifrado/sobre';

const prisma = new PrismaClient();
// Con CIFRADO_CLAVE definida los secretos TOTP están cifrados en la base
// (RNF-01): el código se calcula sobre el secreto abierto, no sobre el sobre.
const LLAVERO = crearLlavero(process.env.CIFRADO_CLAVE, process.env.CIFRADO_CLAVES_ANTERIORES);

const VERDE = '\x1b[32m';
const ROJO = '\x1b[31m';
const AMBAR = '\x1b[33m';
const GRIS = '\x1b[90m';
const FIN = '\x1b[0m';

const AINI = 'http://127.0.0.1:8000';
const API = 'http://127.0.0.1:3000/api/v1';
const WEB = 'http://127.0.0.1:5000';
// La que se abre en el navegador. CORS_ORIGENES admite localhost y no
// 127.0.0.1: son origenes distintos, y desde el segundo el inicio de sesion
// falla aunque la pagina cargue.
const WEB_NAVEGADOR = 'http://localhost:5000';

/** Carpeta donde `python probar.py archivos` deja las boletas. */
const CARPETA_BOLETAS = join(homedir(), 'Desktop', 'boletas-ayni');

const ARCHIVOS = [
  '1-boleta-de-78.jpg',
  '2-boleta-de-78-pero-declare-140.jpg',
  '3-boleta-ilegible.jpg',
  'evidencia-1.jpg',
  'evidencia-2.jpg',
  'evidencia-3.jpg',
];

/** Los comprobantes que el acto en vivo va a usar: tienen que estar libres. */
const NUMEROS_EN_VIVO = ['006101', '006102', '006103'];

const faltas: string[] = [];

function ok(etiqueta: string, detalle: string): void {
  console.log(`  ${VERDE}ok   ${FIN} ${etiqueta.padEnd(30)} ${GRIS}${detalle}${FIN}`);
}

function mal(etiqueta: string, detalle: string, arreglo: string): void {
  console.log(`  ${ROJO}FALTA${FIN} ${etiqueta.padEnd(30)} ${detalle}`);
  console.log(`        ${GRIS}${arreglo}${FIN}`);
  faltas.push(etiqueta);
}

function aviso(etiqueta: string, detalle: string): void {
  console.log(`  ${AMBAR}ojo  ${FIN} ${etiqueta.padEnd(30)} ${detalle}`);
}

function titulo(texto: string): void {
  console.log(`\n${texto}`);
  console.log('-'.repeat(74));
}

/**
 * La forma de `/salud` de AIni, solo en lo que se comprueba aqui.
 *
 * Se declara en vez de leer `any`: un cambio de nombre en el servicio deberia
 * romper este script al compilar, no en silencio delante del publico.
 */
type SaludAIni = {
  versionModelo?: string;
  modeloLenguaje?: string;
  lectorComprobantes?: { activo?: boolean };
  detectorAnomalias?: { disponible?: boolean; entrenadoCon?: number };
};

type SaludApi = {
  servicio?: string;
  version?: string;
  motorVerificacion?: string;
  baseDatos?: { conectada?: boolean; version?: string; latenciaMs?: number };
};

async function pedirJson<T>(url: string, ms = 4000): Promise<T | null> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function responde(url: string, ms = 4000): Promise<boolean> {
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(ms) });
    return r.status < 500;
  } catch {
    return false;
  }
}

async function servicios(): Promise<void> {
  titulo('Servicios');

  const aini = await pedirJson<SaludAIni>(`${AINI}/salud`);
  if (!aini) {
    mal(
      'AIni',
      'no responde en el puerto 8000',
      'cd apps/aini  ·  python -m uvicorn aini.main:app --host 127.0.0.1 --port 8000',
    );
  } else {
    ok('AIni', `${aini.versionModelo} · ${aini.modeloLenguaje}`);

    if (aini.lectorComprobantes?.activo) {
      ok('Lector de comprobantes', 'activo');
    } else {
      mal(
        'Lector de comprobantes',
        'apagado: todo gasto dira "no se pudo leer"',
        'quite AINI_OCR=0 del entorno y reinicie AIni',
      );
    }

    if (aini.detectorAnomalias?.disponible) {
      ok('Detector de anomalias', `entrenado con ${aini.detectorAnomalias.entrenadoCon} gastos`);
    } else {
      mal(
        'Detector de anomalias',
        'sin modelo entrenado',
        'cd apps/aini  ·  python -m entrenamiento.entrenar',
      );
    }
  }

  const api = await pedirJson<SaludApi>(`${API}/salud`);
  if (!api) {
    mal('Backend', 'no responde en el puerto 3000', 'cd apps/api  ·  npm run start:prod');
  } else {
    ok('Backend', `${api.servicio} ${api.version ?? ''}`.trim());

    // Lo que de verdad esta conectado, no lo que dice el .env: si el backend
    // arranco antes de cambiar la variable, el .env miente.
    if (api.motorVerificacion === 'aini' && !aini) {
      // La combinacion silenciosa y la peor de todas: el backend cree que
      // verifica con la IA, AIni no esta, y cada gasto nuevo se analiza con el
      // motor de reglas sin que nada en la pantalla lo diga. Es el respaldo
      // funcionando como debe --mejor reglas que nada-- y a la vez la unica
      // forma de llegar a la exposicion ensenando IA sin ensenar IA.
      mal(
        'Motor conectado',
        'dice "aini" pero AIni no responde: los gastos nuevos caeran al motor de reglas',
        'levante AIni primero y vuelva a correr esto; el backend no hace falta reiniciarlo',
      );
    } else if (api.motorVerificacion === 'aini') {
      ok('Motor conectado', 'aini');
    } else {
      mal(
        'Motor conectado',
        `${api.motorVerificacion} — los analisis nuevos NO usaran la IA`,
        'ponga VERIFICACION_DRIVER=aini en apps/api/.env y reinicie el backend',
      );
    }

    if (api.baseDatos?.conectada) {
      ok(
        'Base de datos',
        `${api.baseDatos.version ?? ''} · ${api.baseDatos.latenciaMs ?? '?'} ms`.trim(),
      );
    } else {
      mal('Base de datos', 'el backend no la alcanza', 'revise que PostgreSQL escuche en el 5433');
    }
  }

  if (await responde(WEB)) {
    ok('Aplicacion web', WEB_NAVEGADOR);
  } else {
    mal(
      'Aplicacion web',
      'no responde en el puerto 5000',
      'cd apps/app/build/web  ·  python -m http.server 5000',
    );
  }
}

async function escenario(): Promise<void> {
  titulo('El escenario del guion');

  const fondo = await prisma.fondo.findFirst({
    where: { nombre: 'Atencion veterinaria' },
    include: { campana: true },
  });

  if (!fondo) {
    mal(
      'Fondo de la demostracion',
      'no existe',
      'cd apps/api  ·  npx tsx prisma/seed-demo.ts  ·  npm run demo:preparar',
    );
    return;
  }

  const gastos = await prisma.gasto.findMany({
    where: { fondoId: fondo.id },
    include: {
      comprobante: true,
      analisis: { orderBy: { creadoEn: 'desc' }, take: 1, include: { modelo: true } },
    },
    orderBy: { creadoEn: 'asc' },
  });

  const esperados = [
    { monto: 118, estado: 'APROBADO' },
    { monto: 189, estado: 'EN_REVISION' },
    { monto: 64, estado: 'APROBADO' },
    { monto: 72, estado: 'OBSERVADO' },
    { monto: 145, estado: 'EN_REVISION' },
    { monto: 185, estado: 'EN_REVISION' },
  ];

  console.log(`  ${GRIS}monto     estado        nivel          motor${FIN}`);
  for (const g of gastos) {
    const a = g.analisis[0];
    const nivel = a ? `${a.nivel} ${String(a.scoreFinal)}` : 'sin analisis';
    const motor = a?.modelo.version ?? '—';
    const marca = a ? `${VERDE}·${FIN}` : `${AMBAR}!${FIN}`;
    console.log(
      `  ${marca} S/ ${String(g.montoDeclarado).padStart(6)}  ${g.estado.padEnd(12)}  ` +
        `${nivel.padEnd(14)} ${GRIS}${motor}${FIN}`,
    );
  }

  const faltantes = esperados.filter(
    (e) => !gastos.some((g) => Number(g.montoDeclarado) === e.monto && g.estado === e.estado),
  );
  if (faltantes.length === 0) {
    ok('Los seis casos del guion', 'en el estado que espera la chuleta');
  } else {
    mal(
      'Casos del guion',
      `faltan ${faltantes.map((f) => `S/ ${f.monto} ${f.estado}`).join(', ')}`,
      'cd apps/api  ·  npm run demo:preparar',
    );
  }

  const enRevision = gastos.filter((g) => g.estado === 'EN_REVISION').length;
  if (enRevision > 0) {
    ok('Bandeja del auditor', `${enRevision} caso(s) esperando decision`);
  } else {
    mal(
      'Bandeja del auditor',
      'vacia: el momento en que decide una persona no tendria que mostrar',
      'cd apps/api  ·  npm run demo:preparar',
    );
  }

  const retenido = Number(fondo.saldoRetenido);
  console.log(
    `\n  ${GRIS}Fondo "${fondo.nombre}": recaudado S/ ${String(fondo.saldoRecaudado)} · ` +
      `retenido S/ ${String(fondo.saldoRetenido)} · ` +
      `ejecutado S/ ${String(fondo.saldoEjecutado)}${FIN}`,
  );
  if (retenido >= 140) {
    ok('Saldo para el acto en vivo', `S/ ${retenido.toFixed(2)} retenidos`);
  } else {
    aviso(
      'Saldo para el acto en vivo',
      `solo S/ ${retenido.toFixed(2)}: un gasto de S/ 140 se bloqueara por saldo insuficiente`,
    );
  }
}

async function actoEnVivo(): Promise<void> {
  titulo('El acto en vivo');

  const presentes = ARCHIVOS.filter((a) => existsSync(join(CARPETA_BOLETAS, a)));
  if (presentes.length === ARCHIVOS.length) {
    ok('Boletas y evidencias', `${CARPETA_BOLETAS}`);
  } else {
    mal(
      'Boletas y evidencias',
      `faltan ${ARCHIVOS.length - presentes.length} de ${ARCHIVOS.length} en ${CARPETA_BOLETAS}`,
      'cd apps/aini  ·  python probar.py archivos',
    );
  }

  const usados = await prisma.comprobante.findMany({
    where: { numero: { in: NUMEROS_EN_VIVO } },
    select: { serie: true, numero: true },
  });

  if (usados.length === 0) {
    ok('Numeros de comprobante', `${NUMEROS_EN_VIVO.join(', ')} libres`);
  } else {
    aviso(
      'Numeros de comprobante',
      `ya usados: ${usados.map((u) => `${u.serie}-${u.numero}`).join(', ')}. ` +
        'Use otro numero en vivo o la base lo rechazara por duplicado.',
    );
  }
}

async function segundoFactor(): Promise<void> {
  titulo('Codigos del segundo factor');

  const cuentas = [
    'ong.operador@demo.pe',
    'auditor@demo.pe',
    'ong.admin@demo.pe',
    'admin@demo.pe',
  ];

  let sinEnrolar = 0;
  for (const correo of cuentas) {
    const u = await prisma.usuario.findUnique({ where: { correo } });
    if (!u) {
      console.log(`  ${ROJO}FALTA${FIN} ${correo.padEnd(30)} no existe`);
      sinEnrolar += 1;
      continue;
    }
    if (!u.totpHabilitado || !u.totpSecreto) {
      console.log(`  ${ROJO}FALTA${FIN} ${correo.padEnd(30)} sin segundo factor enrolado`);
      sinEnrolar += 1;
      continue;
    }
    let secreto: string;
    try {
      secreto = abrirTexto(LLAVERO, u.totpSecreto, contextoTotp(u.id));
    } catch {
      console.log(
        `  ${ROJO}FALTA${FIN} ${correo.padEnd(30)} secreto cifrado: falta la CIFRADO_CLAVE con que se cifró`,
      );
      sinEnrolar += 1;
      continue;
    }
    console.log(`  ${VERDE}ok   ${FIN} ${correo.padEnd(30)} ${authenticator.generate(secreto)}`);
  }

  if (sinEnrolar > 0) {
    faltas.push('Segundo factor');
    console.log(`\n        ${GRIS}cd apps/api  ·  npm run demo:preparar${FIN}`);
    return;
  }

  const restante = 30 - Math.floor((Date.now() / 1000) % 30);
  console.log(`\n  ${GRIS}Los codigos cambian en ${restante} s.${FIN}`);
  if (restante < 10) {
    console.log(`  ${AMBAR}Quedan menos de 10 s: vuelva a correr esto antes de teclear.${FIN}`);
  }
}

async function principal(): Promise<void> {
  console.log(`\n${'='.repeat(74)}`);
  console.log('  Ayni · ¿esta todo listo para demostrar?');
  console.log('='.repeat(74));

  await servicios();
  await escenario();
  await actoEnVivo();
  await segundoFactor();

  console.log(`\n${'='.repeat(74)}`);
  if (faltas.length === 0) {
    console.log(`  ${VERDE}LISTO.${FIN} Abra ${WEB_NAVEGADOR} y siga docs/presentacion-aplicativo.md`);
  } else {
    console.log(`  ${ROJO}FALTAN ${faltas.length}:${FIN} ${faltas.join(' · ')}`);
    console.log(`  ${GRIS}Cada uno tiene su comando arriba. Vuelva a correr esto despues.${FIN}`);
    process.exitCode = 1;
  }
  console.log('='.repeat(74) + '\n');

  await prisma.$disconnect();
}

void principal();
