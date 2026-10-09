/**
 * Documento PDF minimo, sin dependencias: texto en paginas A4.
 *
 * Usa las fuentes estandar del PDF (Helvetica y Helvetica-Bold), que todo
 * lector trae incorporadas: no hay que embeber ninguna. La codificacion es
 * WinAnsi, que cubre el español completo (tildes, eñe, ¿ ¡ « »); lo que cae
 * fuera de ella se escribe como "?" en lugar de romper el archivo.
 *
 * Basta para un estado financiero, que es texto y tablas. Si un documento
 * necesitara imagenes o graficos, conviene reevaluar una biblioteca (D5,
 * ADR-0007).
 *
 * El documento no lleva fecha de creacion: el mismo contenido da los mismos
 * bytes, de modo que dos descargas del mismo cierre se pueden comparar.
 */

const ANCHO_PAGINA = 595;
const ALTO_PAGINA = 842;
export const MARGEN = 50;

/** Ancho de cada caracter en milesimas del tamaño de la fuente (AFM de Helvetica). */
const ANCHOS_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const ANCHOS_OTROS: Record<string, number> = {
  á: 556,
  é: 556,
  í: 278,
  ó: 556,
  ú: 556,
  ü: 556,
  ñ: 556,
  Á: 667,
  É: 667,
  Í: 278,
  Ó: 778,
  Ú: 722,
  Ü: 722,
  Ñ: 722,
  '¿': 611,
  '¡': 333,
  '«': 556,
  '»': 556,
  '·': 278,
  '°': 400,
  º: 365,
  ª: 370,
  '—': 1000,
  '–': 556,
  '…': 1000,
  '“': 333,
  '”': 333,
  '‘': 222,
  '’': 222,
  '•': 350,
};

/** Unicode a WinAnsi para lo que no coincide con Latin-1. */
const WIN_ANSI: Record<string, number> = {
  '€': 0x80,
  '…': 0x85,
  '‘': 0x91,
  '’': 0x92,
  '“': 0x93,
  '”': 0x94,
  '•': 0x95,
  '–': 0x96,
  '—': 0x97,
};

export function anchoTexto(texto: string, tamano: number): number {
  let total = 0;
  for (const c of texto) {
    const codigo = c.charCodeAt(0);
    const ancho =
      codigo >= 32 && codigo <= 126 ? ANCHOS_ASCII[codigo - 32] : (ANCHOS_OTROS[c] ?? 556);
    total += ancho;
  }
  return (total * tamano) / 1000;
}

/** Texto como cadena literal del PDF, ya en WinAnsi. */
function literal(texto: string): string {
  let salida = '';
  for (const c of texto) {
    const codigo = c.charCodeAt(0);
    if (c === '(' || c === ')' || c === '\\') {
      salida += `\\${c}`;
    } else if (codigo >= 32 && codigo <= 126) {
      salida += c;
    } else {
      const byte = WIN_ANSI[c] ?? (codigo >= 0xa0 && codigo <= 0xff ? codigo : 0x3f);
      salida += `\\${byte.toString(8).padStart(3, '0')}`;
    }
  }
  return `(${salida})`;
}

export interface OpcionesTexto {
  tamano?: number;
  negrita?: boolean;
  /** Desde el margen izquierdo, en puntos. */
  x?: number;
  alineacion?: 'izquierda' | 'derecha';
  gris?: boolean;
}

/**
 * Documento que se escribe de arriba hacia abajo, como una impresora.
 * Cuando una linea no cabe, empieza una pagina nueva.
 */
export class DocumentoPdf {
  private readonly paginas: string[][] = [[]];
  /** Imagenes JPEG del documento, y en que pagina se usa cada una. */
  private readonly imagenes: Array<{ jpeg: Buffer; ancho: number; alto: number; pagina: number }> =
    [];
  private y = ALTO_PAGINA - MARGEN;

  constructor(private readonly titulo: string) {}

  /** Ancho util entre los dos margenes. */
  static readonly ANCHO_UTIL = ANCHO_PAGINA - 2 * MARGEN;

