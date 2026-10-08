// Gestion de campañas y fondos por el administrador de la ONG.
//
// La API ya permitia crear, publicar, pausar y cerrar; la aplicacion no
// ofrecia ninguna de esas acciones, asi que "adicionar una causa" solo se
// podia hacer desde la semilla. Estas pruebas fijan que cada cargo vea lo
// que puede hacer, y que publicar se explique cuando todavia no se puede.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/ong/hoja_fondo.dart';
import 'package:trazabilidad_radical/funciones/ong/pantalla_campanas.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';

Map<String, dynamic> _ong({String cargo = 'ADMINISTRADOR', bool verificada = true}) => {
      'id': 'ong-1',
      'razonSocial': 'Huellas del Ande',
      'nombreComercial': 'Huellas del Ande',
      'ruc': '20601030579',
      'estadoVerificacion': verificada ? 'VERIFICADA' : 'PENDIENTE',
      'puntajeConfianza': '72.00',
      'cargo': cargo,
    };

Map<String, dynamic> _campana({
  String estado = 'BORRADOR',
  List<Map<String, dynamic>> fondos = const [],
}) =>
    {
      'id': 'c1',
      'slug': 'rescate',
      'titulo': 'Rescate de perros en Huánuco',
      'estado': estado,
      'descripcion': 'Atención veterinaria para perros rescatados en la ciudad de Huánuco.',
      'causa': 'Bienestar animal',
      'departamento': 'Huanuco',
      'fechaInicio': '2026-06-01T00:00:00.000Z',
      'fechaFin': null,
      'imagenUrl': null,
      'fondos': fondos,
    };

const _fondo = <String, dynamic>{
  'id': 'f1',
  'nombre': 'Atención veterinaria',
  'descripcion': null,
  'categoriaGasto': 'ATENCION_VETERINARIA',
  'estado': 'ACTIVO',
  'meta': '1000.00',
  'recaudado': '300.00',
  'retenido': '200.00',
  'ejecutado': '100.00',
  'avance': 30,
};

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({required this.ong, required this.campanas});

  final Map<String, dynamic> ong;
  final List<Map<String, dynamic>> campanas;
  final actualizaciones = <String, Object?>{};
  final envios = <String, Object?>{};

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      switch (ruta) {
        '/ongs/mias/listado' => [ong],
        '/ongs/ong-1/fondos' => campanas,
        _ => const [],
      };

  @override
  Future<Map<String, dynamic>> actualizar(String ruta, {Object? cuerpo}) async {
    actualizaciones[ruta] = cuerpo;
    return {'id': 'c1'};
  }

  @override
  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    envios[ruta] = cuerpo;
    return {'id': 'nuevo'};
  }
}

Future<_ClienteApiFalso> _montar(
  WidgetTester tester, {
  required Map<String, dynamic> ong,
  required List<Map<String, dynamic>> campanas,
  Widget? pantalla,
}) async {
  await tester.binding.setSurfaceSize(const Size(1200, 1800));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  final cliente = _ClienteApiFalso(ong: ong, campanas: campanas);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
      child: MaterialApp(home: Scaffold(body: pantalla ?? const PantallaCampanas())),
    ),
  );
  await tester.pumpAndSettle();
  return cliente;
}

Finder _boton(String texto) => find.widgetWithText(FilledButton, texto);

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  testWidgets('un borrador sin fondos no se puede publicar todavía', (tester) async {
    await _montar(tester, ong: _ong(), campanas: [_campana()]);

    expect(find.text('Borrador'), findsOneWidget);
    expect(find.textContaining('Agregue al menos uno para poder publicarla'), findsOneWidget);
    expect(tester.widget<FilledButton>(_boton('Publicar')).onPressed, isNull);
  });

  testWidgets('con un fondo activo, publicar cambia el estado en la API', (tester) async {
    final cliente = await _montar(
      tester,
      ong: _ong(),
      campanas: [_campana(fondos: [_fondo])],
    );

    await tester.tap(_boton('Publicar'));
    await tester.pumpAndSettle();

    expect(cliente.actualizaciones['/campanas/c1'], {'estado': 'ACTIVA'});
  });

  testWidgets('una ONG sin verificar prepara borradores pero no publica', (tester) async {
    await _montar(
      tester,
      ong: _ong(verificada: false),
      campanas: [_campana(fondos: [_fondo])],
    );

    expect(find.textContaining('todavía no está verificada'), findsOneWidget);
    expect(tester.widget<FilledButton>(_boton('Publicar')).onPressed, isNull);
  });

  testWidgets('cerrar pide confirmación antes de llamar a la API', (tester) async {
    final cliente = await _montar(
      tester,
      ong: _ong(),
      campanas: [_campana(estado: 'ACTIVA', fondos: [_fondo])],
    );

    await tester.tap(find.widgetWithText(TextButton, 'Cerrar'));
    await tester.pumpAndSettle();
    expect(find.text('¿Cerrar la campaña?'), findsOneWidget);
    expect(cliente.actualizaciones, isEmpty);

    await tester.tap(_boton('Cerrar campaña'));
    await tester.pumpAndSettle();
    expect(cliente.actualizaciones['/campanas/c1'], {'estado': 'CERRADA'});
  });

  testWidgets('el operador ve las campañas sin acciones', (tester) async {
    await _montar(
      tester,
      ong: _ong(cargo: 'OPERADOR'),
      campanas: [_campana(estado: 'ACTIVA', fondos: [_fondo])],
    );

    expect(find.textContaining('modo consulta'), findsOneWidget);
    expect(find.text('Editar'), findsNothing);
    expect(find.text('Nueva campaña'), findsNothing);
  });

  testWidgets('el fondo nuevo exige meta y envía su categoría', (tester) async {
    final cliente = await _montar(
      tester,
      ong: _ong(),
      campanas: const [],
      pantalla: const HojaFondo(campanaId: 'c1'),
    );

    await tester.enterText(find.widgetWithText(TextFormField, 'Nombre del fondo'), 'Cirugías');
    await tester.tap(_boton('Crear fondo'));
    await tester.pumpAndSettle();
    expect(find.text('Indique una meta mayor que cero.'), findsOneWidget);
    expect(cliente.envios, isEmpty);

    await tester.enterText(find.widgetWithText(TextFormField, 'Meta'), '1500');
    await tester.tap(_boton('Crear fondo'));
    await tester.pumpAndSettle();
    expect(cliente.envios['/campanas/c1/fondos'], {
      'nombre': 'Cirugías',
      'meta': 1500.0,
      'categoriaGasto': 'ALIMENTOS',
    });
  });
}
