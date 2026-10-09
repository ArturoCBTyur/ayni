/**
 * Avisos al donante cuando cierra una causa que apoyo (RF-CO-03, T3.4).
 *
 * Pasan por lo mismo que las narrativas de impacto: viven en el codigo, el
 * contexto es estricto (una plantilla que nombra un dato que no existe falla
 * en lugar de escribir "undefined") y las pruebas les aplican el filtro de
 * lenguaje etico. Todos los datos salen de registros verificados: el monto
 * es el remanente calculado por el FIFO, no una cifra que escriba la ONG.
 */

export interface ContextoCierre {
  donante: string;
  /** Su remanente, con dos decimales. */
  monto: string;
  fondo: string;
  ong: string;
  /** Hasta cuando puede elegir, o cuando se resolvio. */
  fecha: string;
  /** Fondo al que se traslado; vacio si no corresponde. */
  destino: string;
}

export interface PlantillaCierre {
  codigo: 'cierre.eleccion' | 'cierre.devolucion' | 'cierre.traslado';
  version: string;
  asunto: string;
  cuerpo: string;
}

export const PLANTILLAS_CIERRE: PlantillaCierre[] = [
  {
    codigo: 'cierre.eleccion',
    version: '1.0',
    asunto: 'Una causa que apoyaste cerró: decide qué hacer con tu saldo',
    cuerpo:
      'Hola <%= it.donante %>:\n\n' +
      '<%= it.fondo %>, de <%= it.ong %>, cerró y quedaron S/ <%= it.monto %> de tu aporte ' +
      'sin usar. Puedes pedir que te los devolvamos o pasarlos a otra causa.\n\n' +
      'Si no eliges hasta el <%= it.fecha %>, te los devolveremos. Lo eliges en Inicio.',
  },
  {
    codigo: 'cierre.devolucion',
    version: '1.0',
    asunto: 'Te devolvimos el saldo de tu aporte',
    cuerpo:
      'Hola <%= it.donante %>:\n\n' +
      'El <%= it.fecha %> registramos la devolución de S/ <%= it.monto %> que quedaron sin ' +
      'usar en <%= it.fondo %>, de <%= it.ong %>.\n\n' +
      'El informe de cierre de la causa, con cada gasto y cómo se verificó, está en tu ' +
      'historial.',
  },
  {
    codigo: 'cierre.traslado',
    version: '1.0',
    asunto: 'Tu saldo ahora apoya otra causa',
    cuerpo:
      'Hola <%= it.donante %>:\n\n' +
      'Como elegiste, los S/ <%= it.monto %> que quedaron sin usar en <%= it.fondo %> pasaron ' +
      'el <%= it.fecha %> a <%= it.destino %>. Quedan retenidos ahí hasta que se demuestre ' +
      'en qué se gastan, igual que tu aporte original.\n\n' +
      'El informe de cierre de la primera causa está en tu historial.',
  },
];
