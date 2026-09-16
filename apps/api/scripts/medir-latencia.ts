/**
 * Medición de latencia de lectura (RNF-10: p95 por debajo de 500 ms).
 *
 *   npm run medir:latencia
 *   npm run medir:latencia -- --url=https://api.ejemplo.com/api/v1 --n=300
 *
 * Mide las rutas públicas de lectura, que son las que un donante recorre
 * antes de decidir dónde aportar y las únicas que se pueden medir sin
 * credenciales. Se reporta la mediana, el p95 y el p99 por ruta.
 *
 * Lo que este número significa y lo que no: medido contra `localhost` mide
 * la aplicación y la base, sin red. Medido contra el despliegue mide además
 * la latencia de internet, el arranque en frío del proveedor y la distancia a
 * la base de datos, que es lo que de verdad experimenta quien usa la
 * plataforma. Los dos números sirven, pero solo el segundo responde el RNF.
 */

interface Medicion {
  ruta: string;
  muestras: number[];
  errores: number;
  /** Peticiones rechazadas por el limitador de tasa, contadas aparte. */
  limitadas: number;
}

function argumento(nombre: string, porDefecto: string): string {
  const encontrado = process.argv.find((a) => a.startsWith(`--${nombre}=`));
  return encontrado ? encontrado.split('=').slice(1).join('=') : porDefecto;
}

/**
 * Percentil por interpolación lineal.
 *
 * Con pocas muestras, tomar el elemento en la posición `p * n` redondeado
 * puede saltarse varios milisegundos de una vez. Interpolar da un número
 * estable aunque se midan 100 peticiones y no 100 000.
 */
function percentil(ordenadas: number[], p: number): number {
  if (ordenadas.length === 0) return NaN;
  if (ordenadas.length === 1) return ordenadas[0];

  const posicion = (ordenadas.length - 1) * p;
  const bajo = Math.floor(posicion);
  const alto = Math.ceil(posicion);
  if (bajo === alto) return ordenadas[bajo];

  return ordenadas[bajo] + (ordenadas[alto] - ordenadas[bajo]) * (posicion - bajo);
}

async function medirRuta(base: string, ruta: string, n: number, calentamiento: number) {
  const medicion: Medicion = { ruta, muestras: [], errores: 0, limitadas: 0 };

  for (let i = 0; i < n + calentamiento; i++) {
    const inicio = performance.now();
    try {
      const r = await fetch(`${base}${ruta}`);
      // Se lee el cuerpo completo: medir solo hasta las cabeceras daría un
      // número bonito que ningún cliente real observa.
      await r.arrayBuffer();
      const ms = performance.now() - inicio;

      if (r.status === 429) {
        // No es un error del servidor ni una latencia alta: es el limitador
        // haciendo su trabajo. Mezclarlo con los errores daria a entender que
        // la API falla cuando lo que pasa es que la medicion pide demasiado.
        medicion.limitadas++;
        continue;
      }
      if (!r.ok) {
        medicion.errores++;
        continue;
      }
      // El calentamiento no cuenta: la primera petición paga la conexión, el
      // pool de la base y, en la nube, el arranque en frío.
      if (i >= calentamiento) medicion.muestras.push(ms);
    } catch {
      medicion.errores++;
    }
  }

  return medicion;
}

async function principal(): Promise<void> {
  const base = argumento('url', 'http://localhost:3000/api/v1').replace(/\/$/, '');
  // 25 por ruta: cuatro rutas mas el calentamiento caben en el limite global
  // de 120 peticiones por minuto. Subirlo exige relajar el limite en el
  // entorno que se mide, o la medicion se mide a si misma chocando contra el.
  const n = Number(argumento('n', '25'));
  const calentamiento = Number(argumento('calentamiento', '5'));
  const objetivo = Number(argumento('objetivo', '500'));

  console.log(`Midiendo ${base}`);
  console.log(`${n} peticiones por ruta, ${calentamiento} de calentamiento\n`);

  // Se necesita una campaña real para medir el detalle; se toma la primera
  // que devuelva el buscador.
  let slug: string | null = null;
  try {
    const r = await fetch(`${base}/causas?porPagina=1`);
    const datos = (await r.json()) as { resultados?: { slug: string }[] };
    slug = datos.resultados?.[0]?.slug ?? null;
  } catch {
    // Sin conexión se avisa más abajo, al no haber muestras.
  }

  const rutas = [
    '/salud',
    '/causas?porPagina=12',
    '/causas?q=veterinaria&porPagina=12',
    ...(slug ? [`/causas/${slug}`] : []),
  ];

  const resultados: Medicion[] = [];
  for (const ruta of rutas) {
    resultados.push(await medirRuta(base, ruta, n, calentamiento));
  }

  const ancho = Math.max(...rutas.map((r) => r.length), 10);
  console.log(
    `${'RUTA'.padEnd(ancho)} | ${'p50'.padStart(8)} | ${'p95'.padStart(8)} | ` +
      `${'p99'.padStart(8)} | ${'max'.padStart(8)} | err | 429`,
  );
  console.log('-'.repeat(ancho + 54));

  let cumpleTodo = true;

  for (const m of resultados) {
    if (m.muestras.length === 0) {
      console.log(
        `${m.ruta.padEnd(ancho)} | sin muestras ` +
          `(${m.errores} errores, ${m.limitadas} limitadas)`,
      );
      cumpleTodo = false;
      continue;
    }

    const ordenadas = [...m.muestras].sort((a, b) => a - b);
    const p95 = percentil(ordenadas, 0.95);
    if (p95 > objetivo) cumpleTodo = false;

    const f = (v: number) => `${v.toFixed(1)} ms`.padStart(8);
    console.log(
      `${m.ruta.padEnd(ancho)} | ${f(percentil(ordenadas, 0.5))} | ${f(p95)} | ` +
        `${f(percentil(ordenadas, 0.99))} | ${f(ordenadas[ordenadas.length - 1])} | ` +
        `${String(m.errores).padStart(3)} | ${m.limitadas}`,
    );
  }

  console.log(
    `\nRNF-10 · objetivo p95 <= ${objetivo} ms en lectura: ` +
      (cumpleTodo ? 'CUMPLE' : 'NO CUMPLE'),
  );

  const limitadas = resultados.reduce((total, m) => total + m.limitadas, 0);
  if (limitadas > 0) {
    console.log('');
    console.log(
      `Aviso: ${limitadas} peticiones fueron rechazadas por el limitador de tasa.`,
    );
    console.log('La medicion choco contra un control de la propia API, no contra');
    console.log('un problema de rendimiento. Baje --n o mida una ruta a la vez.');
  }

  if (base.includes('localhost') || base.includes('127.0.0.1')) {
    console.log(
      '\nAviso: medido contra localhost. Este numero no incluye la red, el\n' +
        'arranque en frio del proveedor ni la distancia a la base de datos.\n' +
        'Para responder el RNF hay que medir contra el despliegue.',
    );
  }

  process.exit(cumpleTodo ? 0 : 1);
}

void principal();
