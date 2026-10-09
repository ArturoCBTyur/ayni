import { DocumentoPdf } from '../../comun/formatos/pdf';
import { libroXlsx, type Celda } from '../../comun/formatos/xlsx';
import { fechaEnLima } from '../../comun/periodo';

/**
 * RF-DE-08 · Informe de cumplimiento de la Ley N.o 29733 (T6.2).
 *
 * Lo que la plataforma tiene que poder mostrar ante una fiscalizacion: que
 * atiende los derechos ARCO dentro del plazo, que pide y registra el
 * consentimiento por finalidad, y que ninguna foto con personas llego a un
 * donante sin difuminar (DER-1). Solo cifras: ni un nombre ni un correo.
 */
export interface InformeCumplimiento {
  periodo: { desde: Date; hasta: Date };
  arco: {
    recibidas: number;
    porTipo: Record<string, number>;
    resueltas: number;
    resueltasEnPlazo: number;
    porcentajeEnPlazo: number | null;
    diasPromedioDeRespuesta: number | null;
    /** Abiertas con el plazo ya vencido al terminar el periodo: lo que hay que mirar primero. */
    vencidasSinResolver: number;
  };
  consentimientos: Array<{
    finalidad: string;
    otorgados: number;
    revocados: number;
    vigentesAlCierre: number;
  }>;
  der1: { notificacionesConEvidencia: number; sinAnonimizar: number; cumple: boolean };
}

const FINALIDADES: Record<string, string> = {
  TRATAMIENTO_DATOS: 'Tratamiento de datos',
  COMUNICACIONES: 'Comunicaciones',
  USO_IMAGEN: 'Uso de nombre e imagen',
  INVESTIGACION: 'Investigación (encuestas)',
};

const rango = (i: InformeCumplimiento) =>
  `${fechaEnLima(i.periodo.desde)} al ${fechaEnLima(new Date(i.periodo.hasta.getTime() - 1))}`;

function filas(i: InformeCumplimiento): Celda[][] {
  return [
    [{ negrita: 'Derechos ARCO' }],
    ['Solicitudes recibidas', i.arco.recibidas],
    ...Object.entries(i.arco.porTipo).map(([tipo, n]): Celda[] => [
      `  de ${tipo.toLowerCase()}`,
      n,
    ]),
    ['Resueltas', i.arco.resueltas],
    ['Resueltas dentro del plazo legal', i.arco.resueltasEnPlazo],
    ['Porcentaje en plazo (DER-2)', i.arco.porcentajeEnPlazo ?? 'sin solicitudes resueltas'],
    ['Días promedio de respuesta', i.arco.diasPromedioDeRespuesta ?? '—'],
    ['Abiertas con el plazo vencido', i.arco.vencidasSinResolver],
    [],
    [
      { negrita: 'Consentimiento por finalidad' },
      { negrita: 'Otorgados' },
      { negrita: 'Revocados' },
      { negrita: 'Vigentes al cierre' },
    ],
    ...i.consentimientos.map((c): Celda[] => [
      FINALIDADES[c.finalidad] ?? c.finalidad,
      c.otorgados,
      c.revocados,
      c.vigentesAlCierre,
    ]),
    [],
    [{ negrita: 'DER-1 · Evidencias con personas publicadas sin difuminar' }],
    ['Notificaciones con evidencia', i.der1.notificacionesConEvidencia],
    ['De ellas, sin anonimizar', i.der1.sinAnonimizar],
    ['Cumple (meta 0)', i.der1.cumple ? 'sí' : 'NO'],
  ];
}

export function informeCumplimientoXlsx(i: InformeCumplimiento): Buffer {
  return libroXlsx([
    {
      nombre: 'Ley 29733',
      anchos: [52, 14, 14, 18],
      filas: [
        [{ negrita: `Cumplimiento de la Ley N.° 29733 · ${rango(i)}` }],
        ['Solo cifras: el informe no contiene datos personales.'],
        [],
        ...filas(i),
      ],
    },
  ]);
}

export function informeCumplimientoPdf(i: InformeCumplimiento): Buffer {
  const pdf = new DocumentoPdf('Cumplimiento de la Ley N.° 29733');
  const derecha = DocumentoPdf.ANCHO_UTIL;
  pdf.linea('Cumplimiento de la Ley N.° 29733', { tamano: 16, negrita: true });
  pdf.linea(`Del ${rango(i)} · solo cifras, sin datos personales`, { gris: true });
  pdf.espacio(6).raya();

  for (const fila of filas(i)) {
    if (fila.length === 0) {
      pdf.espacio(8);
      continue;
    }
    const [primera, ...resto] = fila;
    const texto = (c: Celda) =>
      c === null ? '' : typeof c === 'object' ? ('negrita' in c ? c.negrita : c.soles) : String(c);
    const negrita = typeof primera === 'object' && primera !== null && 'negrita' in primera;
    pdf.fila([
      { texto: texto(primera), negrita },
      ...resto.map((c, k) => ({
        texto: texto(c),
        x: derecha - (resto.length - 1 - k) * 80,
        alineacion: 'derecha' as const,
        negrita,
      })),
    ]);
  }
  return pdf.generar();
}
