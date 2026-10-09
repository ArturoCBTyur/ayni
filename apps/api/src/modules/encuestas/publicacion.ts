import type { PrismaClient } from '@prisma/client';

import { jsonCanonico, sha256 } from '../../comun/canonico';
import { INSTRUMENTOS, type Instrumento } from './instrumentos';

/**
 * Publica la version de cada instrumento que todavia no este en la base, y la
 * deja como la activa de su codigo. La usan el seed y EncuestasService.
 *
 * Si la version ya existe con otro contenido, falla: cambiar un item
 * publicado es publicar otra version, y la base no lo dejaria de todos modos.
 * Mejor decirlo con un mensaje que con el error del trigger.
 */
export async function publicarInstrumentos(
  prisma: PrismaClient,
  instrumentos: Instrumento[] = INSTRUMENTOS,
): Promise<string[]> {
  const publicados: string[] = [];

  for (const instrumento of instrumentos) {
    const contenido = jsonCanonico(instrumento);
    const hash = sha256(contenido);
    const existente = await prisma.instrumentoEncuesta.findUnique({
      where: { codigo_version: { codigo: instrumento.codigo, version: instrumento.version } },
    });

    if (existente) {
      if (existente.hashContenido !== hash) {
        throw new Error(
          `${instrumento.codigo} v${instrumento.version} ya esta publicado con otro contenido: ` +
            'publique una version nueva en lugar de cambiar esta.',
        );
      }
      continue;
    }

    await prisma.$transaction(async (tx) => {
      await tx.instrumentoEncuesta.updateMany({
        where: { codigo: instrumento.codigo, activo: true },
        data: { activo: false },
      });
      await tx.instrumentoEncuesta.create({
        data: {
          codigo: instrumento.codigo,
          version: instrumento.version,
          indicador: instrumento.indicador,
          contenido,
          hashContenido: hash,
        },
      });
    });
    publicados.push(`${instrumento.codigo} v${instrumento.version}`);
  }

  return publicados;
}
