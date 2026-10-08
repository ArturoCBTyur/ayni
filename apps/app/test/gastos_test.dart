// Pruebas de la lista de gastos de la ONG.
//
// El analisis corre en segundo plano y termina en segundos. Lo que se fija
// aqui es que la pantalla se entere sola: antes la tarjeta se quedaba en
// "En análisis" hasta recargar el navegador, y en la demo eso se leia como
// que el motor se habia colgado.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/ong/pantalla_gastos.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';

Map<String, dynamic> _gasto(String estado) => {
      'id': 'g1',
      'concepto': 'cirugía veterinaria de un perro atropellado',
      'proveedor': 'Clinica Veterinaria San Roque',
      'fondo': 'Atención veterinaria',
      'monto': '80.00',
      'estado': estado,
      'nivel': estado == 'EN_ANALISIS' ? null : 'MEDIO',
      'scoreFinal': estado == 'EN_ANALISIS' ? null : 72,
      'fechaGasto': '2026-10-07T00:00:00.000Z',
    };

/// Devuelve el gasto en analisis las primeras `consultasEnAnalisis` veces.
class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({required this.consultasEnAnalisis});

  final int consultasEnAnalisis;
  int consultasDeGastos = 0;

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async {
    if (ruta == '/ongs/mias/listado') {
      return [
        {'id': 'ong-1', 'nombre': 'Huellas del Ande'},
      ];
    }
    consultasDeGastos += 1;
    return [_gasto(consultasDeGastos <= consultasEnAnalisis ? 'EN_ANALISIS' : 'EN_REVISION')];
  }
}

Future<void> _montar(WidgetTester tester, _ClienteApiFalso cliente) async {
  await tester.binding.setSurfaceSize(const Size(1200, 1800));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    ProviderScope(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
      child: const MaterialApp(home: Scaffold(body: PantallaGastos())),
    ),
  );
  await tester.pump();
  await tester.pump();
}

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  testWidgets('un gasto en análisis se actualiza solo cuando el motor termina', (tester) async {
    final cliente = _ClienteApiFalso(consultasEnAnalisis: 1);
    await _montar(tester, cliente);

    expect(find.text('En análisis'), findsOneWidget);

    await tester.pump(const Duration(seconds: 5));
    await tester.pump();

    expect(find.text('En análisis'), findsNothing);
    expect(find.text('En revisión de auditoría'), findsOneWidget);
  });

  testWidgets('sin gastos pendientes no vuelve a consultar', (tester) async {
    final cliente = _ClienteApiFalso(consultasEnAnalisis: 0);
    await _montar(tester, cliente);
    final consultas = cliente.consultasDeGastos;

    await tester.pump(const Duration(seconds: 20));
    await tester.pump();

    expect(cliente.consultasDeGastos, consultas);
  });
}