  /** Una linea de texto; partirla es responsabilidad de quien llama (ver partir). */
  linea(texto: string, opciones: OpcionesTexto = {}): this {
    const tamano = opciones.tamano ?? 10;
    this.reservar(tamano * 1.45);
    this.escribir(texto, this.y, opciones);
    return this;
  }

  /** Varias celdas en la misma linea, cada una en su posicion. */
  fila(celdas: Array<{ texto: string } & OpcionesTexto>, tamano = 10): this {
    this.reservar(tamano * 1.45);
    for (const c of celdas) this.escribir(c.texto, this.y, { tamano, ...c });
    return this;
  }

  /** Parrafo que se parte en lineas segun el ancho disponible. */
  parrafo(texto: string, opciones: OpcionesTexto = {}): this {
    const tamano = opciones.tamano ?? 10;
    const ancho = DocumentoPdf.ANCHO_UTIL - (opciones.x ?? 0);
    for (const l of partir(texto, ancho, tamano)) this.linea(l, opciones);
    return this;
  }

  espacio(puntos = 8): this {
    this.y -= puntos;
    return this;
  }

  /** Raya horizontal de margen a margen. */
  raya(): this {
    this.reservar(6);
    this.actual().push(
      `0.6 G 0.5 w ${MARGEN} ${this.y + 3} m ${ANCHO_PAGINA - MARGEN} ${this.y + 3} l S 0 G`,
    );
    return this;
  }

