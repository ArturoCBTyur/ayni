// Pruebas de las pantallas de privacidad y derechos ARCO (CU21, RF-DE-01,
// RF-DE-02).
//
// Lo que se comprueba es lo que la ley vuelve importante: que un permiso no
// otorgado se vea igual que uno otorgado, que revocar el permiso esencial
// avise antes de dejar la cuenta sin acceso, y que un plazo vencido se diga
// con todas sus letras en vez de esconderse en una fecha.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/cumplimiento/pantalla_arco_bandeja.dart';
import 'package:trazabilidad_radical/funciones/cumplimiento/pantalla_privacidad.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({this.listas = const {}});

  final Map<String, List<Map<String, dynamic>>> listas;

  /// Lo que la pantalla envio, para comprobar que no llamo al API cuando no
  /// debia.
  final List<({String ruta, Object? cuerpo})> enviados = [];

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async {
    final r = listas[ruta];
    if (r == null) throw StateError('Ruta no simulada: $ruta');
    return r;
  }

  /// Ninguna prueba abre la exportacion; se responde vacio para que un
  /// descuido no termine en una llamada de red real.
  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async =>
      <String, dynamic>{};

  @override
  Future<Map<String, dynamic>> actualizar(String ruta, {Object? cuerpo}) async {
    enviados.add((ruta: ruta, cuerpo: cuerpo));
    return <String, dynamic>{};
  }
}

String _enDias(int dias) => DateTime.now().add(Duration(days: dias)).toIso8601String();

Widget _envolver(ClienteApi cliente, Widget pantalla) => ProviderScope(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
      child: MaterialApp(home: pantalla),
    );

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  group('Mis datos y privacidad', () {
    _ClienteApiFalso clienteCon({
      List<Map<String, dynamic>> consentimientos = const [],
      List<Map<String, dynamic>> solicitudes = const [],
    }) =>
        _ClienteApiFalso(
          listas: {
            '/cumplimiento/consentimientos': consentimientos,
            '/cumplimiento/arco': solicitudes,
          },
        );

    testWidgets('lista las cuatro finalidades aunque solo una este otorgada', (tester) async {
      await tester.binding.setSurfaceSize(const Size(900, 1800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        _envolver(
          clienteCon(
            consentimientos: [
              {
                'finalidad': 'TRATAMIENTO_DATOS',
                'otorgado': true,
                'versionPolitica': '1.0',
                'otorgadoEn': '2026-01-15T10:00:00.000Z',
              },
            ],
          ),
          const PantallaPrivacidad(),
        ),
      );
      await tester.pumpAndSettle();

      // Ocultar un permiso no otorgado seria ocultar que existe.
      expect(find.text('Tratamiento de mis datos'), findsOneWidget);
      expect(find.text('Comunicaciones sobre mis aportes'), findsOneWidget);
      expect(find.text('Uso de mi nombre en agradecimientos'), findsOneWidget);
      expect(find.text('Uso de mis respuestas en encuestas'), findsOneWidget);

      final interruptores = tester.widgetList<SwitchListTile>(find.byType(SwitchListTile));
      expect(interruptores.map((s) => s.value).toList(), [true, false, false, false]);
    });

    testWidgets('revocar el permiso esencial pide confirmacion antes de llamar al API',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(900, 1800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      final cliente = clienteCon(
        consentimientos: [
          {
            'finalidad': 'TRATAMIENTO_DATOS',
            'otorgado': true,
            'versionPolitica': '1.0',
            'otorgadoEn': '2026-01-15T10:00:00.000Z',
          },
        ],
      );

      await tester.pumpWidget(_envolver(cliente, const PantallaPrivacidad()));
      await tester.pumpAndSettle();

      await tester.tap(find.byType(SwitchListTile).first);
      await tester.pumpAndSettle();

      expect(find.text('¿Revocar este permiso?'), findsOneWidget);
      expect(cliente.enviados, isEmpty);

      // Arrepentirse no debe cambiar nada.
      await tester.tap(find.text('Mantener'));
      await tester.pumpAndSettle();
      expect(cliente.enviados, isEmpty);
    });

    testWidgets('una solicitud fuera de plazo lo dice, no lo deja en la fecha',
        (tester) async {
      await tester.binding.setSurfaceSize(const Size(900, 1800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        _envolver(
          clienteCon(
            solicitudes: [
              {
                'id': 's1',
                'tipo': 'RECTIFICACION',
                'detalle': 'Mi apellido está mal escrito en el comprobante.',
                'estado': 'RECIBIDA',
                'plazoLimite': _enDias(-3),
                'respuesta': null,
                'respondidoEn': null,
                'vencida': true,
              },
            ],
          ),
          const PantallaPrivacidad(),
        ),
      );
      await tester.pumpAndSettle();

      expect(find.text('Rectificación de mis datos'), findsOneWidget);
      expect(find.textContaining('Fuera de plazo desde'), findsOneWidget);
    });
  });

  group('Bandeja de solicitudes ARCO', () {
    Widget bandejaCon(List<Map<String, dynamic>> filas) => _envolver(
          _ClienteApiFalso(listas: {'/cumplimiento/arco/bandeja': filas}),
          const Scaffold(body: PantallaArcoBandeja()),
        );

    Map<String, dynamic> solicitud({
      required String id,
      required String estado,
      required bool vencida,
      int dias = 5,
    }) =>
        {
          'id': id,
          'tipo': 'ACCESO',
          'detalle': 'Quiero saber qué datos míos tienen.',
          'estado': estado,
          'plazoLimite': _enDias(dias),
          'vencida': vencida,
          'solicitante': {'correo': 'rosa@prueba.pe', 'nombre': 'Rosa Chávez'},
          'creadoEn': _enDias(-2),
        };

    testWidgets('avisa arriba cuantas solicitudes estan fuera de plazo', (tester) async {
      await tester.binding.setSurfaceSize(const Size(900, 1800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        bandejaCon([
          solicitud(id: 'a', estado: 'RECIBIDA', vencida: true, dias: -4),
          solicitud(id: 'b', estado: 'EN_PROCESO', vencida: true, dias: -1),
          solicitud(id: 'c', estado: 'RECIBIDA', vencida: false),
        ]),
      );
      await tester.pumpAndSettle();

      // Un incumplimiento de plazo es una infraccion, no un detalle de lista.
      expect(find.text('2 solicitudes están fuera del plazo legal'), findsOneWidget);
    });

    testWidgets('una solicitud ya resuelta no ofrece responder de nuevo', (tester) async {
      await tester.binding.setSurfaceSize(const Size(900, 1800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(
        bandejaCon([
          solicitud(id: 'a', estado: 'ATENDIDA', vencida: false),
          solicitud(id: 'b', estado: 'RECIBIDA', vencida: false),
        ]),
      );
      await tester.pumpAndSettle();

      // Dos solicitudes, un solo boton: el de la que sigue abierta.
      expect(find.text('Responder'), findsOneWidget);
      expect(find.text('Atendida'), findsOneWidget);
    });

    testWidgets('sin solicitudes explica que apareceran con su plazo', (tester) async {
      await tester.binding.setSurfaceSize(const Size(900, 1800));
      addTearDown(() => tester.binding.setSurfaceSize(null));

      await tester.pumpWidget(bandejaCon(const []));
      await tester.pumpAndSettle();

      expect(find.text('No hay solicitudes pendientes'), findsOneWidget);
    });
  });
}
