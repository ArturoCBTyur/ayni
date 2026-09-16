/**
 * Pruebas del Motor de Reglas v0 (Fase 6).
 *
 * El motor es una funcion sobre su entrada: el backend le pasa todas las
 * señales ya calculadas, asi que se puede probar entero sin base de datos.
 * Eso no es casualidad, es lo que hace que AIni pueda sustituirlo mas tarde
 * recibiendo exactamente lo mismo.
 */
import { FakeSunatService } from '../cpe/fake-sunat.service';
import type { EntradaAnalisis } from '../contrato/analisis.contrato';
import { MotorReglasV0 } from './reglas-v0.motor';

const motor = new MotorReglasV0(new FakeSunatService());

const REGLA = {
  id: 'regla-de-prueba',
  umbralAlto: 90,
  umbralMedio: 60,
  pesoDocumental: 0.45,
  pesoVisual: 0.25,
  pesoAnomalia: 0.3,
};

/** Gasto impecable: todo coherente, evidencia nueva y nitida. */
function entradaIdeal(cambios: Partial<EntradaAnalisis> = {}): EntradaAnalisis {
  return {
    gastoId: 'gasto-1',
    declarado: {
      fondoId: 'fondo-1',
      categoriaGasto: 'ALIMENTOS',
      montoDeclarado: 118,
      concepto: 'Alimento balanceado para el refugio',
      proveedorNombre: 'Agroveterinaria El Establo',
      proveedorRuc: null,
      fechaGasto: '2026-09-10T00:00:00.000Z',
      capturadoEn: '2026-09-10T15:00:00.000Z',
    },
    comprobante: {
      tipo: 'BOLETA',
      rucEmisor: '20601030579',
      serie: 'B001',
      numero: '1234',
      fechaEmision: '2026-09-09T00:00:00.000Z',
      subtotal: 100,
      igv: 18,
      total: 118,
      moneda: 'PEN',
      hashSha256: 'a'.repeat(64),
      archivoUrl: 'comprobantes/x.jpg',
    },
    evidencias: [
      {
        id: 'ev-1',
        tipo: 'FOTO',
        hashSha256: 'b'.repeat(64),
        hashPerceptual: 'ffee00112233aabb',
        nitidez: 300,
        ancho: 1280,
        alto: 960,
        exifCapturadoEn: '2026-09-10T15:00:00.000Z',
        distanciaMinimaHistorico: 32,
        contienePersonas: false,
        anonimizada: true,
        archivoUrl: 'evidencias/x.jpg',
      },
    ],
    contexto: {
      saldoRetenido: 1000,
      mediaHistoricaCategoria: 120,
      desviacionHistoricaCategoria: 20,
      proveedorConocido: true,
      gastosRecientesMismaCategoria: 1,
    },
    regla: REGLA,
    ...cambios,
  };
}

describe('Regla de decision (RF-IA-07)', () => {
  it('un gasto impecable alcanza nivel ALTO', async () => {
    const r = await motor.analizar(entradaIdeal());

    expect(r.nivel).toBe('ALTO');
    expect(r.scoreFinal).toBeGreaterThan(REGLA.umbralAlto);
    expect(r.explicacion.resumen).toMatch(/aprueba automaticamente/i);
  });

  it('el score final es la combinacion ponderada de las tres señales', async () => {
    const r = await motor.analizar(entradaIdeal());

    const esperado =
      r.scoreDocumental * REGLA.pesoDocumental +
      r.scoreVisual * REGLA.pesoVisual +
      r.scoreAnomalia * REGLA.pesoAnomalia;

    expect(r.scoreFinal).toBeCloseTo(esperado, 1);
  });

  it('usa los umbrales de la regla recibida, no valores fijos', async () => {
    const entrada = entradaIdeal();
    const conUmbralAlto = await motor.analizar(entrada);

    // El gasto ideal puntua 100, y la regla es "mayor que el umbral". Con el
    // umbral en 100 ya no lo supera y cae a MEDIO, sin que cambie su puntaje.
    const exigente = await motor.analizar({
      ...entrada,
      regla: { ...REGLA, umbralAlto: 100 },
    });

    expect(conUmbralAlto.nivel).toBe('ALTO');
    expect(exigente.nivel).toBe('MEDIO');
    // El puntaje no cambia: lo que cambio es donde se pone la raya.
    expect(exigente.scoreFinal).toBe(conUmbralAlto.scoreFinal);
  });

  it('respeta pesos distintos', async () => {
    const entrada = entradaIdeal({
      evidencias: [{ ...entradaIdeal().evidencias[0], nitidez: 5 }],
    });

    const pesoVisualBajo = await motor.analizar({
      ...entrada,
      regla: { ...REGLA, pesoDocumental: 0.8, pesoVisual: 0.1, pesoAnomalia: 0.1 },
    });
    const pesoVisualAlto = await motor.analizar({
      ...entrada,
      regla: { ...REGLA, pesoDocumental: 0.2, pesoVisual: 0.7, pesoAnomalia: 0.1 },
    });

    // La misma evidencia borrosa pesa mas cuando la señal visual pesa mas.
    expect(pesoVisualAlto.scoreFinal).toBeLessThan(pesoVisualBajo.scoreFinal);
  });
});