  /**
   * Una imagen JPEG, tal cual: el PDF la decodifica (DCTDecode), asi que no
   * hace falta descomprimirla aqui. `pixeles` son sus dimensiones reales;
   * `ancho` es el ancho en puntos con que se dibuja.
   */
  imagen(jpeg: Buffer, pixeles: { ancho: number; alto: number }, ancho: number, x = 0): this {
    if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
      throw new Error('Solo se incrustan imagenes JPEG.');
    }
    const alto = (ancho * pixeles.alto) / pixeles.ancho;
    this.reservar(alto + 6);
    this.imagenes.push({ jpeg, ...pixeles, pagina: this.paginas.length - 1 });
    const nombre = `Im${this.imagenes.length}`;
    this.actual().push(
      `q ${ancho.toFixed(2)} 0 0 ${alto.toFixed(2)} ${(MARGEN + x).toFixed(2)} ` +
        `${(this.y + 3).toFixed(2)} cm /${nombre} Do Q`,
    );
    return this;
  }

  /**
   * Un codigo QR, dibujado con cuadros: vectorial, nitido a cualquier zoom y
   * sin depender de una imagen. `modulos[fila][columna]` es true si es oscuro.
   */
  qr(modulos: boolean[][], lado: number, x = 0): this {
    const n = modulos.length;
    const modulo = lado / n;
    this.reservar(lado + 6);
    const base = this.y + 3;
    const cuadros: string[] = [];
    modulos.forEach((fila, f) =>
      fila.forEach((oscuro, c) => {
        if (!oscuro) return;
        const cx = MARGEN + x + c * modulo;
        const cy = base + (n - 1 - f) * modulo;
        cuadros.push(
          `${cx.toFixed(2)} ${cy.toFixed(2)} ${modulo.toFixed(2)} ${modulo.toFixed(2)} re`,
        );
      }),
    );
    this.actual().push(`0 g ${cuadros.join(' ')} f`);
    return this;
  }

  generar(): Buffer {
    const total = this.paginas.length;
    const pie = (i: number) =>
      `BT /F1 8 Tf 0.45 g ${MARGEN} 30 Td ${literal(`${this.titulo} · página ${i + 1} de ${total}`)} Tj 0 g ET`;

    // 1 catalogo, 2 paginas, 3 y 4 fuentes, 5 info; despues pagina y
    // contenido, y al final las imagenes.
    const objetos: string[] = [];
    const objetoImagen = (k: number) => 6 + total * 2 + k;
    const kids = this.paginas.map((_, i) => `${6 + i * 2} 0 R`).join(' ');

    objetos.push('<< /Type /Catalog /Pages 2 0 R >>');
    objetos.push(`<< /Type /Pages /Kids [${kids}] /Count ${total} >>`);
    objetos.push(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    );
    objetos.push(
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
    );
    objetos.push(`<< /Title ${literal(this.titulo)} /Producer (Ayni) >>`);

    this.paginas.forEach((operaciones, i) => {
      const contenido = [...operaciones, pie(i)].join('\n');
      const deEstaPagina = this.imagenes
        .map((img, k) => ({ img, k }))
        .filter(({ img }) => img.pagina === i)
        .map(({ k }) => `/Im${k + 1} ${objetoImagen(k)} 0 R`);
      const xobjetos = deEstaPagina.length ? ` /XObject << ${deEstaPagina.join(' ')} >>` : '';
      objetos.push(
        `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${ANCHO_PAGINA} ${ALTO_PAGINA}] ` +
          `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${xobjetos} >> ` +
          `/Contents ${7 + i * 2} 0 R >>`,
      );
      const bytes = Buffer.from(contenido, 'latin1');
      objetos.push(`<< /Length ${bytes.length} >>\nstream\n${contenido}\nendstream`);
    });

    // Los bytes del JPEG pasan como latin1: un caracter por byte, sin perder
    // ninguno, igual que el resto del documento.
    for (const img of this.imagenes) {
      objetos.push(
        `<< /Type /XObject /Subtype /Image /Width ${img.ancho} /Height ${img.alto} ` +
          '/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode ' +
          `/Length ${img.jpeg.length} >>\nstream\n${img.jpeg.toString('latin1')}\nendstream`,
      );
    }

    // Todo lo que se escribe es ASCII o ya viene escapado a WinAnsi, asi que
    // latin1 conserva un byte por caracter y los desplazamientos son exactos.
    let cuerpo = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const desplazamientos: number[] = [];
    objetos.forEach((o, i) => {
      desplazamientos.push(Buffer.byteLength(cuerpo, 'latin1'));
      cuerpo += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });

    const inicioXref = Buffer.byteLength(cuerpo, 'latin1');
    cuerpo += `xref\n0 ${objetos.length + 1}\n0000000000 65535 f \n`;
    for (const d of desplazamientos) cuerpo += `${String(d).padStart(10, '0')} 00000 n \n`;
    cuerpo +=
      `trailer\n<< /Size ${objetos.length + 1} /Root 1 0 R /Info 5 0 R >>\n` +
      `startxref\n${inicioXref}\n%%EOF\n`;

    return Buffer.from(cuerpo, 'latin1');
  }

  private actual(): string[] {
    return this.paginas[this.paginas.length - 1];
  }

  /** Baja el cursor y, si no queda lugar sobre el pie, pasa de pagina. */
  private reservar(alto: number): void {
    if (this.y - alto < MARGEN) {
      this.paginas.push([]);
      this.y = ALTO_PAGINA - MARGEN;
    }
    this.y -= alto;
  }

  private escribir(texto: string, y: number, opciones: OpcionesTexto): void {
    const tamano = opciones.tamano ?? 10;
    const base = MARGEN + (opciones.x ?? 0);
    const x = opciones.alineacion === 'derecha' ? base - anchoTexto(texto, tamano) : base;
    const fuente = opciones.negrita ? 'F2' : 'F1';
    const color = opciones.gris ? '0.4 g ' : '';
    this.actual().push(
      `BT /${fuente} ${tamano} Tf ${color}${x.toFixed(2)} ${y.toFixed(2)} Td ${literal(texto)} Tj ${opciones.gris ? '0 g ' : ''}ET`,
    );
  }
}

/** Parte un texto en lineas que caben en un ancho, sin cortar palabras si se puede. */
export function partir(texto: string, ancho: number, tamano: number): string[] {
  const lineas: string[] = [];
  let actual = '';

  for (const palabra of texto.split(/\s+/).filter(Boolean)) {
    const candidata = actual ? `${actual} ${palabra}` : palabra;
    if (anchoTexto(candidata, tamano) <= ancho || !actual) {
      actual = candidata;
    } else {
      lineas.push(actual);
      actual = palabra;
    }
  }
  if (actual) lineas.push(actual);
  return lineas.length ? lineas : [''];
}
