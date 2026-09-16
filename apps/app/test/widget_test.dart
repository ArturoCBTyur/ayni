import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trazabilidad_radical/funciones/salud/pantalla_salud.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';

/// Cliente falso: permite probar las pantallas sin levantar el backend.
class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({required this.respuesta, this.error});

  final Map<String, dynamic> respuesta;
  final Object? error;

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async {
    if (error != null) throw error!;
    return respuesta;
  }
}

Widget _envolver(ClienteApi cliente) => ProviderScope(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
      child: const MaterialApp(home: PantallaSalud()),
    );

void main() {
  testWidgets('muestra la version de la base de datos cuando el API responde', (tester) async {
    await tester.pumpWidget(
      _envolver(
        _ClienteApiFalso(
          respuesta: const {
            'estado': 'ok',
            'servicio': 'Trazabilidad Radical API',
            'version': '0.1.0-mvp-sin-ia',
            'motorVerificacion': 'reglas-v0',
            'baseDatos': {
              'conectada': true,
              'version': 'PostgreSQL 18.3',
              'tablas': 28,
              'latenciaMs': 7,
            },
          },
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Trazabilidad Radical API'), findsOneWidget);
    expect(find.text('PostgreSQL 18.3'), findsOneWidget);
    expect(find.text('reglas-v0'), findsOneWidget);
    expect(find.text('28'), findsOneWidget);
  });

  testWidgets('muestra un mensaje comprensible si el API no responde (RF-PS-05)',
      (tester) async {
    await tester.pumpWidget(
      _envolver(
        _ClienteApiFalso(
          respuesta: const {},
          error: const ErrorApi(
            mensaje: 'No se pudo contactar al servidor. Revise su conexion e intente de nuevo.',
          ),
        ),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('No pudimos conectarnos'), findsOneWidget);
    expect(find.textContaining('Revise su conexion'), findsOneWidget);
    expect(find.widgetWithText(FilledButton, 'Reintentar'), findsOneWidget);
  });
}
