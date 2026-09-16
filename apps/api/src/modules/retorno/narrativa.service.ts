import { Injectable, Logger } from '@nestjs/common';
import { Eta } from 'eta';

/**
 * Datos con los que se puede redactar una narrativa.
 *
 * Todos provienen de registros ya verificados: el monto sale de
 * aplicaciones_donacion, el concepto y el proveedor del gasto aprobado, y la
 * fecha del asiento contable. No hay ningun campo de texto libre que la ONG
 * pueda inyectar, lo que hace estructuralmente imposible que una narrativa
 * afirme algo que el sistema no comprobo (RNF-21).
 */
export interface ContextoNarrativa {
  /** Nombre o alias del donante, segun sus preferencias. */
  donante: string;
  /** Monto exacto de SU aporte que financio este gasto. */
  monto: string;
  concepto: string;
  proveedor: string;
  fecha: string;
  ong: string;
  fondo: string;
  campana: string;
}

export interface PlantillaNarrativa {
  codigo: string;
  version: string;
  /** Categoria de gasto a la que aplica, o null para cualquiera. */
  categoria: string | null;
  asunto: string;
  cuerpo: string;
}

/**
 * Lenguaje que las plantillas no pueden usar.
 *
 * RF-CO-02 pide storytelling etico, sin revictimizacion ni sensacionalismo.
 * El pitch deck lo argumenta asi: apelar a la lastima puede recaudar a corto
 * plazo, pero daña la dignidad del beneficiario y la credibilidad a largo
 * plazo. Esta lista convierte ese principio en algo verificable: una
 * plantilla que use estas palabras no llega a produccion porque una prueba
 * la rechaza.
 */
const PALABRAS_PROHIBIDAS = [
  'desgarrador',
  'lamentable',
  'pobrecito',
  'pobrecita',
  'agonizante',
  'moribundo',
  'tragedia',
  'desesperado',
  'milagro',
  'salvador',
  'heroe',
  'victima',
  'sufrimiento',
  'miseria',
];

/**
 * Plantillas de narrativa de impacto (RF-CO-01, RF-CO-02).
 *
 * Viven en el codigo y no en la base de datos a proposito (ADR-0006): asi la
 * "revision de lenguaje etico antes de publicarse" que exige RNF-21 es la
 * revision de codigo, que deja rastro en git y pasa por las pruebas de este
 * archivo. Una biblioteca editable en caliente no tendria ese control.
 */
export const PLANTILLAS: PlantillaNarrativa[] = [
  {
    codigo: 'impacto.general',
    version: '1.0',
    categoria: null,
    asunto: 'Tu donación acaba de hacer esto posible',
    cuerpo:
      'Hola <%= it.donante %>:\n\n' +
      'S/ <%= it.monto %> de tu aporte a <%= it.fondo %> financiaron ' +
      '<%= it.concepto %>, con <%= it.proveedor %>, el <%= it.fecha %>.\n\n' +
      '<%= it.ong %> presentó el comprobante de pago y la evidencia de la ' +
      'compra, y ambos fueron verificados antes de liberar tu dinero.\n\n' +
      'Puedes ver el comprobante y la foto en tu historial.',
  },
  {
    codigo: 'impacto.alimentos',
    version: '1.0',
    categoria: 'ALIMENTOS',
    asunto: 'Tu aporte se convirtió en alimento',
    cuerpo:
      'Hola <%= it.donante %>:\n\n' +
      'S/ <%= it.monto %> de tu donación a <%= it.fondo %> se usaron en ' +
      '<%= it.concepto %>, comprado a <%= it.proveedor %> el <%= it.fecha %>.\n\n' +
      '<%= it.ong %> respaldó el gasto con su comprobante y una foto de la ' +
      'entrega. Nada se libera sin esa evidencia.\n\n' +
      'Gracias por sostener la campaña <%= it.campana %>.',
  },
  {
    codigo: 'impacto.veterinaria',
    version: '1.0',
    categoria: 'ATENCION_VETERINARIA',
    asunto: 'Tu aporte financió atención veterinaria',
    cuerpo:
      'Hola <%= it.donante %>:\n\n' +
      'S/ <%= it.monto %> de tu donación cubrieron <%= it.concepto %>, ' +
      'atendido por <%= it.proveedor %> el <%= it.fecha %>.\n\n' +
      '<%= it.ong %> adjuntó el comprobante y la evidencia de la atención, ' +
      'verificados antes de ejecutar el gasto.\n\n' +
      'Puedes revisarlos en tu historial de donaciones.',
  },
];

