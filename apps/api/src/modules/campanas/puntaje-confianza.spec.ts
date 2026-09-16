import {
  calcularPuntajeConfianza,
  PUNTAJE_NEUTRO,
  type SenalesPuntaje,
} from './puntaje-confianza';

const sinHistorial: SenalesPuntaje = {
  gastosAprobados: 0,
  gastosConRespaldoCompleto: 0,
  alertasQueAfectan: 0,
  alertasResueltas: 0,
  horasPromedioRespuesta: null,
};

describe('Puntaje de confianza (RF-SO-01)', () => {
  it('una ONG sin historial arranca en el valor neutro', () => {
    const r = calcularPuntajeConfianza(sinHistorial);

    // Ni la hunde antes de empezar ni le regala una reputacion que no gano.
    expect(r.puntaje).toBe(PUNTAJE_NEUTRO);
    expect(r.historialInsuficiente).toBe(true);
    expect(r.componentes.every((c) => c.valor === null)).toBe(true);
  });

  it('siempre devuelve el desglose, tenga o no datos', () => {
    const r = calcularPuntajeConfianza(sinHistorial);

    expect(r.componentes).toHaveLength(3);
    for (const c of r.componentes) {
      // Explicable: cada componente dice algo comprensible aunque no puntue.
      expect(c.detalle.length).toBeGreaterThan(10);
      expect(c.etiqueta).toBeTruthy();
    }
  });

  it('premia el respaldo completo de los gastos', () => {
    const r = calcularPuntajeConfianza({
      ...sinHistorial,
      gastosAprobados: 20,
      gastosConRespaldoCompleto: 20,
    });

    expect(r.puntaje).toBeGreaterThan(90);
    expect(r.historialInsuficiente).toBe(false);
    expect(r.componentes.find((c) => c.codigo === 'cumplimiento_evidencias')?.valor).toBe(100);
  });

  it('penaliza los gastos sin respaldo', () => {
    const conRespaldo = calcularPuntajeConfianza({
      ...sinHistorial,
      gastosAprobados: 20,
      gastosConRespaldoCompleto: 20,
    });
    const sinRespaldo = calcularPuntajeConfianza({
      ...sinHistorial,
      gastosAprobados: 20,
      gastosConRespaldoCompleto: 4,
    });

    expect(sinRespaldo.puntaje).toBeLessThan(conRespaldo.puntaje);
    expect(sinRespaldo.puntaje).toBeLessThan(PUNTAJE_NEUTRO);
  });

  it('con poco historial el puntaje se mantiene cerca del neutro', () => {
    // Un solo gasto perfecto no convierte a nadie en la ONG mas confiable
    // del pais; dos mil casos si sostienen una afirmacion.
    const unCaso = calcularPuntajeConfianza({
      ...sinHistorial,
      gastosAprobados: 1,
      gastosConRespaldoCompleto: 1,
    });
    const muchos = calcularPuntajeConfianza({
      ...sinHistorial,
      gastosAprobados: 50,
      gastosConRespaldoCompleto: 50,
    });

    expect(unCaso.puntaje).toBeLessThan(muchos.puntaje);
    expect(unCaso.puntaje).toBeGreaterThan(PUNTAJE_NEUTRO);
    expect(unCaso.historialInsuficiente).toBe(true);
  });

  it('un solo mal caso tampoco hunde a nadie', () => {
    const r = calcularPuntajeConfianza({
      ...sinHistorial,
      gastosAprobados: 1,
      gastosConRespaldoCompleto: 0,
    });

    expect(r.puntaje).toBeLessThan(PUNTAJE_NEUTRO);
    // Pero no cae al piso por un unico episodio.
    expect(r.puntaje).toBeGreaterThan(20);
  });

  it('no evalua la resolucion de observaciones cuando nunca hubo ninguna', () => {
    const r = calcularPuntajeConfianza({
      ...sinHistorial,
      gastosAprobados: 10,
      gastosConRespaldoCompleto: 10,
    });

    const observaciones = r.componentes.find((c) => c.codigo === 'observaciones_resueltas');
    expect(observaciones?.valor).toBeNull();
    // Y por no tenerlas, no se la penaliza: el puntaje sigue alto.
    expect(r.puntaje).toBeGreaterThan(90);
  });

  it('considera resueltas solo las observaciones que ya afectan reputacion (RF-SO-04)', () => {
    // El servicio solo pasa aqui las alertas con afectaReputacion = true, es
    // decir las que ya vencieron su plazo de subsanacion. Una alerta abierta
    // dentro de plazo no llega a este calculo.
    const r = calcularPuntajeConfianza({
      ...sinHistorial,
      gastosAprobados: 10,
      gastosConRespaldoCompleto: 10,
      alertasQueAfectan: 4,
      alertasResueltas: 1,
      horasPromedioRespuesta: 60,
    });

    expect(r.componentes.find((c) => c.codigo === 'observaciones_resueltas')?.valor).toBe(25);
    expect(r.puntaje).toBeLessThan(80);
  });

  it('valora responder rapido y castiga la demora', () => {
    const base = {
      ...sinHistorial,
      gastosAprobados: 10,
      gastosConRespaldoCompleto: 10,
      alertasQueAfectan: 2,
      alertasResueltas: 2,
    };

    const rapida = calcularPuntajeConfianza({ ...base, horasPromedioRespuesta: 12 });
    const lenta = calcularPuntajeConfianza({ ...base, horasPromedioRespuesta: 300 });

    expect(rapida.componentes.find((c) => c.codigo === 'tiempo_respuesta')?.valor).toBe(100);
    expect(lenta.componentes.find((c) => c.codigo === 'tiempo_respuesta')?.valor).toBe(0);
    expect(rapida.puntaje).toBeGreaterThan(lenta.puntaje);
  });

  it('el puntaje nunca sale del rango 0 a 100', () => {
    const casos: SenalesPuntaje[] = [
      { ...sinHistorial, gastosAprobados: 1000, gastosConRespaldoCompleto: 1000 },
      {
        gastosAprobados: 1000,
        gastosConRespaldoCompleto: 0,
        alertasQueAfectan: 500,
        alertasResueltas: 0,
        horasPromedioRespuesta: 10_000,
      },
    ];

    for (const caso of casos) {
      const r = calcularPuntajeConfianza(caso);
      expect(r.puntaje).toBeGreaterThanOrEqual(0);
      expect(r.puntaje).toBeLessThanOrEqual(100);
    }
  });
});
