// El inicio de cada rol y la navegacion que sale de el.
//
// Antes todos entraban al catalogo de causas. Lo que se fija aqui: que cada
// rol vea su seccion y no la de otro, que la de su rol principal vaya
// primero, que los avisos aparezcan cuando hay algo que atender, y que en
// el celular siete pestañas no se apilen en la barra.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/inicio/pantalla_inicio.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';
import 'package:trazabilidad_radical/nucleo/navegacion.dart';
import 'package:trazabilidad_radical/nucleo/sesion.dart';
import 'package:trazabilidad_radical/nucleo/shell.dart';

const _donante = <String, dynamic>{
  'aportes': 2,
  'aportado': '150.00',
  'ejecutado': '78.00',
  'esperandoEvidencia': '72.00',
  'causasApoyadas': 1,
  'impactosSinLeer': 1,
  'ultimoImpacto': {
    'asunto': 'Tu donación acaba de hacer esto posible',
    'montoAplicado': '78.00',
    'creadoEn': '2026-10-06T15:00:00.000Z',
  },
  'suscripcionesActivas': 0,
};

Map<String, dynamic> _ong({String cargo = 'OPERADOR', int observaciones = 0}) => {
      'id': 'ong-1',
      'nombre': 'Huellas del Ande',
      'cargo': cargo,
      'estadoVerificacion': 'VERIFICADA',
      'motivoRechazo': null,
      'puntajeConfianza': '72.00',
      'campanas': {'ACTIVA': 2, 'BORRADOR': 1},
      'gastos': {'EN_REVISION': 1, 'APROBADO': 6},
      'meta': '9000.00',
      'recaudado': '1200.00',
      'retenido': '800.00',
      'ejecutado': '400.00',
      'observacionesAbiertas': observaciones,
      'fotosPorDifuminar': 0,
      'equipoActivo': 2,
    };

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso(this.panel);

  final Map<String, dynamic> panel;

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async =>
      ruta == '/analitica/panel' ? panel : const {};

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      const [];
}

class _Sesion extends SesionNotifier {
  _Sesion(this.roles);

  final List<String> roles;

  @override
  EstadoSesion build() => EstadoSesion(
        usuario: UsuarioSesion(
          id: 'u1',
          correo: 'cuenta@prueba.pe',
          nombres: 'Lucía',
          apellidos: 'Vargas',
          roles: roles,
        ),
      );
}

Future<ProviderContainer> _montar(
  WidgetTester tester, {
  required List<String> roles,
  required Map<String, dynamic> panel,
  Widget pantalla = const Scaffold(body: PantallaInicio()),
  Size tamano = const Size(1200, 2000),
}) async {
  await tester.binding.setSurfaceSize(tamano);
  addTearDown(() => tester.binding.setSurfaceSize(null));

  final contenedor = ProviderContainer(
    overrides: [
      clienteApiProvider.overrideWithValue(_ClienteApiFalso(panel)),
      sesionProvider.overrideWith(() => _Sesion(roles)),
    ],
  );
  addTearDown(contenedor.dispose);

  await tester.pumpWidget(
    UncontrolledProviderScope(container: contenedor, child: MaterialApp(home: pantalla)),
  );
  await tester.pumpAndSettle();
  return contenedor;
}

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  testWidgets('el donante ve lo suyo, y una cifra lleva a su pestaña', (tester) async {
    final contenedor = await _montar(tester, roles: ['DONANTE'], panel: {'donante': _donante});

    expect(find.text('Hola, Lucía'), findsOneWidget);
    expect(find.text('Sus aportes'), findsOneWidget);
    expect(find.text('S/ 72.00'), findsOneWidget);
    expect(find.text('Auditoría'), findsNothing);

    await tester.tap(find.text('Impactos sin leer'));
    await tester.pump();
    expect(contenedor.read(navegacionProvider), 'Impacto');
  });

  testWidgets('el operador ve su ONG y lo que tiene por atender', (tester) async {
    await _montar(
      tester,
      roles: ['ONG_OPERADOR'],
      panel: {
        'ongs': [_ong(observaciones: 2)],
      },
    );

    expect(find.text('Huellas del Ande'), findsOneWidget);
    expect(find.text('Hay 2 observaciones del auditor por responder.'), findsOneWidget);
    expect(find.text('Registrar gasto'), findsOneWidget);
    // Crear campañas y gestionar el equipo es del administrador.
    expect(find.text('Campañas'), findsNothing);
  });

  testWidgets('con dos roles, la sección del rol principal va primero', (tester) async {
    await _montar(
      tester,
      roles: ['DONANTE', 'ONG_ADMIN'],
      panel: {
        'donante': _donante,
        'ongs': [_ong(cargo: 'ADMINISTRADOR')],
      },
    );

    final ong = tester.getTopLeft(find.text('Huellas del Ande')).dy;
    final aportes = tester.getTopLeft(find.text('Sus aportes')).dy;
    expect(ong, lessThan(aportes));
  });

  testWidgets('el auditor ve los casos fuera de plazo', (tester) async {
    await _montar(
      tester,
      roles: ['AUDITOR'],
      panel: {
        'auditor': {
          'casosEnRevision': 4,
          'casosVencidos': 3,
          'porNivel': {'ALTO': 0, 'MEDIO': 3, 'BAJO': 1},
          'ongsPorVerificar': 1,
          'alertasAbiertas': 2,
        },
      },
    );

    expect(find.textContaining('3 casos superaron las 48 horas hábiles'), findsOneWidget);
    expect(find.text('Ir a la bandeja'), findsOneWidget);
  });

  testWidgets('en el celular, más de cinco pestañas pasan a "Más"', (tester) async {
    final contenedor = await _montar(
      tester,
      roles: ['DONANTE', 'ONG_ADMIN'],
      panel: const {},
      pantalla: const Shell(),
      tamano: const Size(400, 800),
    );

    final barra = find.byType(NavigationBar);
    expect(find.descendant(of: barra, matching: find.byType(NavigationDestination)),
        findsNWidgets(maximoEnBarra));
    expect(find.descendant(of: barra, matching: find.text('Más')), findsOneWidget);

    await tester.tap(find.text('Más'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Impacto'));
    await tester.pumpAndSettle();

    expect(contenedor.read(navegacionProvider), 'Impacto');
  });
}
