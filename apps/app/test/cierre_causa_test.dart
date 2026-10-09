// RF-CF-11 y RF-CF-12 · El saldo de una causa cerrada: el donante elige su
// destino, y la ONG ve en que va el cierre y descarga el informe.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/donante/saldos_cierre.dart';
import 'package:trazabilidad_radical/funciones/ong/pantalla_fondos.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';

Map<String, dynamic> _saldo({bool resuelto = false}) => {
      'id': 's1',
      'monto': '42.12',
      'fondo': 'Atención veterinaria',
      'campana': 'Rescate de invierno',
      'ong': 'Huellas del Ande',
      'puedeElegir': !resuelto,
      'venceEleccionEn': '2027-02-09T05:00:00.000Z',
      'destino': resuelto ? 'REASIGNACION' : null,
      'elegidoPor': resuelto ? 'DONANTE' : null,
      'fondoDestino': resuelto ? {'id': 'f2', 'nombre': 'Esterilización'} : null,
      'resueltoEn': resuelto ? '2027-02-10T09:00:00.000Z' : null,
      'informeId': resuelto ? 'i1' : null,
    };

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({this.resuelto = false, this.cierre});

  final bool resuelto;
  final Map<String, dynamic>? cierre;
  final envios = <String, Object?>{};
  final descargas = <String>[];

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      switch (ruta) {
        '/remanentes' => [_saldo(resuelto: resuelto)],
        '/remanentes/s1/destinos' => [
            {
              'id': 'f2',
              'nombre': 'Esterilización',
              'ong': 'Patitas Huánuco',
              'campana': 'Jornada 2027',
              'mismaCategoria': true,
            },
          ],
        '/ongs/mias/listado' => [
            {
              'id': 'ong-1',
              'razonSocial': 'Huellas del Ande',
              'ruc': '20601030579',
              'estadoVerificacion': 'VERIFICADA',
              'puntajeConfianza': '72.00',
              'cargo': 'ADMINISTRADOR',
            },
          ],
        '/ongs/ong-1/fondos' => [
            {
              'titulo': 'Rescate de invierno',
              'estado': 'CERRADA',
              'fondos': [
                {
                  'id': 'f1',
                  'nombre': 'Atención veterinaria',
                  'categoriaGasto': 'ATENCION_VETERINARIA',
                  'recaudado': '300.00',
                  'retenido': '137.68',
                  'ejecutado': '150.00',
                  'meta': '5000.00',
                  'avance': 6,
                  'cierreCausa': cierre,
                },
              ],
            },
          ],
        _ => const [],
      };

  @override
  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    envios[ruta] = cuerpo;
    return const {};
  }

  @override
  Future<List<int>> obtenerBytes(String ruta, {Map<String, dynamic>? consulta}) async {
    descargas.add(ruta);
    return const [0x25, 0x50, 0x44, 0x46];
  }
}

Future<_ClienteApiFalso> _montar(WidgetTester tester, _ClienteApiFalso cliente, Widget w) async {
  await tester.binding.setSurfaceSize(const Size(900, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
      child: MaterialApp(home: Scaffold(body: w)),
    ),
  );
  await tester.pumpAndSettle();
  return cliente;
}

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  testWidgets('el donante ve su saldo, cuanto es y hasta cuando elegir', (tester) async {
    await _montar(tester, _ClienteApiFalso(), const SaldosDeCausasCerradas());

    expect(find.text('Atención veterinaria cerró: le quedan S/ 42.12 sin usar'), findsOneWidget);
    expect(find.textContaining('Si no elige, se le devuelve.'), findsOneWidget);
  });

  testWidgets('trasladar exige elegir el fondo, y envia ambos', (tester) async {
    final cliente = await _montar(tester, _ClienteApiFalso(), const SaldosDeCausasCerradas());

    await tester.tap(find.text('Elegir'));
    await tester.pumpAndSettle();
    expect(find.textContaining('La comisión de la pasarela no se devuelve'), findsOneWidget);

    final confirmar = find.widgetWithText(FilledButton, 'Confirmar');
    expect(tester.widget<FilledButton>(confirmar).onPressed, isNull);

    await tester.tap(find.text('Pasarlo a otra causa'));
    await tester.pumpAndSettle();
    expect(tester.widget<FilledButton>(confirmar).onPressed, isNull);

    await tester.tap(find.text('Esterilización'));
    await tester.pumpAndSettle();
    await tester.tap(confirmar);
    await tester.pumpAndSettle();

    expect(cliente.envios['/remanentes/s1/eleccion'], {
      'destino': 'REASIGNACION',
      'fondoDestinoId': 'f2',
    });
  });

  testWidgets('la devolucion no pide fondo', (tester) async {
    final cliente = await _montar(tester, _ClienteApiFalso(), const SaldosDeCausasCerradas());

    await tester.tap(find.text('Elegir'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Que me lo devuelvan'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(FilledButton, 'Confirmar'));
    await tester.pumpAndSettle();

    expect(cliente.envios['/remanentes/s1/eleccion'], {'destino': 'DEVOLUCION'});
  });

  testWidgets('resuelto, dice a donde fue y ofrece el informe de cierre', (tester) async {
    final cliente = await _montar(
      tester,
      _ClienteApiFalso(resuelto: true),
      const SaldosDeCausasCerradas(),
    );

    expect(find.text('Pasó a Esterilización.'), findsOneWidget);
    expect(find.text('Elegir'), findsNothing);

    await tester.tap(find.text('Informe de cierre'));
    await tester.pumpAndSettle();
    expect(cliente.descargas, ['/publico/informes/i1/pdf']);
  });

  testWidgets('la ONG ve hasta cuando puede justificar un fondo cerrado', (tester) async {
    await _montar(
      tester,
      _ClienteApiFalso(
        cierre: {
          'estado': 'JUSTIFICANDO',
          'venceJustificacionEn': '2027-01-09T05:00:00.000Z',
          'informeId': null,
        },
      ),
      const PantallaFondos(),
    );

    expect(find.textContaining('Puede justificar lo retenido con gastos hasta el'), findsOneWidget);
    expect(find.text('Informe de cierre (PDF)'), findsNothing);
  });

  testWidgets('resuelta la causa, la ONG descarga su informe', (tester) async {
    final cliente = await _montar(
      tester,
      _ClienteApiFalso(cierre: {'estado': 'RESUELTO', 'informeId': 'i9'}),
      const PantallaFondos(),
    );

    await tester.tap(find.text('Informe de cierre (PDF)'));
    await tester.pumpAndSettle();
    expect(cliente.descargas, ['/publico/informes/i9/pdf']);
  });
}
