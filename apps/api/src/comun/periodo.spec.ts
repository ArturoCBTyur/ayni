/**
 * Periodos en hora de Lima y JSON canonico: las dos piezas de las que depende
 * que un cierre mensual signifique siempre lo mismo.
 */
import { createHash } from 'node:crypto';
import { Prisma } from '@prisma/client';

import { jsonCanonico, sha256 } from './canonico';
import {
  anterior,
  esCodigoDePeriodo,
  fechaEnLima,
  nombreDelPeriodo,
  periodo,
  periodoDe,
  siguiente,
} from './periodo';

describe('Periodos en hora de Lima', () => {
  it('septiembre empieza el 1 a las 00:00 de Lima, que son las 05:00 UTC', () => {
    const p = periodo('2026-09');
    expect(p.desde.toISOString()).toBe('2026-09-01T05:00:00.000Z');
    expect(p.hasta.toISOString()).toBe('2026-10-01T05:00:00.000Z');
  });

  it('una donacion del 30 a las 21:00 de Lima es de septiembre, aunque en UTC ya sea octubre', () => {
    expect(periodoDe(new Date('2026-10-01T02:00:00Z')).codigo).toBe('2026-09');
    expect(periodoDe(new Date('2026-10-01T04:59:59.999Z')).codigo).toBe('2026-09');
    expect(periodoDe(new Date('2026-10-01T05:00:00Z')).codigo).toBe('2026-10');
  });

  it('pasa de diciembre a enero y vuelve', () => {
    expect(siguiente(periodo('2026-12')).codigo).toBe('2027-01');
    expect(anterior(periodo('2027-01')).codigo).toBe('2026-12');
    expect(siguiente(periodo('2026-09')).codigo).toBe('2026-10');
    expect(anterior(periodo('2026-09')).codigo).toBe('2026-08');
  });

  it('rechaza lo que no es AAAA-MM', () => {
    for (const malo of ['2026-13', '2026-00', '2026-9', '26-09', '2026/09', '']) {
      expect(esCodigoDePeriodo(malo)).toBe(false);
      expect(() => periodo(malo)).toThrow('no es un periodo');
    }
  });

  it('nombra el mes en español y da la fecha de Lima', () => {
    expect(nombreDelPeriodo(periodo('2026-09'))).toBe('septiembre de 2026');
    expect(fechaEnLima(new Date('2026-10-01T02:00:00Z'))).toBe('30/09/2026');
  });
});

describe('JSON canonico', () => {
  it('el orden de las claves no cambia el texto', () => {
    expect(jsonCanonico({ b: 1, a: { d: [3, { y: 1, x: 2 }], c: null } })).toBe(
      jsonCanonico({ a: { c: null, d: [3, { x: 2, y: 1 }] }, b: 1 }),
    );
    expect(jsonCanonico({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it('omite lo indefinido y usa el toJSON de fechas y decimales', () => {
    expect(
      jsonCanonico({
        z: undefined,
        f: new Date('2026-09-01T05:00:00Z'),
        m: new Prisma.Decimal('12.50'),
      }),
    ).toBe('{"f":"2026-09-01T05:00:00.000Z","m":"12.5"}');
  });

  it('el hash es el SHA-256 del texto en UTF-8, igual que digest() de pgcrypto', () => {
    const texto = jsonCanonico({ concepto: 'Atención veterinaria' });
    expect(sha256(texto)).toBe(
      createHash('sha256').update(Buffer.from(texto, 'utf8')).digest('hex'),
    );
  });
});
