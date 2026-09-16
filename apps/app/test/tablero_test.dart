// Pruebas del tablero de indicadores (CU20).
//
// Lo que se comprueba aqui no es que la pantalla dibuje: es que diga la
// verdad. Que el descuadre se vea con su monto, que un indicador sin medicion
// muestre por que, y que las cifras del grafico existan tambien como texto,
// porque el lienzo de Flutter Web no las expone al lector de pantalla.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/admin/pantalla_tablero.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';
import 'package:trazabilidad_radical/nucleo/sesion.dart';

/// Cliente falso que responde segun la ruta: el tablero consulta dos.
class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso(this.porRuta);

  final Map<String, Map<String, dynamic>> porRuta;

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async {
    final respuesta = porRuta[ruta];
    if (respuesta == null) throw StateError('Ruta no simulada en la prueba: $ruta');
    return respuesta;
  }
}

class _SesionAdmin extends SesionNotifier {
  @override
  EstadoSesion build() => const EstadoSesion(
        usuario: UsuarioSesion(
          id: 'u1',
          correo: 'admin@prueba.pe',
          nombres: 'Ana',
          apellidos: 'Admin',
          roles: ['ADMIN'],
        ),
      );
}

const _tablero = <String, dynamic>{
  'resumen': {
    'ongsVerificadas': 1,
    'campanasActivas': 2,
    'donantes': 3,
    'donaciones': {'cantidad': 3, 'total': '450.00'},
    'gastos': {'APROBADO': 1, 'EN_ANALISIS': 2},
    'narrativasEnviadas': 4,
  },
  'indicadores': [
    {
      'codigo': 'CYF-1',
      'disciplina': 'Contabilidad y Finanzas',
      'nombre': 'Soles ejecutados vinculados a comprobante y evidencia',
      'meta': '100 %',
      'valor': 100,
      'unidad': '%',
      'cumple': true,
    },
    {
      'codigo': 'PSI-1',
      'disciplina': 'Psicologia y UX',
      'nombre': 'Usabilidad percibida (System Usability Scale)',
      'meta': 'SUS >= 75',
      'valor': null,
      'unidad': 'SUS',
      'noMedible': 'Requiere una prueba de usabilidad con usuarios reales.',
    },
  ],
  'medidos': 1,
  'total': 2,
};

Map<String, dynamic> _conciliacion({
  required bool cuadra,
  List<Map<String, dynamic>> descuadres = const [],
  int rotas = 0,
}) =>
    <String, dynamic>{
      'fecha': '2026-09-16T15:00:00.000Z',
      'cuadra': cuadra,
      'totales': {
        'pagosAprobados': '450.00',
        'ingresosLibro': '450.00',
        'comisiones': '19.00',
        'retenido': '300.00',
        'ejecutado': '131.00',
        'aplicadoADonaciones': '131.00',
      },
      'descuadres': descuadres,
      'cadenas': {'fondos': 4, 'rotas': rotas, 'fondosRotos': <String>[]},
      'duracionMs': 12,
    };

Widget _envolver(Map<String, dynamic> conciliacion) => ProviderScope(
      overrides: [
        clienteApiProvider.overrideWithValue(
          _ClienteApiFalso({
            '/analitica/tablero': _tablero,
            '/analitica/conciliacion': conciliacion,
          }),
        ),
        sesionProvider.overrideWith(_SesionAdmin.new),
      ],
      child: const MaterialApp(home: Scaffold(body: PantallaTablero())),
    );

void main() {
  // Las fechas del tablero usan es_PE; sin esto DateFormat no tiene datos.
  setUpAll(() async => initializeDateFormatting(Config.locale));

  testWidgets('con el libro cuadrando lo dice sin ambiguedad', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_envolver(_conciliacion(cuadra: true)));
    await tester.pumpAndSettle();

    expect(find.text('El libro contable cuadra'), findsOneWidget);
    expect(find.text('4 de 4'), findsOneWidget); // cadenas integras
  });

  testWidgets('un descuadre se muestra con su descripcion y su monto', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      _envolver(
        _conciliacion(
          cuadra: false,
          rotas: 1,
          descuadres: [
            {
              'comprobacion': 'ingresos_vs_pagos',
              'severidad': 'CRITICO',
              'descripcion': 'Los pagos aprobados no coinciden con los ingresos del libro.',
              'esperado': '450.00',
              'encontrado': '430.00',
              'diferencia': '20.00',
            },
          ],
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('El libro contable no cuadra'), findsOneWidget);
    expect(
      find.text('Los pagos aprobados no coinciden con los ingresos del libro.'),
      findsOneWidget,
    );
    // El monto de la diferencia es lo primero que un auditor necesita.
    expect(find.text('Diferencia: S/ 20.00'), findsOneWidget);
    expect(find.text('3 de 4'), findsOneWidget); // una cadena rota
  });

  testWidgets('un indicador sin medicion muestra el motivo, no un hueco', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_envolver(_conciliacion(cuadra: true)));
    await tester.pumpAndSettle();

    expect(find.text('Sin medir'), findsOneWidget);
    expect(
      find.text('Requiere una prueba de usabilidad con usuarios reales.'),
      findsOneWidget,
    );
    // Y se declara cuantos de cuantos se pueden medir, en lugar de mostrar
    // solo los que si y dar la impresion de que eso era todo.
    expect(
      find.textContaining('1 de 2 se pueden medir'),
      findsOneWidget,
    );
  });

  testWidgets('las cifras del grafico existen tambien como texto (RNF-15)', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2600));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(_envolver(_conciliacion(cuadra: true)));
    await tester.pumpAndSettle();

    // Un lector de pantalla no puede leer el lienzo del grafico, asi que el
    // monto retenido y el ejecutado tienen que estar en texto.
    expect(find.text('S/ 300.00'), findsOneWidget);
    expect(find.text('S/ 131.00'), findsOneWidget);
    expect(find.text('Retenido'), findsWidgets);
    expect(find.text('Ejecutado'), findsWidgets);
  });
}
