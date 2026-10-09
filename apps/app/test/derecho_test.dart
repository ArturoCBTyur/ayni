// RF-DE-07 y RF-DE-08 · La constancia de donacion, el saldo de una causa
// cerrada en el detalle del aporte, la calificacion SUNAT que registra la
// auditoria y el informe de cumplimiento del administrador.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/auditor/pantalla_informe_ong.dart';
import 'package:trazabilidad_radical/funciones/cumplimiento/pantalla_arco_bandeja.dart';
import 'package:trazabilidad_radical/funciones/donante/pantalla_detalle_aporte.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';

class _ClienteApiFalso extends ClienteApi {
  final descargas = <({String ruta, Map<String, dynamic>? consulta})>[];
  final actualizaciones = <String, Object?>{};

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async =>
      switch (ruta) {
        '/donaciones/d1' => {
            'id': 'd1',
            'fecha': '2026-06-15T15:00:00.000Z',
            'monto': '100.00',
            'comision': '4.44',
            'montoNeto': '95.56',
            'montoAplicado': '0.00',
            'montoEsperandoEvidencia': '0.00',
            'estado': {'etiqueta': 'Devuelto', 'descripcion': 'La causa cerró.'},
            'fondo': {'id': 'f1', 'nombre': 'Atención veterinaria'},
            'campana': {'titulo': 'Rescate', 'slug': 'rescate'},
            'ong': 'Huellas del Ande',
            'saldoDeCierre': {
              'monto': '95.56',
              'destino': 'DEVOLUCION',
              'resuelto': true,
              'fondoDestino': null,
            },
            'trasladadoDesde': null,
            'aplicaciones': const [],
          },
        '/analitica/informe/ong-1' => {
            'generadoEn': '2026-10-07T20:00:00.000Z',
            'organizacion': {
              'id': 'ong-1',
              'razonSocial': 'Asociacion Huellas del Ande',
              'ruc': '20601030579',
              'estadoVerificacion': 'VERIFICADA',
              'verificadaPor': 'Carlos Mendoza',
              'puntajeConfianza': '72.00',
              'perceptoraDonaciones': false,
            },
            'fondos': const [],
            'gastos': const [],
            'alertas': const <String, dynamic>{},
            'decisionesDeAuditoria': const [],
          },
        _ => const {},
      };

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      const [];

  @override
  Future<Map<String, dynamic>> actualizar(String ruta, {Object? cuerpo}) async {
    actualizaciones[ruta] = cuerpo;
    return const {};
  }

  @override
  Future<List<int>> obtenerBytes(String ruta, {Map<String, dynamic>? consulta}) async {
    descargas.add((ruta: ruta, consulta: consulta));
    return const [0x25];
  }
}

Future<_ClienteApiFalso> _montar(WidgetTester tester, Widget pantalla) async {
  await tester.binding.setSurfaceSize(const Size(1000, 1600));
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

  testWidgets('el aporte dice que su saldo se devolvio y ofrece la constancia', (tester) async {
    final cliente = await _montar(tester, const PantallaDetalleAporte(donacionId: 'd1'));

    expect(find.text('S/ 95.56 se le devolvieron'), findsOneWidget);

    await tester.tap(find.text('Constancia de donación (PDF)'));
    await tester.pumpAndSettle();
    expect(cliente.descargas.single.ruta, '/donaciones/d1/constancia');
  });

  testWidgets('el administrador descarga el informe de cumplimiento del año', (tester) async {
    final cliente = await _montar(tester, const PantallaArcoBandeja());

    await tester.tap(find.byTooltip('Informe de cumplimiento de la Ley 29733'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Informe del año en Excel'));
    await tester.pumpAndSettle();

    final pedido = cliente.descargas.single;
    expect(pedido.ruta, '/cumplimiento/informe');
    expect(pedido.consulta?['desde'], '${DateTime.now().year}-01-01');
    expect(pedido.consulta?['formato'], 'xlsx');
  });

  testWidgets('la auditoria registra la calificacion SUNAT con su motivo', (tester) async {
    final cliente = await _montar(tester, const PantallaInformeOng(ongId: 'ong-1'));

    expect(find.text('Sin calificación registrada como perceptora de donaciones.'), findsOneWidget);

    await tester.tap(find.text('Calificación SUNAT'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Calificada como perceptora de donaciones'));
    await tester.pumpAndSettle();
    await tester.enterText(
      find.widgetWithText(TextField, 'Resolución o constancia'),
      'R.I. 0230050012345',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'Vigente desde (AAAA-MM-DD)'),
      '2026-01-01',
    );
    await tester.enterText(
      find.widgetWithText(TextField, 'De dónde sale el dato'),
      'Constancia de inscripción de SUNAT en el expediente.',
    );
    await tester.tap(find.text('Guardar'));
    await tester.pumpAndSettle();

    expect(cliente.actualizaciones['/ongs/ong-1/perceptora'], {
      'perceptora': true,
      'resolucion': 'R.I. 0230050012345',
      'desde': '2026-01-01',
      'motivo': 'Constancia de inscripción de SUNAT en el expediente.',
    });
  });
}
