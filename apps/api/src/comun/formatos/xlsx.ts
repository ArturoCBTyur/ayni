import { crc32 } from 'node:zlib';

/**
 * Libro de Excel (.xlsx) minimo, sin dependencias.
 *
 * Un .xlsx es un ZIP con unos pocos XML. Para lo que piden los estados
 * mensuales (texto, importes, una fila de titulos en negrita) alcanzan seis
 * archivos y un ZIP sin compresion, que Excel, LibreOffice y Google Sheets
 * abren igual. Una biblioteca completa de hojas de calculo sumaria varios
 * megabytes de dependencias para escribir esto (D5, ADR-0007).
 *
 * Los importes se escriben como numero con formato de dos decimales, a partir
 * del texto exacto que entrega soles(): nunca pasan por un number de
 * JavaScript, asi que no hay redondeo binario en el camino.
 */

/** Texto, numero, importe en soles (texto decimal) o texto en negrita. */
export type Celda = string | number | null | { soles: string } | { negrita: string };

export interface Hoja {
  /** Hasta 31 caracteres, sin []:*?/\ */
  nombre: string;
  filas: Celda[][];
  /** Ancho de cada columna, en caracteres. */
  anchos?: number[];
}

const ESTILO_NEGRITA = 1;
const ESTILO_SOLES = 2;

function escaparXml(texto: string): string {
  return (
    texto
      // Caracteres de control que XML 1.0 no admite: harian el archivo ilegible.
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

/** A, B, ... Z, AA, AB ... */
function columna(indice: number): string {
  let n = indice + 1;
  let letras = '';
  while (n > 0) {
    const resto = (n - 1) % 26;
    letras = String.fromCharCode(65 + resto) + letras;
    n = Math.floor((n - 1) / 26);
  }
  return letras;
}

function celdaXml(celda: Celda, ref: string): string {
  if (celda === null || celda === '') return '';
  if (typeof celda === 'number') return `<c r="${ref}"><v>${celda}</v></c>`;
  if (typeof celda === 'string') {
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escaparXml(celda)}</t></is></c>`;
  }
  if ('soles' in celda) {
    if (!/^-?\d+(\.\d+)?$/.test(celda.soles)) {
      throw new Error(`"${celda.soles}" no es un importe.`);
    }
    return `<c r="${ref}" s="${ESTILO_SOLES}"><v>${celda.soles}</v></c>`;
  }
  return (
    `<c r="${ref}" s="${ESTILO_NEGRITA}" t="inlineStr">` +
    `<is><t xml:space="preserve">${escaparXml(celda.negrita)}</t></is></c>`
  );
}

function hojaXml(hoja: Hoja): string {
  const columnas = hoja.anchos?.length
    ? `<cols>${hoja.anchos
        .map((a, i) => `<col min="${i + 1}" max="${i + 1}" width="${a}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const filas = hoja.filas
    .map((fila, i) => {
      const celdas = fila.map((c, j) => celdaXml(c, `${columna(j)}${i + 1}`)).join('');
      return `<row r="${i + 1}">${celdas}</row>`;
    })
    .join('');

  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `${columnas}<sheetData>${filas}</sheetData></worksheet>`
  );
}

const ESTILOS =
  '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
  '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
  '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>' +
  '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
  '<fills count="2"><fill><patternFill patternType="none"/></fill>' +
  '<fill><patternFill patternType="gray125"/></fill></fills>' +
  '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
  '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
  '<cellXfs count="3">' +
  '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
  '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
  // 4 es el formato integrado "#,##0.00".
  '<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
  '</cellXfs></styleSheet>';

function validarNombre(nombre: string): void {
  if (!nombre || nombre.length > 31 || /[[\]:*?/\\]/.test(nombre)) {
    throw new Error(`"${nombre}" no sirve como nombre de hoja de Excel.`);
  }
}

/** Arma el .xlsx completo. */
export function libroXlsx(hojas: Hoja[]): Buffer {
  if (hojas.length === 0) throw new Error('Un libro de Excel necesita al menos una hoja.');
  hojas.forEach((h) => validarNombre(h.nombre));

  const tipos =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    hojas
      .map(
        (_, i) =>
          `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ` +
          'ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>',
      )
      .join('') +
    '</Types>';

  const relsRaiz =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>';

  const libro =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    hojas
      .map(
        (h, i) => `<sheet name="${escaparXml(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`,
      )
      .join('') +
    '</sheets></workbook>';

  const relsLibro =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    hojas
      .map(
        (_, i) =>
          `<Relationship Id="rId${i + 1}" ` +
          'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ' +
          `Target="worksheets/sheet${i + 1}.xml"/>`,
      )
      .join('') +
    `<Relationship Id="rId${hojas.length + 1}" ` +
    'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" ' +
    'Target="styles.xml"/></Relationships>';

  return zipAlmacenado([
    ['[Content_Types].xml', tipos],
    ['_rels/.rels', relsRaiz],
    ['xl/workbook.xml', libro],
    ['xl/_rels/workbook.xml.rels', relsLibro],
    ['xl/styles.xml', ESTILOS],
    ...hojas.map((h, i): [string, string] => [`xl/worksheets/sheet${i + 1}.xml`, hojaXml(h)]),
  ]);
}

/**
 * ZIP sin compresion (metodo 0).
 *
 * Fecha fija (1 de enero de 1980, la minima del formato) para que el mismo
 * contenido produzca siempre los mismos bytes: un archivo que cambia en cada
 * descarga no se puede comparar con el de ayer.
 */
export function zipAlmacenado(archivos: Array<[string, string]>): Buffer {
  const FECHA_DOS = (0 << 9) | (1 << 5) | 1;
  const HORA_DOS = 0;

  const locales: Buffer[] = [];
  const centrales: Buffer[] = [];
  let desplazamiento = 0;

  for (const [nombre, contenido] of archivos) {
    const nombreBytes = Buffer.from(nombre, 'utf8');
    const datos = Buffer.from(contenido, 'utf8');
    const crc = crc32(datos);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(HORA_DOS, 10);
    local.writeUInt16LE(FECHA_DOS, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(datos.length, 18);
    local.writeUInt32LE(datos.length, 22);
    local.writeUInt16LE(nombreBytes.length, 26);
    local.writeUInt16LE(0, 28);
    locales.push(local, nombreBytes, datos);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(HORA_DOS, 12);
    central.writeUInt16LE(FECHA_DOS, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(datos.length, 20);
    central.writeUInt32LE(datos.length, 24);
    central.writeUInt16LE(nombreBytes.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    centrales.push(central, nombreBytes);

    desplazamiento += local.length + nombreBytes.length + datos.length;
  }

  const directorio = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(archivos.length, 8);
  fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(directorio.length, 12);
  fin.writeUInt32LE(desplazamiento, 16);

  return Buffer.concat([...locales, directorio, fin]);
}
