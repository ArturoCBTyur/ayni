/**
 * Validacion de RUC peruano por digito verificador modulo 11.
 *
 * Sin IA y sin red: es el mismo algoritmo determinista que usa la SUNAT.
 * En el MVP sustituye parcialmente a RF-DE-03 (consulta de validez del CPE),
 * porque permite descartar de inmediato un RUC inventado sin depender de
 * credenciales SOL que todavia no tenemos.
 *
 * Lo que este algoritmo NO dice: si el RUC existe, si esta activo, o si el
 * comprobante fue realmente emitido. Eso solo lo responde la SUNAT. Por eso
 * el motor lo trata como una señal, no como una prueba.
 */

/** Primeros dos digitos: tipo de contribuyente que la SUNAT reconoce. */
const TIPOS_CONTRIBUYENTE: Record<string, string> = {
  '10': 'Persona natural con negocio',
  '15': 'Sucesion indivisa',
  '16': 'Sociedad conyugal',
  '17': 'Persona natural sin RUC anterior',
  '20': 'Persona juridica',
};

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;

export interface ResultadoRuc {
  valido: boolean;
  /** Motivo del rechazo, en lenguaje comprensible. */
  motivo?: string;
  tipoContribuyente?: string;
}

/**
 * Calcula el digito verificador de los primeros 10 digitos de un RUC.
 * Expuesto aparte para poder generar RUC validos en las pruebas y en el seed.
 */
export function calcularDigitoVerificadorRuc(primeros10: string): number {
  if (!/^\d{10}$/.test(primeros10)) {
    throw new Error('Se esperaban exactamente 10 digitos');
  }

  const suma = PESOS.reduce((acc, peso, i) => acc + Number(primeros10[i]) * peso, 0);
  const resto = suma % 11;
  const digito = 11 - resto;

  if (digito === 10) return 0;
  if (digito === 11) return 1;
  return digito;
}

export function validarRuc(ruc: string | null | undefined): ResultadoRuc {
  if (!ruc) {
    return { valido: false, motivo: 'No se indico el RUC del emisor.' };
  }

  const limpio = ruc.trim();

  if (!/^\d{11}$/.test(limpio)) {
    return {
      valido: false,
      motivo: 'El RUC debe tener exactamente 11 digitos, sin espacios ni guiones.',
    };
  }

  const tipo = TIPOS_CONTRIBUYENTE[limpio.slice(0, 2)];
  if (!tipo) {
    return {
      valido: false,
      motivo:
        `Los dos primeros digitos (${limpio.slice(0, 2)}) no corresponden a un tipo de ` +
        'contribuyente valido. Los RUC empiezan en 10, 15, 16, 17 o 20.',
    };
  }

  const esperado = calcularDigitoVerificadorRuc(limpio.slice(0, 10));
  if (esperado !== Number(limpio[10])) {
    return {
      valido: false,
      motivo:
        'El digito verificador del RUC no coincide. Revise que este bien copiado del comprobante.',
      tipoContribuyente: tipo,
    };
  }

  return { valido: true, tipoContribuyente: tipo };
}

/**
 * Formato de serie y numero segun el tipo de comprobante.
 *
 * Los comprobantes electronicos usan serie alfanumerica de 4 caracteres que
 * empieza con una letra: F para factura, B para boleta. Los fisicos usan
 * serie numerica. Se aceptan ambos porque las ONG pequeñas del piloto
 * todavia reciben comprobantes impresos.
 */
export interface ResultadoSerie {
  valido: boolean;
  motivo?: string;
  electronico: boolean;
}

export function validarSerieNumero(
  tipo: string,
  serie: string,
  numero: string,
): ResultadoSerie {
  const s = serie.trim().toUpperCase();
  const n = numero.trim();

  if (!/^\d{1,20}$/.test(n)) {
    return {
      valido: false,
      motivo: 'El numero del comprobante debe ser solo digitos.',
      electronico: false,
    };
  }

  const inicialEsperada = tipo === 'FACTURA' ? 'F' : tipo === 'BOLETA' ? 'B' : null;

  // Serie electronica: letra inicial + 3 alfanumericos.
  if (/^[A-Z][A-Z0-9]{3}$/.test(s)) {
    if (inicialEsperada && !s.startsWith(inicialEsperada)) {
      return {
        valido: false,
        motivo:
          `La serie de una ${tipo.toLowerCase()} electronica empieza con ` +
          `"${inicialEsperada}", pero se recibio "${s}".`,
        electronico: true,
      };
    }
    return { valido: true, electronico: true };
  }

  // Serie fisica: 3 o 4 digitos.
  if (/^\d{3,4}$/.test(s)) {
    return { valido: true, electronico: false };
  }

  return {
    valido: false,
    motivo:
      'La serie no tiene un formato reconocible. Se esperaba una letra seguida de 3 ' +
      'caracteres (electronico) o de 3 a 4 digitos (fisico).',
    electronico: false,
  };
}
