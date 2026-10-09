/**
 * Excel y PDF sin dependencias (D5, ADR-0007).
 *
 * No hay lector de PDF ni de Excel en CI, asi que estas pruebas comprueban la
 * estructura que esos lectores necesitan: que cada desplazamiento del xref
 * caiga en su objeto, que cada CRC del ZIP corresponda a sus bytes. Un error
 * de un byte en cualquiera de las dos cosas y el archivo no abre.
 */
import { crc32 } from 'node:zlib';

import { DocumentoPdf, anchoTexto, partir } from './pdf';
import { libroXlsx, zipAlmacenado } from './xlsx';

/** Entradas del directorio central de un ZIP: nombre y bytes. */
function leerZip(zip: Buffer): Map<string, Buffer> {
  const fin = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  expect(fin).toBeGreaterThan(0);

  const entradas = zip.readUInt16LE(fin + 10);
  let p = zip.readUInt32LE(fin + 16);
  const archivos = new Map<string, Buffer>();

  for (let i = 0; i < entradas; i += 1) {
    expect(zip.readUInt32LE(p)).toBe(0x02014b50);
    const crc = zip.readUInt32LE(p + 16);
    const tamano = zip.readUInt32LE(p + 20);
    const largoNombre = zip.readUInt16LE(p + 28);
    const local = zip.readUInt32LE(p + 42);
    const nombre = zip.subarray(p + 46, p + 46 + largoNombre).toString('utf8');

    expect(zip.readUInt32LE(local)).toBe(0x04034b50);
    const inicio = local + 30 + zip.readUInt16LE(local + 26);
    const datos = zip.subarray(inicio, inicio + tamano);
    expect(crc32(datos)).toBe(crc);

    archivos.set(nombre, datos);
    p += 46 + largoNombre;
  }
  return archivos;
}

describe('Excel (.xlsx)', () => {
  const libro = () =>
    libroXlsx([
      {
        nombre: 'Estado de actividades',
        anchos: [40, 16],
        filas: [
          [{ negrita: 'Concepto' }, { negrita: 'Monto' }],
          ['Donaciones brutas', { soles: '350.00' }],
          ['Alimento "premium" & <20 kg>', { soles: '-14.04' }],
          [null, 3],
        ],
      },
      { nombre: 'Otra', filas: [Array.from({ length: 28 }, (_, i) => i)] },
    ]);

  it('es un ZIP valido: cada CRC corresponde a sus bytes', () => {
    const archivos = leerZip(libro());
    expect([...archivos.keys()]).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/workbook.xml',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/worksheets/sheet1.xml',
      'xl/worksheets/sheet2.xml',
    ]);
  });

  it('escribe los importes como numero, desde su texto exacto', () => {
    const hoja = leerZip(libro()).get('xl/worksheets/sheet1.xml')!.toString('utf8');
    expect(hoja).toContain('<c r="B2" s="2"><v>350.00</v></c>');
    expect(hoja).toContain('<v>-14.04</v>');
  });

  it('escapa el texto para que el XML no se rompa', () => {
    const hoja = leerZip(libro()).get('xl/worksheets/sheet1.xml')!.toString('utf8');
    expect(hoja).toContain('Alimento &quot;premium&quot; &amp; &lt;20 kg&gt;');
  });

  it('nombra las columnas despues de la Z como lo hace Excel', () => {
    const hoja = leerZip(libro()).get('xl/worksheets/sheet2.xml')!.toString('utf8');
    expect(hoja).toContain('r="Z1"');
    expect(hoja).toContain('r="AA1"');
    expect(hoja).toContain('r="AB1"');
  });

  it('el mismo contenido da los mismos bytes', () => {
    expect(libro().equals(libro())).toBe(true);
  });

  it('rechaza un nombre de hoja que Excel no acepta y un importe que no es numero', () => {
    expect(() => libroXlsx([{ nombre: 'a/b', filas: [] }])).toThrow('nombre de hoja');
    expect(() => libroXlsx([{ nombre: 'x'.repeat(32), filas: [] }])).toThrow('nombre de hoja');
    expect(() => libroXlsx([{ nombre: 'Hoja', filas: [[{ soles: '1,5' }]] }])).toThrow(
      'no es un importe',
    );
    expect(() => libroXlsx([])).toThrow('al menos una hoja');
  });

  it('el ZIP vacio de contenido sigue siendo un ZIP', () => {
    expect(leerZip(zipAlmacenado([['a.txt', '']])).get('a.txt')!.length).toBe(0);
  });
});

