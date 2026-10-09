/**
 * Datos abiertos en IATI 2.03 (Fase 7 del plan transdisciplinario).
 *
 * La estructura se prueba aqui; la validez contra el esquema oficial, con
 * xmllint, cuando IATI_XSD apunta a iati-activities-schema.xsd (en CI no esta:
 * el esquema no se versiona en el repositorio). Ver la matriz de trazabilidad.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PrismaService } from '../../comun/prisma/prisma.service';
import {
  crearEscenarioContable,
  type EscenarioContable,
} from '../../comun/pruebas/escenario-contable';
import { cargarConfiguracion } from '../../config/configuracion';
import { LibroService } from '../contable/libro.service';
import { DatosAbiertosService } from './datos-abiertos.service';
import { documentoIati } from './iati';

let prisma: PrismaService;
let datos: DatosAbiertosService;
let e: EscenarioContable;
let xml: string;

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [PrismaService, LibroService, DatosAbiertosService],
  }).compile();
  prisma = modulo.get(PrismaService);
  datos = modulo.get(DatosAbiertosService);
  const libro = modulo.get(LibroService);
  await prisma.$connect();

  e = await crearEscenarioContable(prisma, 'iati');
  const primera = await e.donar(100, 4.44, new Date('2026-07-05T15:00:00Z'));
  await e.donar(50, 2.72, new Date('2026-07-20T15:00:00Z'));
  await e.donar(30, 2.03, new Date('2026-08-02T15:00:00Z'));
  const gasto = await e.gastoAprobado(80, new Date('2026-08-10T15:00:00Z'));
  await prisma.gasto.update({ where: { id: gasto }, data: { unidadesImpacto: 8 } });

  // La causa cerro y le devolvio a la primera donacion lo que no uso.
  await prisma.$transaction((tx) =>
    libro.asentarDevolucion(tx, {
      fondoId: e.fondoId,
      donacionId: primera,
      monto: new Prisma.Decimal(15.56),
      motivo: 'cierre de la causa',
    }),
  );
  await prisma.campana.update({ where: { id: e.campanaId }, data: { estado: 'CERRADA' } });
  await prisma.cierreCausa.create({
    data: {
      fondoId: e.fondoId,
      estado: 'RESUELTO',
      venceJustificacionEn: new Date('2026-09-01T05:00:00Z'),
      resueltoEn: new Date('2026-09-15T15:00:00Z'),
    },
  });

  xml = (await datos.iati(e.ongId)).xml;
}, 60_000);

afterAll(async () => {
  await e.limpiar();
  await prisma.$disconnect();
});

describe('RF-IN-06 · Exportacion IATI', () => {
  it('una actividad por campaña, identificada por el RUC de la ONG', () => {
    expect(xml.match(/<iati-activity /g)).toHaveLength(1);
    expect(xml).toContain(`<iati-identifier>PE-RUC-${e.ruc}-${e.campanaId}</iati-identifier>`);
    expect(xml).toContain(`<reporting-org ref="PE-RUC-${e.ruc}" type="22">`);
  });

  it('las donaciones van sumadas por mes, no una por una', () => {
    // Julio: 100 + 50; agosto: 30.
    expect(xml).toContain('<value currency="PEN" value-date="2026-07-20">150.00</value>');
    expect(xml).toContain('<value currency="PEN" value-date="2026-08-02">30.00</value>');
    expect(xml.match(/<transaction-type code="1"\/>/g)).toHaveLength(2);
  });

  it('cada gasto verificado es un gasto, y el remanente devuelto, un desembolso', () => {
    expect(xml).toContain('<transaction-type code="4"/><transaction-date iso-date="2026-08-10"/>');
    expect(xml).toContain('>80.00</value>');
    expect(xml).toContain('<transaction-type code="3"/>');
    expect(xml).toContain('>15.56</value>');
  });

  it('el resultado son las unidades de impacto declaradas', () => {
    expect(xml).toContain(
      '<indicator measure="1"><title><narrative>animales atendidos</narrative>',
    );
    expect(xml).toContain('<actual value="8"/>');
  });

  it('una campaña cerrada y resuelta figura como cerrada, con su fin real', () => {
    expect(xml).toContain('<activity-status code="4"/>');
    expect(xml).toContain('<activity-date type="4" iso-date="2026-09-15"/>');
  });

  it('no publica ningun dato del donante', () => {
    expect(xml).not.toContain('@prueba.pe');
    expect(xml).not.toContain('Donante De Prueba');
  });

  it('una ONG sin verificar no tiene datos abiertos', async () => {
    await prisma.ong.update({ where: { id: e.ongId }, data: { estadoVerificacion: 'PENDIENTE' } });
    await expect(datos.iati(e.ongId)).rejects.toThrow('No hay datos abiertos');
    await prisma.ong.update({ where: { id: e.ongId }, data: { estadoVerificacion: 'VERIFICADA' } });
  });

  it('escapa lo que podria romper el XML', () => {
    const doc = documentoIati({ ref: 'PE-RUC-1', nombre: 'A & B <S.A.>' }, [], new Date(0));
    expect(doc).toContain('<iati-activities version="2.03"');
    const conActividad = documentoIati(
      { ref: 'PE-RUC-1', nombre: 'A & B' },
      [
        {
          identificador: 'PE-RUC-1-x',
          titulo: 'Título "con" comillas',
          descripcion: 'x',
          estado: 2,
          inicio: '2026-01-01',
          fin: null,
          actualizada: new Date(0),
          transacciones: [],
          resultados: [],
        },
      ],
      new Date(0),
    );
    expect(conActividad).toContain('A &amp; B');
    expect(conActividad).toContain('Título &quot;con&quot; comillas');
  });

  const xsd = process.env.IATI_XSD;
  (xsd ? it : it.skip)('valida contra el esquema oficial IATI 2.03', () => {
    const archivo = join(mkdtempSync(join(tmpdir(), 'iati-')), 'actividades.xml');
    writeFileSync(archivo, xml);
    expect(() =>
      execFileSync('xmllint', ['--noout', '--schema', xsd!, archivo], { stdio: 'pipe' }),
    ).not.toThrow();
  });
});
