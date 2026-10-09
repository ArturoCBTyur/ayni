// RF-IN-06 · La ficha publica de una ONG verificada ofrece sus datos
// abiertos en IATI, y dice si es perceptora de donaciones (RF-DE-07).
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/donante/pantalla_ong.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({required this.verificada});

  final bool verificada;
  final descargas = <String>[];

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async => {
        'id': 'ong-1',
        'ruc': '20601030579',
        'razonSocial': 'Asociacion Huellas del Ande',
        'nombreComercial': 'Huellas del Ande',
        'departamento': 'Huánuco',
        'verificada': verificada,
        'verificadaEn': '2026-09-01T00:00:00.000Z',
        'perceptoraDonaciones': verificada,
        'confianza': null,
        'campanas': const [],
      };

  @override
  Future<List<int>> obtenerBytes(String ruta, {Map<String, dynamic>? consulta}) async {
    descargas.add(ruta);
    return const [0x3c];
  }
}

Future<_ClienteApiFalso> _montar(WidgetTester tester, {required bool verificada}) async {
  final cliente = _ClienteApiFalso(verificada: verificada);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
      child: const MaterialApp(home: PantallaOng(ongId: 'ong-1')),
    ),
  );
  await tester.pumpAndSettle();
  return cliente;
}

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  testWidgets('una ONG verificada ofrece sus datos abiertos en IATI', (tester) async {
    final cliente = await _montar(tester, verificada: true);

    expect(find.text('Perceptora de donaciones (SUNAT)'), findsOneWidget);
    await tester.tap(find.text('Datos abiertos (IATI)'));
    await tester.pumpAndSettle();
    expect(cliente.descargas, ['/publico/iati/ongs/ong-1']);
  });

  testWidgets('una sin verificar no tiene datos abiertos que ofrecer', (tester) async {
    await _montar(tester, verificada: false);
    expect(find.text('Datos abiertos (IATI)'), findsNothing);
  });
}
