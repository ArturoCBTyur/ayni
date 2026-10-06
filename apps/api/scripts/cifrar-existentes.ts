/**
 * Sella con la clave vigente todo lo que todavia no lo esta (RNF-01).
 *
 *   npm run cifrado:migrar              cifra y re-cifra
 *   npm run cifrado:migrar -- --revisar solo cuenta, no escribe
 *
 * Sirve para dos momentos:
 *
 * 1. **Activar el cifrado** en una instalacion que ya tenia evidencias y
 *    secretos TOTP guardados en claro. La API los sigue leyendo mientras
 *    tanto, pero hasta correr esto siguen en claro en el disco y en la base.
 * 2. **Rotar la clave.** Se pone la nueva en CIFRADO_CLAVE, la anterior en
 *    CIFRADO_CLAVES_ANTERIORES, y esto vuelve a sellar con la nueva todo lo
 *    que estaba con la anterior. Al terminar, la anterior se puede retirar.
 *
 * Idempotente: lo que ya esta sellado con la clave vigente no se toca. Cada
 * archivo se escribe en un temporal y se renombra, asi que un corte a mitad
 * de camino no deja una evidencia a medio escribir.
 *
 * La huella SHA-256 de cada evidencia se calcula sobre el contenido y no
 * sobre el sobre, asi que la base no cambia por cifrar los archivos.
 */
import { PrismaClient } from '@prisma/client';
import { readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';

import {
  abrir,
  abrirTexto,
  contextoArchivo,
  contextoTotp,
  crearLlavero,
  idDeSobre,
  idDeTexto,
  sellar,
  sellarTexto,
} from '../src/comun/cifrado/sobre';

const soloRevisar = process.argv.includes('--revisar');

async function* recorrer(carpeta: string): AsyncGenerator<string> {
  let entradas;
  try {
    entradas = await readdir(carpeta, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entrada of entradas) {
    const ruta = join(carpeta, entrada.name);
    if (entrada.isDirectory()) yield* recorrer(ruta);
    else if (entrada.isFile() && !entrada.name.endsWith('.sellando')) yield ruta;
  }
}

async function main(): Promise<void> {
  const llavero = crearLlavero(process.env.CIFRADO_CLAVE, process.env.CIFRADO_CLAVES_ANTERIORES);
  const actual = llavero.actual;
  if (!actual) {
    console.error('\n  Defina CIFRADO_CLAVE: sin clave vigente no hay con que sellar.\n');
    process.exit(1);
  }

  // Misma resolucion que la API: relativa al directorio desde donde corre.
  const raiz = resolve(process.cwd(), process.env.STORAGE_DIR ?? '../../storage');

  console.log(`\nCifrado en reposo · clave vigente ${actual.id}${soloRevisar ? ' · solo revision' : ''}`);
  console.log(`  archivos en ${raiz}`);

  const archivos = { yaSellados: 0, enClaro: 0, conOtraClave: 0 };
  for await (const ruta of recorrer(raiz)) {
    // La clave de objeto es la ruta relativa con barras, igual que en la API.
    const objeto = relative(raiz, ruta).split(sep).join('/');
    const datos = await readFile(ruta);
    const id = idDeSobre(datos);

    if (id === actual.id) {
      archivos.yaSellados++;
      continue;
    }
    if (id === null) archivos.enClaro++;
    else archivos.conOtraClave++;
    if (soloRevisar) continue;

    const contenido = abrir(llavero, datos, contextoArchivo(objeto));
    const temporal = `${ruta}.sellando`;
    await writeFile(temporal, sellar(llavero, contenido, contextoArchivo(objeto)));
    await rename(temporal, ruta);
  }

  const prisma = new PrismaClient();
  const secretos = { yaSellados: 0, enClaro: 0, conOtraClave: 0 };
  try {
    const usuarios = await prisma.usuario.findMany({
      where: { totpSecreto: { not: null } },
      select: { id: true, totpSecreto: true },
    });

    for (const u of usuarios) {
      const guardado = u.totpSecreto as string;
      const id = idDeTexto(guardado);

      if (id === actual.id) {
        secretos.yaSellados++;
        continue;
      }
      if (id === null) secretos.enClaro++;
      else secretos.conOtraClave++;
      if (soloRevisar) continue;

      const secreto = abrirTexto(llavero, guardado, contextoTotp(u.id));
      // Solo si nadie lo cambio mientras tanto: un enrolamiento en curso gana.
      await prisma.usuario.updateMany({
        where: { id: u.id, totpSecreto: guardado },
        data: { totpSecreto: sellarTexto(llavero, secreto, contextoTotp(u.id)) },
      });
    }
  } finally {
    await prisma.$disconnect();
  }

  const verbo = soloRevisar ? 'por sellar' : 'sellados ahora';
  for (const [nombre, c] of [
    ['archivos', archivos],
    ['secretos TOTP', secretos],
  ] as const) {
    console.log(
      `  ${nombre}: ${c.enClaro + c.conOtraClave} ${verbo} ` +
        `(${c.enClaro} en claro, ${c.conOtraClave} con clave retirada) · ${c.yaSellados} ya estaban`,
    );
  }
  console.log();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
