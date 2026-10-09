/**
 * Exportacion en el estandar IATI 2.03 (RF-IN-06, T7.1 del plan).
 *
 * Una actividad por campaña. Lo que se publica es lo mismo que ya es publico
 * en la ficha de cada causa, en un formato que otros sistemas leen sin
 * preguntar: cuanto entro, en que se gasto, que paso con el remanente y que
 * resultado tuvo. Las decisiones que tomo esta version, a firmar en D5:
 *
 * - las donaciones van sumadas por mes: una por una, con su fecha y su monto,
 *   alcanzarian para reconocer a un donante que alguien conoce;
 * - el sector es 31195 (servicios veterinarios y de ganaderia) para todas,
 *   el codigo CAD mas cercano a una causa de bienestar animal;
 * - el remanente devuelto o trasladado al cerrar una causa va como
 *   desembolso (3), que es dinero que sale hacia otro destinatario.
 */

export type TipoTransaccion = 1 | 3 | 4;

export interface ActividadIati {
  identificador: string;
  titulo: string;
  descripcion: string;
  /** 2 en ejecucion, 3 finalizando, 4 cerrada, 6 suspendida (codelist ActivityStatus). */
  estado: 2 | 3 | 4 | 6;
  inicio: string;
  /** Fin real si cerro; si no, el previsto, o nada. */
  fin: { fecha: string; real: boolean } | null;
  actualizada: Date;
  transacciones: Array<{
    tipo: TipoTransaccion;
    fecha: string;
    monto: string;
    descripcion: string;
    proveedor?: string;
    receptor?: string;
  }>;
  resultados: Array<{ unidad: string; valor: number; desde: string; hasta: string }>;
}

export interface OrganizacionIati {
  /** PE-RUC-<ruc>, el identificador de organizacion de org-id.guide para el Peru. */
  ref: string;
  nombre: string;
}

export const SECTOR_CAD = '31195';

function escapar(texto: string): string {
  return (
    texto
      // eslint-disable-next-line no-control-regex
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  );
}

const narrativa = (texto: string) => `<narrative>${escapar(texto)}</narrative>`;

function actividad(a: ActividadIati, org: OrganizacionIati): string {
  const transacciones = a.transacciones
    .map(
      (t) =>
        '<transaction>' +
        `<transaction-type code="${t.tipo}"/>` +
        `<transaction-date iso-date="${t.fecha}"/>` +
        `<value currency="PEN" value-date="${t.fecha}">${t.monto}</value>` +
        `<description>${narrativa(t.descripcion)}</description>` +
        (t.proveedor ? `<provider-org>${narrativa(t.proveedor)}</provider-org>` : '') +
        (t.receptor ? `<receiver-org>${narrativa(t.receptor)}</receiver-org>` : '') +
        '</transaction>',
    )
    .join('');

  const resultados = a.resultados
    .map(
      (r) =>
        '<result type="1">' +
        `<title>${narrativa(`Impacto: ${r.unidad}`)}</title>` +
        '<indicator measure="1">' +
        `<title>${narrativa(r.unidad)}</title>` +
        '<period>' +
        `<period-start iso-date="${r.desde}"/>` +
        `<period-end iso-date="${r.hasta}"/>` +
        `<actual value="${r.valor}"/>` +
        '</period>' +
        '</indicator>' +
        '</result>',
    )
    .join('');

  const fin = a.fin
    ? `<activity-date type="${a.fin.real ? 4 : 3}" iso-date="${a.fin.fecha}"/>`
    : '';

  return (
    `<iati-activity last-updated-datetime="${a.actualizada.toISOString()}" ` +
    'xml:lang="es" default-currency="PEN">' +
    `<iati-identifier>${escapar(a.identificador)}</iati-identifier>` +
    `<reporting-org ref="${escapar(org.ref)}" type="22">${narrativa(org.nombre)}</reporting-org>` +
    `<title>${narrativa(a.titulo)}</title>` +
    `<description type="1">${narrativa(a.descripcion)}</description>` +
    '<participating-org role="1">' +
    narrativa('Donantes individuales a través de Ayni') +
    '</participating-org>' +
    `<participating-org role="4" ref="${escapar(org.ref)}" type="22">` +
    narrativa(org.nombre) +
    '</participating-org>' +
    `<activity-status code="${a.estado}"/>` +
    `<activity-date type="2" iso-date="${a.inicio}"/>` +
    fin +
    '<recipient-country code="PE" percentage="100"/>' +
    `<sector vocabulary="1" code="${SECTOR_CAD}" percentage="100"/>` +
    transacciones +
    resultados +
    '</iati-activity>'
  );
}

/** El documento iati-activities completo de una organizacion. */
export function documentoIati(
  org: OrganizacionIati,
  actividades: ActividadIati[],
  generado: Date,
): string {
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    `<iati-activities version="2.03" generated-datetime="${generado.toISOString()}">` +
    actividades.map((a) => actividad(a, org)).join('') +
    '</iati-activities>\n'
  );
}
