// RF-SO-05 y RF-DE-06 · La invitacion a la encuesta, el consentimiento antes
// de la primera pregunta y el envio de las respuestas.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trazabilidad_radical/funciones/encuestas/pantalla_encuesta.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';

const _pendiente = {
  'codigo': 'SUS',
  'version': 1,
  'momento': 'UNICA',
  'nombre': 'Facilidad de uso (System Usability Scale)',
  'items': 3,
  'motivo': 'Ya donó a través de la aplicación.',
};

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({this.consentimiento = false, this.pendientes = const [_pendiente]});

  final bool consentimiento;
  final List<Map<String, dynamic>> pendientes;
  final actualizaciones = <String, Object?>{};
  final envios = <String, Object?>{};

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async =>
      switch (ruta) {
        '/encuestas/pendientes' => {'consentimiento': consentimiento, 'pendientes': pendientes},
        '/encuestas/instrumentos/SUS' => {
            'codigo': 'SUS',
            'version': 1,
            'nombre': 'Facilidad de uso (System Usability Scale)',
            'instrucciones': 'Piense en lo que acaba de hacer.',
            'escala': {
              'minimo': 1,
              'maximo': 5,
              'etiquetaMinimo': 'Totalmente en desacuerdo',
              'etiquetaMaximo': 'Totalmente de acuerdo',
            },
            'items': [
              {'numero': 1, 'texto': 'Creo que me gustaría usarla con frecuencia.'},
              {'numero': 2, 'texto': 'La encontré innecesariamente compleja.'},
              {'numero': 3, 'texto': 'Pensé que era fácil de usar.'},
            ],
          },
        _ => throw const ErrorApi(mensaje: 'Ruta no prevista.'),
      };

  @override
  Future<Map<String, dynamic>> actualizar(String ruta, {Object? cuerpo}) async {
    actualizaciones[ruta] = cuerpo;
    return const {};
  }

  @override
  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    envios[ruta] = cuerpo;
    return const {'registrada': true};
  }
}

Future<_ClienteApiFalso> _montar(WidgetTester tester, _ClienteApiFalso cliente) async {
  await tester.binding.setSurfaceSize(const Size(900, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(
    ProviderScope(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
      child: const MaterialApp(home: Scaffold(body: InvitacionEncuesta())),
    ),
  );
  await tester.pumpAndSettle();
  return cliente;
}

void main() {
  testWidgets('la invitacion dice que es opcional y por que se pide ahora', (tester) async {
    await _montar(tester, _ClienteApiFalso());

    expect(find.text('Una encuesta de 3 preguntas, si quiere'), findsOneWidget);
    expect(find.textContaining('Ya donó a través de la aplicación.'), findsOneWidget);

    await tester.tap(find.text('Ahora no'));
    await tester.pumpAndSettle();
    expect(find.text('Una encuesta de 3 preguntas, si quiere'), findsNothing);
  });

  testWidgets('sin nada pendiente no aparece', (tester) async {
    await _montar(tester, _ClienteApiFalso(pendientes: const []));
    expect(find.byType(Card), findsNothing);
  });

  testWidgets('sin la autorizacion no muestra las preguntas, y la pide antes', (tester) async {
    final cliente = await _montar(tester, _ClienteApiFalso());

    await tester.tap(find.text('Responder'));
    await tester.pumpAndSettle();

    expect(find.textContaining('Se guardan sin su nombre ni su cuenta'), findsOneWidget);
    expect(find.textContaining('Creo que me gustaría'), findsNothing);

    await tester.tap(find.text('Autorizo usar mis respuestas para investigación'));
    await tester.pumpAndSettle();

    expect(cliente.actualizaciones['/cumplimiento/consentimientos'], {
      'finalidad': 'INVESTIGACION',
      'otorgado': true,
    });
    expect(find.textContaining('Creo que me gustaría'), findsOneWidget);
  });

  testWidgets('solo se envia con todas las preguntas respondidas', (tester) async {
    final cliente = await _montar(tester, _ClienteApiFalso(consentimiento: true));

    await tester.tap(find.text('Responder'));
    await tester.pumpAndSettle();

    final enviar = find.widgetWithText(FilledButton, 'Responda todas las preguntas para enviar');
    expect(tester.widget<FilledButton>(enviar).onPressed, isNull);

    // Un 4 en cada pregunta: cada fila tiene sus propios chips del 1 al 5.
    final cuatros = find.widgetWithText(ChoiceChip, '4');
    for (var i = 0; i < 3; i++) {
      await tester.tap(cuatros.at(i));
      await tester.pumpAndSettle();
    }
    await tester.tap(find.widgetWithText(FilledButton, 'Enviar'));
    await tester.pumpAndSettle();

    expect(cliente.envios['/encuestas/respuestas'], {
      'codigo': 'SUS',
      'version': 1,
      'momento': 'UNICA',
      'valores': [4, 4, 4],
    });
    expect(find.text('Gracias. Su respuesta se guardó sin su nombre.'), findsOneWidget);
  });
}