describe('Bloqueos duros', () => {
  it('saldo insuficiente manda a BAJO sin importar el resto', async () => {
    const r = await motor.analizar(
      entradaIdeal({ contexto: { ...entradaIdeal().contexto, saldoRetenido: 50 } }),
    );

    expect(r.nivel).toBe('BAJO');
    expect(r.scoreFinal).toBe(0);
    expect(r.alertas.map((a) => a.tipo)).toContain('SALDO_INSUFICIENTE');
    expect(r.explicacion.resumen).toMatch(/bloqueado/i);
  });

  it('evidencia reutilizada manda a BAJO aunque todo lo demas sea perfecto', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      evidencias: [{ ...base.evidencias[0], distanciaMinimaHistorico: 2 }],
    });

    // Es un hecho objetivo, no un indicio: no se compensa con buen puntaje
    // documental.
    expect(r.nivel).toBe('BAJO');
    expect(r.alertas.map((a) => a.tipo)).toContain('EVIDENCIA_REUTILIZADA');
  });
});

describe('Señal documental', () => {
  it('penaliza fuerte un RUC invalido', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      comprobante: { ...base.comprobante, rucEmisor: '20601030570' },
    });

    expect(r.scoreDocumental).toBeLessThan(70);
    const motivo = r.explicacion.motivos.find((m) => m.regla === 'doc.ruc_modulo11');
    expect(motivo?.resultado).toBe('falla');
    expect(motivo?.mensaje).toMatch(/digito verificador/i);
  });

  it('detecta que subtotal mas IGV no da el total', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      comprobante: { ...base.comprobante, subtotal: 100, igv: 5, total: 118 },
    });

    const motivo = r.explicacion.motivos.find((m) => m.regla === 'doc.suma_comprobante');
    expect(motivo?.resultado).toBe('falla');
    expect(r.nivel).not.toBe('ALTO');
  });

  it('acepta un comprobante sin IGV pero marca un IGV que no cuadra', async () => {
    const base = entradaIdeal();

    // Sin IGV: legitimo en algunos regimenes.
    const sinIgv = await motor.analizar({
      ...base,
      declarado: { ...base.declarado, montoDeclarado: 100 },
      comprobante: { ...base.comprobante, subtotal: 100, igv: 0, total: 100 },
    });
    expect(sinIgv.explicacion.motivos.find((m) => m.regla === 'doc.igv_18')).toBeUndefined();

    // Con un IGV que no es el 18 %: se advierte.
    const igvRaro = await motor.analizar({
      ...base,
      declarado: { ...base.declarado, montoDeclarado: 109 },
      comprobante: { ...base.comprobante, subtotal: 100, igv: 9, total: 109 },
    });
    expect(igvRaro.explicacion.motivos.find((m) => m.regla === 'doc.igv_18')?.resultado).toBe(
      'advertencia',
    );
  });

  it('detecta que el total del comprobante no coincide con el gasto declarado', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      declarado: { ...base.declarado, montoDeclarado: 500 },
    });

    expect(
      r.explicacion.motivos.find((m) => m.regla === 'doc.total_vs_declarado')?.resultado,
    ).toBe('falla');
  });

  it('rechaza un comprobante emitido despues del gasto', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      comprobante: { ...base.comprobante, fechaEmision: '2026-09-20T00:00:00.000Z' },
    });

    expect(r.explicacion.motivos.find((m) => m.regla === 'doc.fecha_posterior')?.resultado).toBe(
      'falla',
    );
  });

  it('advierte de un comprobante fisico sin tratarlo como invalido', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      comprobante: { ...base.comprobante, serie: '001' },
    });

    const motivo = r.explicacion.motivos.find((m) => m.regla === 'doc.comprobante_fisico');
    expect(motivo?.resultado).toBe('advertencia');
    // Una ONG pequeña que recibe boletas impresas no es sospechosa por eso.
    expect(r.scoreDocumental).toBeGreaterThan(90);
  });
});

