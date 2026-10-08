// Que ve cada rol: pestañas y boton de donar.
//
// Antes "Causas" era la primera pestaña de todos, y la ficha de cada causa
// ofrecia "Donar" a un operador de ONG o a un auditor. La API ahora lo
// rechaza; estas pruebas fijan que la aplicacion tampoco lo ofrezca.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/donante/pantalla_campana.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';
import 'package:trazabilidad_radical/nucleo/sesion.dart';
import 'package:trazabilidad_radical/nucleo/shell.dart';

UsuarioSesion _usuario(List<String> roles) => UsuarioSesion(
      id: 'u1',
      correo: 'cuenta@prueba.pe',
      nombres: 'Cuenta',
      apellidos: 'De Prueba',
      roles: roles,
    );

class _Sesion extends SesionNotifier {
  _Sesion(this.roles);

  final List<String> roles;

  @override
  EstadoSesion build() => EstadoSesion(usuario: _usuario(roles));
}

const _causa = <String, dynamic>{
  'id': 'c1',
  'slug': 'rescate',
  'titulo': 'Rescate de perros en Huánuco',
  'descripcion': 'Atención veterinaria para perros rescatados.',
  'causa': 'Bienestar animal',
  'ong': {
    'id': 'ong-1',
    'nombre': 'Huellas del Ande',
    'verificada': true,
    'puntajeConfianza': '72.00',
    'desglosePuntaje': null,
  },
  'fondos': [
    {
      'id': 'f1',
      'nombre': 'Atención veterinaria',
      'descripcion': null,
      'categoriaGasto': 'ATENCION_VETERINARIA',
      'meta': '1000.00',
      'recaudado': '300.00',
      'retenido': '200.00',
      'ejecutado': '100.00',
      'avance': 30,
    },
  ],
};

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({this.misOngs = const []});

  final List<Map<String, dynamic>> misOngs;

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async =>
      _causa;

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      ruta == '/ongs/mias/listado' ? misOngs : const [];
}

Future<void> _montarCampana(
  WidgetTester tester,
  List<String> roles, {
  List<Map<String, dynamic>> misOngs = const [],
}) async {
  await tester.binding.setSurfaceSize(const Size(1200, 2000));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        clienteApiProvider.overrideWithValue(_ClienteApiFalso(misOngs: misOngs)),
        sesionProvider.overrideWith(() => _Sesion(roles)),
      ],
      child: const MaterialApp(home: PantallaCampana(slug: 'rescate')),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  group('pestañas por rol', () {
    test('el donante entra a las causas', () {
      expect(
        etiquetasDeNavegacion(_usuario(['DONANTE'])),
        ['Causas', 'Mis aportes', 'Impacto'],
      );
    });

    test('el operador no tiene la pestaña de causas', () {
      expect(etiquetasDeNavegacion(_usuario(['ONG_OPERADOR'])), ['Fondos', 'Gastos']);
    });

    test('quien opera una ONG y tambien dona entra primero a su ONG', () {
      expect(
        etiquetasDeNavegacion(_usuario(['DONANTE', 'ONG_ADMIN'])),
        ['Fondos', 'Gastos', 'Causas', 'Mis aportes', 'Impacto'],
      );
    });

    test('auditor y administrador no ven el catalogo como pestaña', () {
      expect(etiquetasDeNavegacion(_usuario(['AUDITOR'])), isNot(contains('Causas')));
      expect(etiquetasDeNavegacion(_usuario(['ADMIN'])), isNot(contains('Causas')));
    });
  });

  group('boton de donar', () {
    testWidgets('el donante puede donar', (tester) async {
      await _montarCampana(tester, ['DONANTE']);

      expect(find.text('Donar a Atención veterinaria'), findsOneWidget);
      expect(find.byType(AvisoSinDonar), findsNothing);
    });

    testWidgets('el operador ve la causa en modo consulta', (tester) async {
      await _montarCampana(tester, ['ONG_OPERADOR']);

      expect(find.text('Donar a Atención veterinaria'), findsNothing);
      expect(find.textContaining('modo consulta'), findsOneWidget);
      // Los saldos siguen a la vista: la transparencia no depende del rol.
      expect(find.text('Esperando evidencia'), findsOneWidget);
    });

    testWidgets('un donante miembro de la ONG no dona a su propia causa', (tester) async {
      await _montarCampana(
        tester,
        ['DONANTE', 'ONG_ADMIN'],
        misOngs: [
          {'id': 'ong-1', 'cargo': 'ADMINISTRADOR'},
        ],
      );

      expect(find.text('Donar a Atención veterinaria'), findsNothing);
      expect(find.textContaining('es miembro de esta organización'), findsOneWidget);
    });

    testWidgets('un donante miembro de otra ONG si puede donar', (tester) async {
      await _montarCampana(
        tester,
        ['DONANTE', 'ONG_ADMIN'],
        misOngs: [
          {'id': 'otra-ong', 'cargo': 'ADMINISTRADOR'},
        ],
      );

      expect(find.text('Donar a Atención veterinaria'), findsOneWidget);
    });
  });
}
