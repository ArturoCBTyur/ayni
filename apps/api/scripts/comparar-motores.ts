/**
 * Compara el motor de reglas contra AIni sobre los mismos gastos.
 *
 *   npm run demo:comparar
 *   npm run demo:comparar -- --url=http://127.0.0.1:8000
 *
 * Es la forma mas directa de ver que aporta la IA: los dos motores reciben
 * exactamente la misma entrada y se muestran sus veredictos uno al lado del
 * otro. Donde coinciden, la IA no estaba haciendo falta. Donde difieren, se ve
 * exactamente que vio uno y el otro no.
 *
 * Los casos no son aleatorios: cada uno aisla una capacidad distinta, y el
 * tercero es el que justifica todo el modulo.
 */

import { ConfigService } from '@nestjs/config';

import type { Configuracion } from '../src/config/configuracion';
import type {
  EntradaAnalisis,
  ResultadoAnalisis,
} from '../src/modules/verificacion/contrato/analisis.contrato';
import { FakeSunatService } from '../src/modules/verificacion/cpe/fake-sunat.service';
import { MotorAIni } from '../src/modules/verificacion/motores/aini.motor';
import { MotorReglasV0 } from '../src/modules/verificacion/motores/reglas-v0.motor';

function argumento(nombre: string, porDefecto: string): string {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.split('=').slice(1).join('=') : porDefecto;
}

const hace = (dias: number) => {
  const d = new Date();
  d.setDate(d.getDate() - dias);
  return d.toISOString().slice(0, 10);
};

/** Gasto base: coherente, bien documentado, sin nada raro. */
function base(): EntradaAnalisis {
  return {
    gastoId: 'comparacion',
    declarado: {
      fondoId: 'fondo-veterinaria',
      categoriaGasto: 'ATENCION_VETERINARIA',
      montoDeclarado: 118,
      concepto: 'atencion veterinaria de urgencia de tres perros rescatados',
      proveedorNombre: 'Clinica Veterinaria San Roque',
      proveedorRuc: null,
      fechaGasto: hace(2),
      capturadoEn: hace(2),
    },
    comprobante: {
      tipo: 'BOLETA',
      rucEmisor: '20601030579',
      serie: 'B001',
      numero: '004521',
      fechaEmision: hace(2),
      subtotal: 100,
      igv: 18,
      total: 118,
      moneda: 'PEN',
      hashSha256: 'a'.repeat(64),
      archivoUrl: '/comprobantes/demo.jpg',
    },
    evidencias: [
      {
        id: 'ev-1',
        tipo: 'FOTO',
        hashSha256: 'b'.repeat(64),
        hashPerceptual: 'f0f0f0f0f0f0f0f0',
        nitidez: 180,
        ancho: 800,
        alto: 600,
        exifCapturadoEn: hace(2),
        distanciaMinimaHistorico: 24,
        contienePersonas: false,
        anonimizada: true,
        archivoUrl: '/evidencias/demo.jpg',
      },
    ],
    contexto: {
      saldoRetenido: 500,
      mediaHistoricaCategoria: 130,
      desviacionHistoricaCategoria: 40,
      proveedorConocido: true,
      gastosRecientesMismaCategoria: 1,
    },
    regla: {
      id: 'regla-vigente',
      umbralAlto: 90,
      umbralMedio: 60,
      pesoDocumental: 0.45,
      pesoVisual: 0.25,
      pesoAnomalia: 0.3,
    },
  };
}

/** Aplica cambios sobre el gasto base sin mutarlo. */
function variante(cambios: {
  declarado?: Partial<EntradaAnalisis['declarado']>;
  comprobante?: Partial<EntradaAnalisis['comprobante']>;
  contexto?: Partial<EntradaAnalisis['contexto']>;
  evidencia?: Partial<EntradaAnalisis['evidencias'][number]>;
}): EntradaAnalisis {
  const e = base();
  return {
    ...e,
    declarado: { ...e.declarado, ...cambios.declarado },
    comprobante: { ...e.comprobante, ...cambios.comprobante },
    contexto: { ...e.contexto, ...cambios.contexto },
    evidencias: cambios.evidencia
      ? [{ ...e.evidencias[0], ...cambios.evidencia }]
      : e.evidencias,
  };
}

interface Caso {
  titulo: string;
  porQue: string;
  entrada: EntradaAnalisis;
}

