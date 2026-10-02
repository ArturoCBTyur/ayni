/**
 * Pruebas de MotorAIni, el cliente del servicio de analisis.
 *
 * Lo que se verifica aqui no es que el analisis sea bueno —eso lo prueba el
 * servicio en su propio lenguaje— sino que el backend se comporte bien cuando
 * el servicio **no** se comporta: cuando se cae, cuando tarda, cuando responde
 * algo que no es lo pactado. En un sistema que retiene dinero de terceros, el
 * modo de fallo importa tanto como el camino feliz.
 */
import { ConfigService } from '@nestjs/config';

import type { Configuracion } from '../../../config/configuracion';

import type { EntradaAnalisis, ResultadoAnalisis } from '../contrato/analisis.contrato';
import { MotorAIni } from './aini.motor';
import type { MotorReglasV0 } from './reglas-v0.motor';

const URL_AINI = 'http://aini.de.prueba:8000';

function entrada(): EntradaAnalisis {
  return {
    gastoId: 'gasto-1',
    declarado: {
      fondoId: 'fondo-1',
      categoriaGasto: 'ATENCION_VETERINARIA',
      montoDeclarado: 118,
      concepto: 'atencion veterinaria de urgencia',
      proveedorNombre: 'Clinica San Roque',
      proveedorRuc: null,
      fechaGasto: '2026-09-14',
      capturadoEn: '2026-09-14',
    },
    comprobante: {
      tipo: 'BOLETA',
      rucEmisor: '20601030579',
      serie: 'B001',
      numero: '004521',
      fechaEmision: '2026-09-14',
      subtotal: 100,
      igv: 18,
      total: 118,
      moneda: 'PEN',
      hashSha256: 'abc',
      archivoUrl: '/x',
    },
    evidencias: [],
    contexto: {
      saldoRetenido: 500,
      mediaHistoricaCategoria: 130,
      desviacionHistoricaCategoria: 40,
      proveedorConocido: true,
      gastosRecientesMismaCategoria: 1,
    },
    regla: {
      id: 'regla-1',
      umbralAlto: 90,
      umbralMedio: 60,
      pesoDocumental: 0.45,
      pesoVisual: 0.25,
      pesoAnomalia: 0.3,
    },
  };
}

/** Respuesta completa y valida del servicio. */
function respuestaValida(): ResultadoAnalisis {
  return {
    scoreDocumental: 100,
    scoreVisual: 100,
    scoreAnomalia: 95,
    scoreFinal: 98.5,
    nivel: 'ALTO',
    datosExtraidos: {
      fuente: 'declarado',
      tipo: 'BOLETA',
      rucEmisor: '20601030579',
      serie: 'B001',
      numero: '004521',
      fechaEmision: '2026-09-14',
      subtotal: 100,
      igv: 18,
      total: 118,
    },
    explicacion: {
      motivos: [
        {
          regla: 'nlp.coherencia_categoria',
          senal: 'documental',
          resultado: 'ok',
          mensaje: 'El concepto corresponde a la categoria del fondo.',
          valor: 0.78,
          penalizacion: 0,
        },
      ],
      resumen: 'El gasto tiene respaldo consistente.',
    },
    alertas: [],
    narrativaBorrador: null,
    versionModelo: 'aini-0.1-sklearn',
    duracionMs: 80,
  };
}

/**
 * Respaldo determinista, con una marca para reconocer que fue el.
 *
 * Se devuelve el espia aparte y no se extrae despues de `motor.analizar`:
 * sacar un metodo de su objeto lo desliga de su `this`, y aunque aqui sea
 * inocuo es el patron que produce fallos raros en codigo real.
 */
function respaldoFalso(): { motor: MotorReglasV0; analizar: jest.Mock } {
  const analizar = jest.fn().mockResolvedValue({
    ...respuestaValida(),
    scoreFinal: 72,
    nivel: 'MEDIO',
    versionModelo: 'motor-verificacion@reglas-v0',
    explicacion: { motivos: [], resumen: 'Resuelto por reglas.' },
  } satisfies ResultadoAnalisis);

  return {
    motor: { version: 'motor-verificacion@reglas-v0', analizar } as unknown as MotorReglasV0,
    analizar,
  };
}

function configFalsa(valores: Record<string, unknown> = {}): ConfigService<Configuracion, true> {
  const base: Record<string, unknown> = {
    AINI_URL: URL_AINI,
    AINI_TOKEN: 'token-de-prueba',
    AINI_TIMEOUT_MS: 20_000,
    ...valores,
  };
  return { get: (clave: string) => base[clave] } as unknown as ConfigService<Configuracion, true>;
}

const fetchOriginal = global.fetch;

