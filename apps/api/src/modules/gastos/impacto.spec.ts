/**
 * Impacto social (Fase 5 del plan transdisciplinario, D4 sin firmar).
 *
 * El costo por unidad solo es honesto si se calcula sobre los gastos que
 * declararon unidades, y si dice cuantos fueron.
 */
import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';

import { BitacoraService } from '../../comun/bitacora/bitacora.service';
import { CifradoService } from '../../comun/cifrado/cifrado.service';
import { PrismaService } from '../../comun/prisma/prisma.service';
import {
  crearEscenarioContable,
  type EscenarioContable,
} from '../../comun/pruebas/escenario-contable';
import { cargarConfiguracion } from '../../config/configuracion';
import { CampanasService } from '../campanas/campanas.service';
import { AlmacenamientoDisco } from './almacenamiento/disco.storage';
import { calcularImpacto, unidadDe } from './impacto';
import { ALMACENAMIENTO } from './puertos/almacenamiento.port';

let prisma: PrismaService;
let campanas: CampanasService;
let e: EscenarioContable;

beforeAll(async () => {
  const modulo = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => cargarConfiguracion()] })],
    providers: [
      PrismaService,
      BitacoraService,
      CampanasService,
      CifradoService,
      AlmacenamientoDisco,
      { provide: ALMACENAMIENTO, useExisting: AlmacenamientoDisco },
    ],
  }).compile();
  prisma = modulo.get(PrismaService);
  campanas = modulo.get(CampanasService);
  await prisma.$connect();

  e = await crearEscenarioContable(prisma, 'impacto');
  await e.donar(300, 11.32);
  const conUnidades = await e.gastoAprobado(100);
  await e.gastoAprobado(50);
  await prisma.gasto.update({ where: { id: conUnidades }, data: { unidadesImpacto: 25 } });
}, 60_000);

afterAll(async () => {
  await e.limpiar();
  await prisma.$disconnect();
});

describe('RF-SO-09 · Costo por unidad de impacto', () => {
  it('divide lo ejecutado entre las unidades, solo de los gastos que las declararon', () => {
    const [alimentos, ...resto] = calcularImpacto([
      { categoria: 'ALIMENTOS', monto: '100.00', unidades: 40 },
      { categoria: 'ALIMENTOS', monto: '50.00', unidades: null },
      { categoria: 'INSUMOS', monto: '30.00', unidades: 5 },
    ]);

    expect(resto).toEqual([]);
    expect(alimentos).toEqual({
      categoria: 'ALIMENTOS',
      unidad: 'raciones entregadas',
      unidades: 40,
      gastosConUnidades: 1,
      gastosAprobados: 2,
      ejecutadoConUnidades: '100.00',
      costoPorUnidad: '2.50',
    });
  });

  it('sin unidades declaradas no inventa un costo', () => {
    const [fila] = calcularImpacto([
      { categoria: 'ESTERILIZACION', monto: '80.00', unidades: null },
    ]);
    expect(fila.costoPorUnidad).toBeNull();
    expect(fila.gastosAprobados).toBe(1);
  });

  it('un insumo no es un resultado: su categoria no tiene unidad', () => {
    expect(unidadDe('INSUMOS')).toBeNull();
    expect(unidadDe('OTROS')).toBeNull();
    expect(unidadDe('ATENCION_VETERINARIA')).toBe('animales atendidos');
  });

  it('la ficha publica de la causa lo muestra por fondo y por causa', async () => {
    const detalle = await campanas.detalleCampana(`impacto-${e.marca}`);
    const esperado = {
      categoria: 'ATENCION_VETERINARIA',
      unidad: 'animales atendidos',
      unidades: 25,
      gastosConUnidades: 1,
      gastosAprobados: 2,
      costoPorUnidad: '4.00',
    };

    expect(detalle.fondos[0].impacto).toMatchObject(esperado);
    expect(detalle.impacto).toEqual([expect.objectContaining(esperado)]);
  });
});