describe('PDF', () => {
  const documento = (lineas = 3) => {
    const pdf = new DocumentoPdf('Estado de prueba');
    pdf.linea('Atención veterinaria (cirugía) \\ niño', { tamano: 14, negrita: true });
    pdf.raya();
    pdf.fila([
      { texto: 'Donaciones brutas' },
      { texto: '1,234.50', x: DocumentoPdf.ANCHO_UTIL, alineacion: 'derecha' },
    ]);
    pdf.parrafo('palabra '.repeat(60), { gris: true });
    for (let i = 0; i < lineas; i += 1) pdf.linea(`Linea ${i}`);
    pdf.espacio();
    return pdf.generar();
  };

  it('cada desplazamiento del xref cae en su objeto', () => {
    const bytes = documento();
    const texto = bytes.toString('latin1');

    expect(texto.startsWith('%PDF-1.4\n')).toBe(true);
    expect(texto.trimEnd().endsWith('%%EOF')).toBe(true);

    const inicioXref = Number(/startxref\n(\d+)/.exec(texto)![1]);
    expect(texto.slice(inicioXref, inicioXref + 4)).toBe('xref');

    const entradas = [...texto.slice(inicioXref).matchAll(/^(\d{10}) 00000 n $/gm)];
    expect(entradas.length).toBeGreaterThan(5);
    entradas.forEach((e, i) => {
      expect(texto.slice(Number(e[1])).startsWith(`${i + 1} 0 obj`)).toBe(true);
    });
  });

  it('el largo de cada stream es el de sus bytes', () => {
    const texto = documento().toString('latin1');
    for (const m of texto.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
      const inicio = m.index + m[0].length;
      expect(texto.slice(inicio + Number(m[1]), inicio + Number(m[1]) + 10)).toBe('\nendstream');
    }
  });

  it('escribe las tildes en WinAnsi y escapa los parentesis', () => {
    const texto = documento().toString('latin1');
    expect(texto).toContain('(Atenci\\363n veterinaria \\(cirug\\355a\\) \\\\ ni\\361o)');
  });

  it('lo que no existe en WinAnsi sale como signo de pregunta', () => {
    const pdf = new DocumentoPdf('x');
    pdf.linea('≥ 75 — 5 €');
    const texto = pdf.generar().toString('latin1');
    expect(texto).toContain('(\\077 75 \\227 5 \\200)');
  });

  it('pasa de pagina cuando el texto no cabe, y numera las paginas', () => {
    const texto = documento(120).toString('latin1');
    const paginas = Number(/\/Count (\d+)/.exec(texto)![1]);

    expect(paginas).toBeGreaterThan(1);
    expect(texto).toContain(`(Estado de prueba \\267 p\\341gina ${paginas} de ${paginas})`);
  });

  it('el mismo contenido da los mismos bytes', () => {
    expect(documento().equals(documento())).toBe(true);
  });

  it('mide el texto con los anchos de Helvetica', () => {
    // Todos los digitos miden 556 milesimas: es lo que permite alinear importes.
    expect(anchoTexto('0123456789', 10)).toBeCloseTo(55.6);
    expect(anchoTexto('~', 1000)).toBe(584);
    expect(anchoTexto('ñ', 1000)).toBe(556);
  });

  it('parte un parrafo sin pasarse del ancho', () => {
    const lineas = partir('una frase bastante larga para partir en varias lineas', 80, 10);
    expect(lineas.length).toBeGreaterThan(1);
    for (const l of lineas) expect(anchoTexto(l, 10)).toBeLessThanOrEqual(80);
    expect(partir('', 80, 10)).toEqual(['']);
  });
});
