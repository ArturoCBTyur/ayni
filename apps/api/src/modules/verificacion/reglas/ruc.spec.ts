import { calcularDigitoVerificadorRuc, validarRuc, validarSerieNumero } from './ruc';

describe('validarRuc', () => {
  it('acepta RUC reales cuyo digito verificador cuadra', () => {
    // 20131312955 es el RUC de la SUNAT; los otros dos se verificaron
    // calculando el modulo 11 a mano.
    for (const ruc of ['20131312955', '10426218408', '20601030579']) {
      const r = validarRuc(ruc);
      expect(r.valido).toBe(true);
      expect(r.tipoContribuyente).toBeDefined();
    }
  });

  it('rechaza un RUC con el digito verificador equivocado', () => {
    const r = validarRuc('20131312956');
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain('digito verificador');
    // Aun asi identifica el tipo: el mensaje ayuda a corregir, no solo niega.
    expect(r.tipoContribuyente).toBe('Persona juridica');
  });

  it('rechaza un tipo de contribuyente inexistente', () => {
    const r = validarRuc('99131312955');
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain('tipo de');
  });

  it.each([
    ['vacio', ''],
    ['nulo', null],
    ['con menos digitos', '2013131295'],
    ['con mas digitos', '201313129551'],
    ['con letras', '2013131295A'],
    ['con guiones', '20-13131295'],
  ])('rechaza un RUC %s', (_caso, valor) => {
    expect(validarRuc(valor).valido).toBe(false);
  });

  it('nunca lanza excepcion: siempre devuelve un motivo legible', () => {
    for (const valor of ['', '   ', 'abc', '0'.repeat(11), undefined, null]) {
      const r = validarRuc(valor);
      if (!r.valido) expect(r.motivo).toBeTruthy();
    }
  });
});

describe('calcularDigitoVerificadorRuc', () => {
  it('reproduce el digito de un RUC conocido', () => {
    expect(calcularDigitoVerificadorRuc('2013131295')).toBe(5);
  });

  it('genera RUC validos para cualquier base de 10 digitos', () => {
    // Propiedad: lo que genera el calculo siempre pasa la validacion.
    // Es lo que permite al seed fabricar proveedores ficticios creibles.
    for (const base of ['2010007097', '1042621840', '2060103057', '1500000000']) {
      const completo = base + String(calcularDigitoVerificadorRuc(base));
      expect(validarRuc(completo).valido).toBe(true);
    }
  });

  it('exige exactamente 10 digitos', () => {
    expect(() => calcularDigitoVerificadorRuc('123')).toThrow();
    expect(() => calcularDigitoVerificadorRuc('12345678901')).toThrow();
  });
});

describe('validarSerieNumero', () => {
  it('acepta serie electronica coherente con el tipo', () => {
    expect(validarSerieNumero('FACTURA', 'F001', '00001234')).toEqual({
      valido: true,
      electronico: true,
    });
    expect(validarSerieNumero('BOLETA', 'B012', '55')).toEqual({
      valido: true,
      electronico: true,
    });
  });

  it('detecta una serie electronica que no corresponde al tipo', () => {
    const r = validarSerieNumero('FACTURA', 'B001', '00001234');
    expect(r.valido).toBe(false);
    expect(r.motivo).toContain('empieza con');
  });

  it('acepta serie fisica numerica', () => {
    expect(validarSerieNumero('BOLETA', '001', '1234').valido).toBe(true);
    expect(validarSerieNumero('FACTURA', '0001', '1234').valido).toBe(true);
  });

  it('rechaza numero no numerico y serie con formato desconocido', () => {
    expect(validarSerieNumero('FACTURA', 'F001', '12A4').valido).toBe(false);
    expect(validarSerieNumero('FACTURA', 'FF', '1234').valido).toBe(false);
  });
});