@Injectable()
export class NarrativaService {
  private readonly logger = new Logger(NarrativaService.name);
  private readonly eta = new Eta({ autoEscape: false, useWith: false });

  /** Elige la plantilla mas especifica disponible para la categoria. */
  elegirPlantilla(categoria: string): PlantillaNarrativa {
    return (
      PLANTILLAS.find((p) => p.categoria === categoria) ??
      PLANTILLAS.find((p) => p.categoria === null)!
    );
  }

  /**
   * Redacta la narrativa.
   *
   * Si una plantilla referencia un campo que no existe en el contexto, la
   * redaccion falla en lugar de escribir "undefined" en el mensaje que lee
   * el donante. Preferimos no enviar nada a enviar algo roto: la narrativa
   * es precisamente lo que sostiene la confianza que el proyecto construye.
   */
  redactar(
    plantilla: PlantillaNarrativa,
    contexto: ContextoNarrativa,
  ): { asunto: string; cuerpo: string } {
    const centinela = this.contextoEstricto(contexto);

    return {
      asunto: plantilla.asunto,
      cuerpo: this.eta.renderString(plantilla.cuerpo, centinela).trim(),
    };
  }

  /**
   * Envuelve el contexto para detectar referencias a datos inexistentes.
   *
   * Es la defensa estructural de RNF-21: una plantilla no puede afirmar algo
   * que no venga de un dato verificado, porque cualquier otro campo lanza.
   */
  private contextoEstricto(contexto: ContextoNarrativa): ContextoNarrativa {
    return new Proxy(contexto, {
      get(destino, propiedad: string) {
        if (!(propiedad in destino)) {
          throw new Error(
            `La plantilla referencia "${propiedad}", que no es un dato verificado del gasto.`,
          );
        }
        return destino[propiedad as keyof ContextoNarrativa];
      },
    });
  }

  /**
   * Revisa el lenguaje de una plantilla (RF-CO-02).
   *
   * Se ejecuta en las pruebas sobre toda la biblioteca, de modo que una
   * plantilla con lenguaje sensacionalista no llega a produccion.
   *
   * Dos rasgos del español que una comparacion literal pasa por alto, y que
   * dejarian pasar justo el lenguaje que se quiere evitar:
   *
   * - **Acentos.** "heroe" y "héroe" son la misma palabra para quien lee y
   *   dos cadenas distintas para una comparacion literal. Se normalizan
   *   ambos lados antes de comparar.
   *
   * - **Flexion de genero y numero.** Buscar "desgarrador" no encuentra
   *   "desgarradora", que es precisamente la forma que aparece en "historia
   *   desgarradora". Se admite el sufijo flexivo.
   */
  static revisarLenguaje(plantilla: PlantillaNarrativa): string[] {
    const texto = normalizar(`${plantilla.asunto} ${plantilla.cuerpo}`);

    return PALABRAS_PROHIBIDAS.filter((palabra) =>
      new RegExp(`\\b${normalizar(palabra)}(a|o|as|os|es|s)?\\b`).test(texto),
    );
  }

  /** Campos que una plantilla puede referenciar. */
  static camposPermitidos(): Array<keyof ContextoNarrativa> {
    return ['donante', 'monto', 'concepto', 'proveedor', 'fecha', 'ong', 'fondo', 'campana'];
  }
}

/** Minusculas y sin tildes, para que la comparacion no dependa del acento. */
export function normalizar(texto: string): string {
  return (
    texto
      .toLowerCase()
      .normalize('NFD')
      // Marcas diacriticas combinantes: es lo que NFD separa de cada letra.
      .replace(/[̀-ͯ]/g, '')
  );
}
