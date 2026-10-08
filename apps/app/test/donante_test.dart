// Lo que el donante podia hacer en la API y no en la aplicacion: donar cada
// mes, pausar o cancelar esa donacion, ver en que gastos se uso cada aporte
// y recibir sugerencias con su motivo.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/donante/hoja_donar.dart';
import 'package:trazabilidad_radical/funciones/donante/pantalla_historial.dart';
import 'package:trazabilidad_radical/funciones/inicio/pantalla_inicio.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';

const _donacion = <String, dynamic>{
  'id': 'd1',
  'fecha': '2026-10-01T15:00:00.000Z',
  'monto': '100.00',
  'montoNeto': '96.20',
  'comision': '3.80',
  'anonima': false,
  'fondo': {'id': 'f1', 'nombre': 'Atención veterinaria'},
  'campana': {'titulo': 'Rescate de invierno', 'slug': 'rescate'},
  'ong': 'Huellas del Ande',
  'estado': {
    'codigo': 'PARCIAL',
    'etiqueta': 'Parcialmente ejecutado',
    'descripcion': 'Una parte ya financió un gasto verificado.',
  },
  'montoAplicado': '78.00',
  'montoEsperandoEvidencia': '18.20',
  'gastosFinanciados': 1,
};

final _detalle = <String, dynamic>{
  ..._donacion,
  'aplicaciones': [
    {
      'monto': '78.00',
      'aplicadoEn': '2026-10-06T15:00:00.000Z',
      'gasto': {
        'id': 'g1',
        'concepto': 'atención veterinaria de urgencia',
        'proveedor': 'Clinica Veterinaria San Roque',
        'fechaGasto': '2026-10-06T00:00:00.000Z',
        'estado': 'APROBADO',
        'total': '118.00',
        'comprobante': 'BOLETA B001-004521',
        'evidencias': ['/api/v1/almacenamiento/evidencias/e1.jpg?token=abc'],
      },
    },
  ],
};

class _ClienteApiFalso extends ClienteApi {
  final envios = <String, Object?>{};
  final actualizaciones = <String, Object?>{};

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async =>
      switch (ruta) {
        '/donaciones/historial' => {
            'total': 1,
            'donaciones': [_donacion],
          },
        '/donaciones/d1' => _detalle,
        '/analitica/panel' => {
            'donante': {
              'aportes': 1,
              'aportado': '96.20',
              'ejecutado': '78.00',
              'esperandoEvidencia': '18.20',
              'impactosSinLeer': 0,
              'ultimoImpacto': null,
            },
          },
        _ => const {},
      };

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      switch (ruta) {
        '/suscripciones' => [
            {
              'id': 's1',
              'monto': '30.00',
              'estado': 'ACTIVA',
              'diaCobro': 5,
              'proximoCobroEn': '2026-11-05T14:00:00.000Z',
              'fondo': {'id': 'f1', 'nombre': 'Atención veterinaria'},
              'campana': 'Rescate de invierno',
            },
          ],
        '/recomendaciones' => [
            {
              'id': 'f9',
              'nombre': 'Esterilización',
              'categoriaGasto': 'ESTERILIZACION',
              'meta': '2000.00',
              'recaudado': '400.00',
              'campana': {'titulo': 'Esterilización comunitaria', 'slug': 'esterilizacion'},
              'ong': 'Huellas del Ande',
              'motivo': 'Ya apoyaste causas de Bienestar animal.',
            },
          ],
        _ => const [],
      };

  @override
  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    envios[ruta] = cuerpo;
    return ruta == '/suscripciones'
        ? {
            'id': 's2',
            'monto': '25.00',
            'diaCobro': 10,
            'proximoCobroEn': '2026-11-10T14:00:00.000Z',
            'estado': 'ACTIVA',
          }
        : {
            'donacionId': 'd2',
            'estado': 'PENDIENTE',
            'monto': '25.00',
            'comisionEstimada': '1.20',
            'montoNetoEstimado': '23.80',
            'mensaje': 'Estamos confirmando su pago.',
          };
  }

  @override
  Future<Map<String, dynamic>> actualizar(String ruta, {Object? cuerpo}) async {
    actualizaciones[ruta] = cuerpo;
    return const {};
  }
}

Future<_ClienteApiFalso> _montar(WidgetTester tester, Widget pantalla) async {
  await tester.binding.setSurfaceSize(const Size(1200, 2000));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  final cliente = _ClienteApiFalso();
  await tester.pumpWidget(
    ProviderScope(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
      child: MaterialApp(home: Scaffold(body: pantalla)),
    ),
  );
  await tester.pumpAndSettle();
  return cliente;
}

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  group('donar', () {
    testWidgets('una vez va a /donaciones', (tester) async {
      final cliente = await _montar(
        tester,
        const HojaDonar(fondoId: 'f1', nombreFondo: 'Atención veterinaria'),
      );

      await tester.enterText(find.byType(TextFormField), '25');
      await tester.tap(find.text('Confirmar donación'));
      await tester.pumpAndSettle();

      expect(cliente.envios.keys, ['/donaciones']);
    });

    testWidgets('cada mes crea una suscripción con su día de cobro', (tester) async {
      final cliente = await _montar(
        tester,
        const HojaDonar(fondoId: 'f1', nombreFondo: 'Atención veterinaria'),
      );

      await tester.tap(find.text('Cada mes'));
      await tester.pumpAndSettle();
      await tester.enterText(find.byType(TextFormField), '25');
      await tester.tap(find.text('Donar cada mes'));
      await tester.pumpAndSettle();

      final cuerpo = cliente.envios['/suscripciones']! as Map<String, dynamic>;
      expect(cuerpo['fondoId'], 'f1');
      expect(cuerpo['monto'], 25.0);
      expect(cuerpo['diaCobro'], inInclusiveRange(1, 28));
      expect(find.text('Donación mensual creada'), findsOneWidget);
    });
  });

  testWidgets('las donaciones mensuales se pausan en un toque', (tester) async {
    final cliente = await _montar(tester, const PantallaHistorial());

    expect(find.text('Donaciones mensuales'), findsOneWidget);
    await tester.tap(find.text('Pausar'));
    await tester.pumpAndSettle();

    expect(cliente.actualizaciones['/suscripciones/s1'], {'accion': 'PAUSAR'});
  });

  testWidgets('un aporte se abre y dice en qué gasto se usó', (tester) async {
    await _montar(tester, const PantallaHistorial());

    await tester.tap(find.text('Ver en qué gasto se usó'));
    await tester.pumpAndSettle();

    expect(find.text('En qué se usó'), findsOneWidget);
    expect(find.text('atención veterinaria de urgencia'), findsOneWidget);
    expect(find.text('De su aporte: S/ 78.00'), findsOneWidget);
    expect(find.textContaining('BOLETA B001-004521'), findsOneWidget);
  });

  testWidgets('el inicio del donante sugiere fondos con su motivo', (tester) async {
    await _montar(tester, const PantallaInicio());

    expect(find.text('Le puede interesar'), findsOneWidget);
    expect(find.textContaining('Ya apoyaste causas de Bienestar animal.'), findsOneWidget);
  });
}