describe('Señal visual', () => {
  it('penaliza una foto borrosa', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      evidencias: [{ ...base.evidencias[0], nitidez: 10 }],
    });

    expect(r.scoreVisual).toBeLessThan(100);
    expect(r.explicacion.motivos.find((m) => m.regla === 'vis.nitidez')?.resultado).toBe(
      'advertencia',
    );
  });

  it('penaliza una evidencia parecida a otra sin llegar a bloquear', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      evidencias: [{ ...base.evidencias[0], distanciaMinimaHistorico: 7 }],
    });

    // Parecida pero no identica: baja el puntaje, no bloquea.
    expect(r.nivel).not.toBe('BAJO');
    expect(
      r.explicacion.motivos.find((m) => m.regla === 'vis.similitud_historico')?.resultado,
    ).toBe('advertencia');
  });

  it('advierte cuando el EXIF esta muy lejos de la fecha del gasto', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      evidencias: [{ ...base.evidencias[0], exifCapturadoEn: '2026-06-01T00:00:00.000Z' }],
    });

    expect(r.explicacion.motivos.find((m) => m.regla === 'vis.exif_desfasado')?.resultado).toBe(
      'advertencia',
    );
  });

  it('no penaliza la ausencia de EXIF', async () => {
    const base = entradaIdeal();
    const sinExif = await motor.analizar({
      ...base,
      evidencias: [{ ...base.evidencias[0], exifCapturadoEn: null }],
    });

    // Muchas camaras y apps quitan el EXIF; su ausencia no es una señal de
    // fraude, asi que la regla se omite en lugar de restar.
    expect(sinExif.scoreVisual).toBe(100);
  });

  it('con evidencia en video no penaliza: deriva a revision', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      evidencias: [{ ...base.evidencias[0], tipo: 'VIDEO' }],
    });

    expect(r.explicacion.motivos.find((m) => m.regla === 'vis.sin_fotos')?.penalizacion).toBe(0);
    expect(r.nivel).toBe('MEDIO');
  });
});

describe('Señal de anomalia', () => {
  it('marca un monto muy alejado del promedio historico', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      declarado: { ...base.declarado, montoDeclarado: 118 },
      contexto: {
        ...base.contexto,
        mediaHistoricaCategoria: 20,
        desviacionHistoricaCategoria: 5,
      },
    });

    const motivo = r.explicacion.motivos.find((m) => m.regla === 'ano.monto_atipico');
    expect(motivo?.resultado).toBe('falla');
    expect(r.alertas.map((a) => a.tipo)).toContain('MONTO_ATIPICO');
  });

  it('sin historial no penaliza: lo declara y sigue', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      contexto: {
        ...base.contexto,
        mediaHistoricaCategoria: null,
        desviacionHistoricaCategoria: null,
      },
    });

    // Penalizar aqui castigaria a toda ONG nueva por el hecho de serlo.
    const motivo = r.explicacion.motivos.find((m) => m.regla === 'ano.sin_historial');
    expect(motivo?.penalizacion).toBe(0);
  });

  it('advierte de un proveedor nunca visto', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      contexto: { ...base.contexto, proveedorConocido: false },
    });

    expect(r.explicacion.motivos.find((m) => m.regla === 'ano.proveedor_nuevo')?.resultado).toBe(
      'advertencia',
    );
  });

  it('detecta posible fraccionamiento', async () => {
    const base = entradaIdeal();
    const r = await motor.analizar({
      ...base,
      contexto: { ...base.contexto, gastosRecientesMismaCategoria: 8 },
    });

    expect(r.alertas.map((a) => a.tipo)).toContain('POSIBLE_FRACCIONAMIENTO');
  });
});

