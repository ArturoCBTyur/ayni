// Herramientas del auditor: filtros de la bandeja, reasignar por conflicto
// de interes, descartar una alerta y el informe de una organizacion.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/auditor/pantalla_bandeja.dart';
import 'package:trazabilidad_radical/funciones/auditor/pantalla_informe_ong.dart';
import 'package:trazabilidad_radical/funciones/auditor/pantalla_revision.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';

Map<String, dynamic> _caso({bool conflicto = false}) => {
      'id': 'g1',
      'monto': '80.00',
      'concepto': 'cirugía de un perro atropellado',
      'proveedor': 'Clinica Veterinaria San Roque',
      'fechaGasto': '2026-10-06T00:00:00.000Z',
      'recibidoEn': '2026-10-06T15:00:00.000Z',
      'ong': {'id': 'ong-1', 'nombre': 'Huellas del Ande', 'puntajeConfianza': '72.00'},
      'campana': 'Rescate',
      'fondo': 'Atención veterinaria',
      'nivel': 'MEDIO',
      'scoreFinal': 61,
      'esMuestreo': false,
      'alertasAbiertas': 0,
      'sla': {'venceEn': '2026-10-08T15:00:00.000Z', 'horasTranscurridas': 3, 'vencido': false},
      'conflictoInteres': conflicto,
    };

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({this.conflicto = false});

  final bool conflicto;
  final consultas = <Map<String, dynamic>>[];
  final envios = <String, Object?>{};

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async {
    switch (ruta) {
      case '/auditoria/bandeja':
        consultas.add({...?consulta});
        return {
          'total': 1,
          'casos': [_caso(conflicto: conflicto)],
        };
      case '/gastos/g1':
        return {
          'id': 'g1',
          'estado': 'EN_REVISION',
          'monto': '80.00',
          'concepto': 'cirugía de un perro atropellado',
          'proveedor': 'Clinica Veterinaria San Roque',
          'fechaGasto': '2026-10-06T00:00:00.000Z',
          'fondo': {'id': 'f1', 'nombre': 'Atención veterinaria'},
          'campana': 'Rescate',
          'ongId': 'ong-1',
          'comprobante': null,
          'evidencias': const [],
          'analisis': null,
          'alertasAbiertas': 1,
          'alertas': [
            {
              'id': 'a1',
              'titulo': 'Proveedor nuevo',
              'descripcion': 'Primer gasto con este proveedor.',
              'severidad': 'MEDIA',
              'estado': 'ABIERTA',
              'plazoSubsanacion': null,
            },
          ],
        };
      case '/analitica/informe/ong-1':
        return {
          'generadoEn': '2026-10-07T20:00:00.000Z',
          'organizacion': {
            'id': 'ong-1',
            'razonSocial': 'Asociacion Huellas del Ande',
            'ruc': '20601030579',
            'estadoVerificacion': 'VERIFICADA',
            'verificadaPor': 'Carlos Mendoza',
            'puntajeConfianza': '72.00',
          },
          'fondos': [
            {
              'id': 'f1',
              'campana': 'Rescate',
              'nombre': 'Atención veterinaria',
              'meta': '1000.00',
              'recaudado': '300.00',
              'retenido': '200.00',
              'ejecutado': '100.00',
              'cadenaIntegra': true,
              'movimientos': 12,
            },
          ],
          'gastos': [
            {'estado': 'APROBADO', 'cantidad': 3, 'monto': '100.00'},
          ],
          'alertas': {'RESUELTA': 1},
          'decisionesDeAuditoria': const [],
        };
    }
    return const {};
  }

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      ruta == '/auditoria/auditores'
          ? [
              {'id': 'aud-2', 'nombre': 'Carla Rojas'},
            ]
          : const [];

  @override
  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    envios[ruta] = cuerpo;
    return const {};
  }
}

Future<_ClienteApiFalso> _montar(
  WidgetTester tester,
  Widget pantalla, {
  bool conflicto = false,
}) async {
  await tester.binding.setSurfaceSize(const Size(1200, 1800));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  final cliente = _ClienteApiFalso(conflicto: conflicto);
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

  testWidgets('los filtros de la bandeja viajan en la consulta', (tester) async {
    final cliente = await _montar(tester, const PantallaBandeja());

    await tester.tap(find.widgetWithText(ChoiceChip, 'Bajo'));
    await tester.pumpAndSettle();
    expect(cliente.consultas.last['nivel'], 'BAJO');

    await tester.tap(find.widgetWithText(FilterChip, 'Incluir muestreo'));
    await tester.pumpAndSettle();
    expect(cliente.consultas.last['incluirMuestreo'], 'false');

    await tester.tap(find.text('Solo Huellas del Ande'));
    await tester.pumpAndSettle();
    expect(cliente.consultas.last['ongId'], 'ong-1');
  });

  testWidgets('un caso con conflicto se reasigna a un auditor sin vínculo', (tester) async {
    final cliente = await _montar(tester, const PantallaBandeja(), conflicto: true);

    await tester.tap(find.text('Reasignar'));
    await tester.pumpAndSettle();
    await tester.tap(find.byType(DropdownButtonFormField<String>));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Carla Rojas').last);
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Motivo'), 'Soy socio del representante.');
    await tester.tap(find.widgetWithText(FilledButton, 'Reasignar'));
    await tester.pumpAndSettle();

    expect(cliente.envios['/auditoria/gastos/g1/reasignar'], {
      'auditorDestinoId': 'aud-2',
      'motivo': 'Soy socio del representante.',
    });
  });

  testWidgets('descartar una alerta pide el motivo', (tester) async {
    final cliente = await _montar(tester, const PantallaRevision(gastoId: 'g1'));

    expect(find.text('Proveedor nuevo'), findsOneWidget);
    await tester.tap(find.text('Descartar'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Descartar'));
    await tester.pumpAndSettle();
    expect(find.text('Escriba al menos 10 caracteres.'), findsOneWidget);

    await tester.enterText(find.byType(TextField).last, 'El proveedor es habitual de la ONG.');
    await tester.tap(find.widgetWithText(FilledButton, 'Descartar'));
    await tester.pumpAndSettle();
    expect(cliente.envios['/alertas/a1/descartar'], {'nota': 'El proveedor es habitual de la ONG.'});
  });

  testWidgets('el informe empieza por la integridad del libro', (tester) async {
    await _montar(tester, const PantallaInformeOng(ongId: 'ong-1'));

    expect(find.text('La cadena de hashes de los 1 fondo(s) está íntegra.'), findsOneWidget);
    expect(find.byTooltip('Exportar el libro del fondo en CSV'), findsOneWidget);
  });
}