const CASOS: Caso[] = [
  {
    titulo: 'Gasto normal y bien documentado',
    porQue: 'La linea base. Si los dos motores no coinciden aqui, algo anda mal.',
    entrada: base(),
  },
  {
    titulo: 'RUC con el digito verificador equivocado',
    porQue: 'Aritmetica pura. Los dos deberian verlo: la IA no aporta nada nuevo.',
    entrada: variante({ comprobante: { rucEmisor: '20553456575' } }),
  },
  {
    titulo: 'Alquiler de oficina cargado al fondo veterinario',
    porQue:
      'RUC valido, IGV exacto, fechas correctas. Lo unico mal es que el gasto no ' +
      'corresponde a la categoria del fondo. NINGUNA regla aritmetica puede verlo.',
    entrada: variante({
      declarado: {
        concepto: 'alquiler de oficina administrativa y mobiliario de escritorio',
        proveedorNombre: 'Inmobiliaria Centro SAC',
      },
    }),
  },
  {
    titulo: 'Perfil anomalo: monto alto + proveedor nuevo + frecuencia + consume el saldo',
    porQue:
      'Ninguna de las cuatro señales por separado basta para desconfiar. Las cuatro ' +
      'juntas si, y eso es lo que una regla por señal no puede expresar.',
    entrada: variante({
      declarado: { montoDeclarado: 480 },
      comprobante: { fechaEmision: hace(60), subtotal: 406.78, igv: 73.22, total: 480 },
      contexto: {
        saldoRetenido: 490,
        proveedorConocido: false,
        gastosRecientesMismaCategoria: 5,
      },
    }),
  },
  {
    titulo: 'Evidencia reutilizada de otro gasto',
    porQue: 'Bloqueo duro. Lo detecta el hash perceptual, que calcula el backend para ambos.',
    entrada: variante({ evidencia: { distanciaMinimaHistorico: 1 } }),
  },
];

function pintar(nivel: string): string {
  // Sin dependencias de color: el nivel se lee igual en cualquier terminal.
  return nivel.padEnd(5);
}

function motivosQueFallan(r: ResultadoAnalisis): string[] {
  return r.explicacion.motivos
    .filter((m) => m.resultado !== 'ok')
    .map((m) => `${m.regla}${m.valor !== undefined && m.valor !== null ? ` = ${String(m.valor)}` : ''}`);
}

async function principal(): Promise<void> {
  const url = argumento('url', 'http://127.0.0.1:8000');

  const reglas = new MotorReglasV0(new FakeSunatService());
  const config = {
    get: (clave: string) =>
      ({ AINI_URL: url, AINI_TOKEN: undefined, AINI_TIMEOUT_MS: 20_000 })[clave],
  } as unknown as ConfigService<Configuracion, true>;
  const aini = new MotorAIni(config, reglas);

  console.log(`\nComparando motores sobre ${CASOS.length} gastos identicos`);
  console.log(`AIni en ${url}\n`);

  let coinciden = 0;
  const divergencias: string[] = [];

  for (const [i, caso] of CASOS.entries()) {
    const porReglas = await reglas.analizar(caso.entrada);
    const porAIni = await aini.analizar(caso.entrada);

    const usoRespaldo = porAIni.versionModelo.includes('reglas-v0');
    const igual = porReglas.nivel === porAIni.nivel;
    if (igual) coinciden++;
    else divergencias.push(caso.titulo);

    console.log(`${'─'.repeat(78)}`);
    console.log(`${i + 1}. ${caso.titulo}`);
    console.log(`   ${caso.porQue}`);
    console.log('');
    console.log(
      `   reglas-v0  ${pintar(porReglas.nivel)} ${String(porReglas.scoreFinal).padStart(6)}  ` +
        `(doc ${porReglas.scoreDocumental} · vis ${porReglas.scoreVisual} · ano ${porReglas.scoreAnomalia})`,
    );
    console.log(
      `   AIni       ${pintar(porAIni.nivel)} ${String(porAIni.scoreFinal).padStart(6)}  ` +
        `(doc ${porAIni.scoreDocumental} · vis ${porAIni.scoreVisual} · ano ${porAIni.scoreAnomalia})` +
        (usoRespaldo ? '   <- servicio caido, respondio el respaldo' : ''),
    );

    if (!igual) {
      console.log('');
      console.log(`   >> DIFIEREN: reglas dice ${porReglas.nivel} y AIni dice ${porAIni.nivel}`);
      const soloAIni = motivosQueFallan(porAIni).filter(
        (m) => !motivosQueFallan(porReglas).some((r) => r.split(' ')[0] === m.split(' ')[0]),
      );
      for (const m of soloAIni) console.log(`      solo AIni: ${m}`);
    }

    console.log('');
    console.log(`   AIni resume: ${porAIni.explicacion.resumen}`);
    console.log('');
  }

  console.log('═'.repeat(78));
  console.log(`Coinciden en ${coinciden} de ${CASOS.length}.`);

  if (divergencias.length) {
    console.log('\nDonde la IA ve algo que las reglas no:');
    for (const d of divergencias) console.log(`  · ${d}`);
  } else {
    console.log(
      '\nNo hubo divergencias. Si AIni no estaba corriendo, todos los casos los\n' +
        'resolvio el respaldo y la comparacion es contra si misma: levante el\n' +
        'servicio con `python -m uvicorn aini.main:app --port 8000`.',
    );
  }
  console.log('');
}

void principal();