describe('Explicabilidad (RNF-09, RF-IA-08)', () => {
  it('cada motivo dice que regla evaluo, como salio y con que valor', async () => {
    const r = await motor.analizar(entradaIdeal());

    expect(r.explicacion.motivos.length).toBeGreaterThan(3);
    for (const motivo of r.explicacion.motivos) {
      expect(motivo.regla).toMatch(/^(doc|vis|ano|bloqueo)\./);
      expect(['ok', 'advertencia', 'falla']).toContain(motivo.resultado);
      // El mensaje va a la interfaz tal cual: tiene que ser una frase, no
      // un codigo de error.
      expect(motivo.mensaje.length).toBeGreaterThan(20);
      expect(typeof motivo.penalizacion).toBe('number');
    }
  });

  it('el resumen explica el desenlace en una frase', async () => {
    const alto = await motor.analizar(entradaIdeal());
    const bajo = await motor.analizar(
      entradaIdeal({ contexto: { ...entradaIdeal().contexto, saldoRetenido: 1 } }),
    );

    expect(alto.explicacion.resumen).toMatch(/coherentes/i);
    expect(bajo.explicacion.resumen.length).toBeGreaterThan(20);
  });

  it('declara la procedencia de los datos y la version del motor', async () => {
    const r = await motor.analizar(entradaIdeal());

    // En esta version los campos los captura el operador; con AIni sera
    // "ocr" y se podran contrastar ambas lecturas.
    expect(r.datosExtraidos.fuente).toBe('declarado');
    expect(r.versionModelo).toBe('motor-verificacion@reglas-v0');
    expect(r.duracionMs).toBeGreaterThanOrEqual(0);
  });

  it('es determinista: la misma entrada da el mismo resultado', async () => {
    const entrada = entradaIdeal();
    const a = await motor.analizar(entrada);
    const b = await motor.analizar(entrada);

    expect(a.scoreFinal).toBe(b.scoreFinal);
    expect(a.nivel).toBe(b.nivel);
    expect(a.explicacion.motivos.map((m) => m.regla)).toEqual(
      b.explicacion.motivos.map((m) => m.regla),
    );
  });

  it('los scores nunca salen del rango 0 a 100', async () => {
    const base = entradaIdeal();
    const peor = await motor.analizar({
      ...base,
      declarado: { ...base.declarado, montoDeclarado: 9999, capturadoEn: '2027-01-01T00:00:00Z' },
      comprobante: {
        ...base.comprobante,
        rucEmisor: '00000000000',
        serie: 'XX',
        subtotal: 1,
        igv: 999,
        total: 5,
        fechaEmision: '2027-12-31T00:00:00.000Z',
      },
      evidencias: [
        { ...base.evidencias[0], nitidez: 1, ancho: 100, alto: 80, distanciaMinimaHistorico: 6 },
      ],
      contexto: {
        saldoRetenido: 100000,
        mediaHistoricaCategoria: 10,
        desviacionHistoricaCategoria: 1,
        proveedorConocido: false,
        gastosRecientesMismaCategoria: 20,
      },
    });

    for (const score of [peor.scoreDocumental, peor.scoreVisual, peor.scoreAnomalia]) {
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
    expect(peor.nivel).toBe('BAJO');
  });
});

describe('FakeSunatService', () => {
  const cpe = new FakeSunatService();

  it('nunca afirma que el comprobante existe ante la SUNAT', async () => {
    const r = await cpe.consultar({
      tipo: 'BOLETA',
      rucEmisor: '20601030579',
      serie: 'B001',
      numero: '1',
      fechaEmision: new Date('2026-09-09'),
      total: 118,
    });

    expect(r.dictamen).toBe('VALIDO');
    // La distincion importa: "bien formado" no es "existe y fue emitido".
    expect(r.confirmado.existeEnSunat).toBeNull();
    expect(r.fuente).toBe('formato');
    expect(r.observaciones[0]).toMatch(/no se pudo confirmar su existencia/i);
  });

  it('rechaza un comprobante mal formado y explica por que', async () => {
    const r = await cpe.consultar({
      tipo: 'FACTURA',
      rucEmisor: '99999999999',
      serie: 'ZZ',
      numero: '1',
      fechaEmision: new Date('2030-01-01'),
      total: 100,
    });

    expect(r.dictamen).toBe('INVALIDO');
    expect(r.observaciones.length).toBeGreaterThanOrEqual(2);
    expect(r.confirmado.rucBienFormado).toBe(false);
    expect(r.confirmado.fechaCoherente).toBe(false);
  });

  it('verifica el desglose con el IGV al 18 %', () => {
    expect(FakeSunatService.verificarDesglose(100, 18, 118)).toMatchObject({
      sumaCorrecta: true,
      igvCorrecto: true,
    });
    expect(FakeSunatService.verificarDesglose(100, 18, 150).sumaCorrecta).toBe(false);
    expect(FakeSunatService.verificarDesglose(100, 9, 109).igvCorrecto).toBe(false);
    // Sin IGV es legitimo.
    expect(FakeSunatService.verificarDesglose(100, 0, 100).igvCorrecto).toBe(true);
  });
});
