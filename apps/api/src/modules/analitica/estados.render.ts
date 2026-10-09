import { DocumentoPdf } from '../../comun/formatos/pdf';
import { libroXlsx, type Celda, type Hoja } from '../../comun/formatos/xlsx';
import type { EstadoMensual, ResultadoEstado } from './estados.service';

/**
 * Los estados mensuales en Excel y en PDF (RF-CF-08, D5).
 *
 * Ambos se arman desde el mismo ResultadoEstado que se entrega en JSON, de
 * modo que no hay una cifra en el PDF que no este en el JSON. Lo que agregan
 * es lo que un contador necesita para confiar en el papel: si el mes esta
 * cerrado, con que hash, si el libro todavia lo sostiene y bajo que marco se
 * presento.
 */

const CATEGORIAS: Record<string, string> = {
  ALIMENTOS: 'Alimentos',
  ATENCION_VETERINARIA: 'Atención veterinaria',
  MEDICAMENTOS: 'Medicamentos',
  INSUMOS: 'Insumos',
  TRANSPORTE: 'Transporte',
  INFRAESTRUCTURA: 'Infraestructura',
  ESTERILIZACION: 'Esterilización',
  OTROS: 'Otros',
};

/** "S/ 1,234.50", el formato de la aplicacion (RNF-20). */
export function enSoles(importe: string): string {
  const negativo = importe.startsWith('-');
  const [entero, decimales = '00'] = importe.replace('-', '').split('.');
  const conMiles = entero.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negativo ? '-' : ''}S/ ${conMiles}.${decimales}`;
}

function estadoDelCierre(r: ResultadoEstado): string {
  if (r.cierre) {
    if (r.cierre.vigente === null) {
      return 'Cerrado con una versión anterior del formato: se entrega tal como se guardó.';
    }
    return r.cierre.vigente
      ? 'Cerrado. El libro sigue sosteniendo estas cifras.'
      : 'Cerrado, pero el libro ya no da estas cifras: se asentó en este mes después de cerrarlo.';
  }
  return r.enCurso
    ? 'Mes en curso: las cifras pueden cambiar hasta el cierre.'
    : 'Mes terminado, todavía sin cierre: las cifras pueden cambiar hasta que se cierre.';
}

/** Filas del estado de actividades, compartidas por Excel y PDF. */
function actividades(e: EstadoMensual): Array<[string, string]> {
  const a = e.actividades;
  return [
    ['Donaciones recibidas (brutas)', a.donacionesBrutas],
    ['Menos: comisiones de la pasarela', a.comisiones],
    ['Donaciones netas, con restricción del donante', a.donacionesNetas],
    ['Liberado contra gasto aprobado', a.ejecutado],
    ['Menos: liberaciones revertidas', a.revertido],
    ['Liberado neto del mes', a.liberadoNeto],
    ['Reasignado a otro destino', a.reasignado],
  ];
}

function situacion(e: EstadoMensual): Array<[string, string]> {
  const s = e.situacion;
  return [
    ['Recaudado bruto acumulado', s.recaudadoBruto],
    ['Comisiones acumuladas', s.comisiones],
    ['Con restricción: retenido por justificar', s.conRestriccion],
    ['Liberado: ejecutado contra gasto aprobado', s.liberados],
    ['Reasignado, pendiente de llegar a su destino', s.reasignadoPendiente],
    ['Efectivo recibido neto de comisiones', s.efectivoRecibidoNeto],
  ];
}

const NOTA_EFECTIVO =
  'El efectivo es lo recibido neto de comisiones, no lo que hay en custodia: el libro ' +
  'no registra la salida del dinero hacia la ONG (hallazgo 3 de D1, ADR-0007).';

const NOTA_MARCO =
  'Presentado bajo INPAG con correspondencia al PCGE según la propuesta D1 del ADR-0007, ' +
  'todavía sin firma de Contabilidad.';

export function nombreArchivo(r: ResultadoEstado, extension: string): string {
  const slug = r.estado.fondo.nombre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return `estado-${slug}-${r.estado.periodo.codigo}.${extension}`;
}

export function estadoXlsx(r: ResultadoEstado): Buffer {
  const e = r.estado;
  const filasMonto = (filas: Array<[string, string]>): Celda[][] =>
    filas.map(([concepto, monto]) => [concepto, { soles: monto }]);

  const resumen: Hoja = {
    nombre: 'Estado de actividades',
    anchos: [52, 18],
    filas: [
      [{ negrita: `Estado de actividades · ${e.periodo.nombre}` }],
      [`${e.fondo.nombre} · ${e.fondo.campana.titulo}`],
      [`${e.fondo.ong.razonSocial} · RUC ${e.fondo.ong.ruc}`],
      [estadoDelCierre(r)],
      [],
      [{ negrita: 'Concepto' }, { negrita: 'Monto (S/)' }],
      ...filasMonto(actividades(e)),
      [],
      [{ negrita: 'Retenido por justificar' }],
      ['Al inicio del mes', { soles: e.retenido.inicial }],
      ['Al cierre del mes', { soles: e.retenido.final }],
      ['Variación', { soles: e.retenido.variacion }],
      [],
      [{ negrita: 'Ejecutado por categoría' }, { negrita: 'Neto (S/)' }, { negrita: 'Gastos' }],
      ...e.actividades.ejecutadoPorCategoria.map((c): Celda[] => [
        CATEGORIAS[c.categoria] ?? c.categoria,
        { soles: c.neto },
        c.gastos,
      ]),
      [],
      [NOTA_MARCO],
    ],
  };

  const situacionFondo: Hoja = {
    nombre: 'Situación del fondo',
    anchos: [52, 18],
    filas: [
      [{ negrita: `Situación del fondo al cierre de ${e.periodo.nombre}` }],
      [],
      [{ negrita: 'Concepto' }, { negrita: 'Monto (S/)' }],
      ...filasMonto(situacion(e)),
      [],
      [
        e.situacion.particionCuadra
          ? 'Cada sol recaudado está en exactamente uno de los conceptos de arriba.'
          : 'ATENCIÓN: los conceptos no suman lo recaudado. Revise la conciliación.',
      ],
      [NOTA_EFECTIVO],
    ],
  };

  const balance: Hoja = {
    nombre: 'Balance PCGE',
    anchos: [10, 44, 38, 12, 16, 16, 16],
    filas: [
      [{ negrita: `Balance de comprobación acumulado al cierre de ${e.periodo.nombre}` }],
      [],
      [
        { negrita: 'Cuenta' },
        { negrita: 'Nombre PCGE' },
        { negrita: 'Subcuenta interna' },
        { negrita: 'Naturaleza' },
        { negrita: 'Debe' },
        { negrita: 'Haber' },
        { negrita: 'Saldo' },
      ],
      ...e.balanceComprobacion.map((b): Celda[] => [
        b.cuenta,
        b.nombre,
        b.auxiliar,
        b.naturaleza === 'DEUDORA' ? 'Deudora' : 'Acreedora',
        { soles: b.debe },
        { soles: b.haber },
        { soles: b.saldo },
      ]),
    ],
  };

  const verificacion: Hoja = {
    nombre: 'Verificación',
    anchos: [34, 70],
    filas: [
      [{ negrita: 'Cómo comprobar este estado' }],
      ['Estado del mes', estadoDelCierre(r)],
      ['Hash del cierre (SHA-256)', r.cierre?.hash ?? 'sin cierre'],
      ['Hash del cierre anterior', e.cierreAnterior?.hash ?? 'ninguno'],
      ['Último movimiento del mes', e.libro.ultimaSecuencia?.toString() ?? 'ninguno'],
      ['Hash de ese movimiento', e.libro.hashUltimo ?? 'ninguno'],
      ['Movimientos del mes', e.libro.movimientosDelPeriodo],
      ['Cadena del fondo', r.cadena.integra ? 'íntegra' : 'ROTA: el libro fue alterado'],
      [],
      [
        'El hash del cierre es el SHA-256 del contenido JSON canónico del estado, que entrega ' +
          'la API con formato=json.',
      ],
    ],
  };

  return libroXlsx([resumen, situacionFondo, balance, verificacion]);
}

export function estadoPdf(r: ResultadoEstado): Buffer {
  const e = r.estado;
  const pdf = new DocumentoPdf(`Estado de ${e.fondo.nombre} · ${e.periodo.nombre}`);
  const derecha = DocumentoPdf.ANCHO_UTIL;

  const tabla = (filas: Array<[string, string]>, destacadas: number[] = []) => {
    filas.forEach(([concepto, monto], i) =>
      pdf.fila([
        { texto: concepto, negrita: destacadas.includes(i) },
        {
          texto: enSoles(monto),
          x: derecha,
          alineacion: 'derecha',
          negrita: destacadas.includes(i),
        },
      ]),
    );
  };

  pdf.linea(`Estado de actividades · ${e.periodo.nombre}`, { tamano: 16, negrita: true });
  pdf.linea(`${e.fondo.nombre} · ${e.fondo.campana.titulo}`, { tamano: 11 });
  pdf.linea(`${e.fondo.ong.razonSocial} · RUC ${e.fondo.ong.ruc}`, { tamano: 10, gris: true });
  pdf.espacio(4);
  pdf.parrafo(estadoDelCierre(r), { negrita: true, tamano: 10 });
  pdf.espacio(6).raya();

  tabla(actividades(e), [2, 5]);
  pdf.espacio(10);

  pdf.linea('Retenido por justificar', { negrita: true, tamano: 11 });
  tabla([
    ['Al inicio del mes', e.retenido.inicial],
    ['Al cierre del mes', e.retenido.final],
    ['Variación', e.retenido.variacion],
  ]);
  pdf.espacio(10);

  pdf.linea('Ejecutado por categoría', { negrita: true, tamano: 11 });
  if (e.actividades.ejecutadoPorCategoria.length === 0) {
    pdf.linea('Ningún gasto aprobado en el mes.', { gris: true });
  }
  tabla(
    e.actividades.ejecutadoPorCategoria.map((c): [string, string] => [
      `${CATEGORIAS[c.categoria] ?? c.categoria} (${c.gastos} gasto${c.gastos === 1 ? '' : 's'})`,
      c.neto,
    ]),
  );
  pdf.espacio(14);

  pdf.linea(`Situación del fondo al cierre de ${e.periodo.nombre}`, { tamano: 13, negrita: true });
  pdf.raya();
  tabla(situacion(e));
  pdf.espacio(4);
  pdf.parrafo(NOTA_EFECTIVO, { tamano: 8, gris: true });
  pdf.espacio(14);

  pdf.linea('Balance de comprobación acumulado (PCGE)', { tamano: 13, negrita: true });
  pdf.raya();
  pdf.fila(
    [
      { texto: 'Cuenta', negrita: true },
      { texto: 'Subcuenta interna', x: 40, negrita: true },
      { texto: 'Debe', x: derecha - 150, alineacion: 'derecha', negrita: true },
      { texto: 'Haber', x: derecha - 75, alineacion: 'derecha', negrita: true },
      { texto: 'Saldo', x: derecha, alineacion: 'derecha', negrita: true },
    ],
    9,
  );
  for (const b of e.balanceComprobacion) {
    pdf.fila(
      [
        { texto: b.cuenta },
        { texto: b.auxiliar, x: 40 },
        { texto: b.debe, x: derecha - 150, alineacion: 'derecha' },
        { texto: b.haber, x: derecha - 75, alineacion: 'derecha' },
        { texto: b.saldo, x: derecha, alineacion: 'derecha' },
      ],
      9,
    );
  }
  pdf.espacio(14);

  pdf.linea('Cómo comprobar este estado', { tamano: 11, negrita: true });
  pdf.linea(`Hash del cierre: ${r.cierre?.hash ?? 'sin cierre'}`, { tamano: 8 });
  pdf.linea(`Cierre anterior: ${e.cierreAnterior?.hash ?? 'ninguno'}`, { tamano: 8 });
  pdf.linea(
    `Último movimiento del mes: ${e.libro.ultimaSecuencia ?? 'ninguno'} · ${e.libro.hashUltimo ?? ''}`,
    { tamano: 8 },
  );
  pdf.linea(
    `Cadena del fondo: ${r.cadena.integra ? 'íntegra' : 'ROTA, el libro fue alterado'} ` +
      `(${r.cadena.movimientos} movimientos)`,
    { tamano: 8 },
  );
  pdf.espacio(4);
  pdf.parrafo(
    'El hash es el SHA-256 del contenido JSON canónico del estado, que la API entrega con ' +
      `formato=json. ${NOTA_MARCO}`,
    { tamano: 8, gris: true },
  );

  return pdf.generar();
}