afterEach(() => {
  global.fetch = fetchOriginal;
  jest.restoreAllMocks();
});

describe('Camino feliz', () => {
  it('devuelve el analisis del servicio y registra su version', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(respuestaValida()),
    });

    const motor = new MotorAIni(configFalsa(), respaldoFalso().motor);
    const r = await motor.analizar(entrada());

    expect(r.nivel).toBe('ALTO');
    expect(r.scoreFinal).toBe(98.5);
    // La version identifica al motor que decidio, que es lo que un auditor
    // necesita para saber como se evaluo cada gasto.
    expect(r.versionModelo).toBe('motor-verificacion@aini-0.1-sklearn');
    expect(motor.version).toBe('motor-verificacion@aini-0.1-sklearn');
  });

  it('envia el token en la cabecera y el contrato tal cual', async () => {
    const espia = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(respuestaValida()),
    });
    global.fetch = espia;

    await new MotorAIni(configFalsa(), respaldoFalso().motor).analizar(entrada());

    const [url, opciones] = espia.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${URL_AINI}/analizar`);
    expect((opciones.headers as Record<string, string>).Authorization).toBe(
      'Bearer token-de-prueba',
    );

    const enviado = JSON.parse(opciones.body as string) as EntradaAnalisis;
    expect(enviado.gastoId).toBe('gasto-1');
    expect(enviado.regla.umbralAlto).toBe(90);
  });
});

describe('Cuando el servicio no se comporta, el gasto no queda sin verificar', () => {
  /** Cada forma de fallar debe terminar en el respaldo, no en una excepcion. */
  const fallos: [string, unknown][] = [
    ['la conexion falla', Promise.reject(new Error('ECONNREFUSED'))],
    ['responde 500', Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('') })],
    [
      'devuelve algo que no es JSON',
      Promise.resolve({ ok: true, json: () => Promise.reject(new Error('no es json')) }),
    ],
    [
      'devuelve un nivel que no existe',
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...respuestaValida(), nivel: 'EXCELENTE' }),
      }),
    ],
    [
      'devuelve un puntaje fuera de rango',
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...respuestaValida(), scoreFinal: 1200 }),
      }),
    ],
    [
      'omite la explicacion que exige el RNF-09',
      Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ ...respuestaValida(), explicacion: undefined }),
      }),
    ],
  ];

  it.each(fallos)('%s', async (_nombre, respuesta) => {
    global.fetch = jest.fn().mockReturnValue(respuesta);

    const respaldo = respaldoFalso();
    const r = await new MotorAIni(configFalsa(), respaldo.motor).analizar(entrada());

    // Lo esencial: hay analisis, lo hizo el motor de reglas, y se dice.
    expect(respaldo.analizar).toHaveBeenCalledTimes(1);
    expect(r.versionModelo).toBe('motor-verificacion@reglas-v0');
    expect(r.explicacion.motivos[0].regla).toBe('aini.respaldo');
    expect(r.explicacion.motivos[0].mensaje).toMatch(/no estuvo disponible/i);
  });

  it('sin AINI_URL ni siquiera intenta la llamada', async () => {
    const espia = jest.fn();
    global.fetch = espia;

    const respaldo = respaldoFalso();
    const r = await new MotorAIni(configFalsa({ AINI_URL: undefined }), respaldo.motor).analizar(
      entrada(),
    );

    expect(espia).not.toHaveBeenCalled();
    expect(respaldo.analizar).toHaveBeenCalledTimes(1);
    expect(r.versionModelo).toBe('motor-verificacion@reglas-v0');
  });

  it('la caida queda anotada en la explicacion sin borrar los motivos reales', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout'));

    const respaldoConMotivos = {
      version: 'motor-verificacion@reglas-v0',
      analizar: jest.fn().mockResolvedValue({
        ...respuestaValida(),
        versionModelo: 'motor-verificacion@reglas-v0',
        explicacion: {
          motivos: [
            {
              regla: 'doc.ruc_modulo11',
              senal: 'documental',
              resultado: 'ok',
              mensaje: 'El RUC del emisor es valido.',
              penalizacion: 0,
            },
          ],
          resumen: 'Resuelto por reglas.',
        },
      } satisfies ResultadoAnalisis),
    } as unknown as MotorReglasV0;

    const r = await new MotorAIni(configFalsa(), respaldoConMotivos).analizar(entrada());

    // El aviso va primero, pero lo que el motor de reglas evaluo se conserva:
    // sustituirlo dejaria al auditor sin la informacion que si se produjo.
    expect(r.explicacion.motivos).toHaveLength(2);
    expect(r.explicacion.motivos[0].regla).toBe('aini.respaldo');
    expect(r.explicacion.motivos[1].regla).toBe('doc.ruc_modulo11');
  });
});
