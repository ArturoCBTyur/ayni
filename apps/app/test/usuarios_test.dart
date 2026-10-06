// Pruebas de la gestion de usuarios (RF-16).
//
// Lo que se comprueba es lo que vuelve seguro al panel: que ninguna accion
// salga sin motivo, que la propia cuenta no ofrezca quitarse el acceso, y que
// lo que el servidor rechaza se lea en la pantalla en vez de perderse.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/admin/pantalla_usuarios.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';
import 'package:trazabilidad_radical/nucleo/sesion.dart';

const _miId = 'admin-1';

Map<String, dynamic> _cuenta({
  required String id,
  required String nombres,
  List<String> roles = const ['DONANTE'],
  String estado = 'ACTIVO',
  bool exigeMfa = false,
  bool totpHabilitado = false,
}) =>
    {
      'id': id,
      'correo': '$id@prueba.pe',
      'nombres': nombres,
      'apellidos': 'Prueba',
      'estado': estado,
      'roles': roles,
      'totpHabilitado': totpHabilitado,
      'exigeMfa': exigeMfa,
      'mfaPendiente': exigeMfa && !totpHabilitado,
      'ultimoAccesoEn': null,
      'creadoEn': '2026-09-01T10:00:00.000Z',
      'ongs': <dynamic>[],
      'historial': <dynamic>[],
    };

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso(this.cuentas, {this.errorAlActualizar});

  final List<Map<String, dynamic>> cuentas;
  final ErrorApi? errorAlActualizar;
  final List<({String ruta, Object? cuerpo})> enviados = [];

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async {
    if (ruta == '/identidad/usuarios') {
      return {'total': cuentas.length, 'pagina': 1, 'porPagina': 20, 'usuarios': cuentas};
    }
    final id = ruta.split('/').last;
    return cuentas.firstWhere((c) => c['id'] == id);
  }

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      [
        for (final c in ['DONANTE', 'ONG_OPERADOR', 'ONG_ADMIN', 'AUDITOR', 'ADMIN'])
          {'codigo': c, 'nombre': c, 'exigeMfa': c != 'DONANTE'},
      ];

  @override
  Future<Map<String, dynamic>> actualizar(String ruta, {Object? cuerpo}) async {
    enviados.add((ruta: ruta, cuerpo: cuerpo));
    if (errorAlActualizar != null) throw errorAlActualizar!;
    return <String, dynamic>{};
  }

  @override
  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    enviados.add((ruta: ruta, cuerpo: cuerpo));
    return <String, dynamic>{};
  }
}

class _SesionAdmin extends SesionNotifier {
  @override
  EstadoSesion build() => const EstadoSesion(
        usuario: UsuarioSesion(
          id: _miId,
          correo: 'admin-1@prueba.pe',
          nombres: 'Ana',
          apellidos: 'Admin',
          roles: ['ADMIN'],
        ),
      );
}

Future<void> _montar(WidgetTester tester, _ClienteApiFalso cliente) async {
  await tester.binding.setSurfaceSize(const Size(1200, 1800));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        clienteApiProvider.overrideWithValue(cliente),
        sesionProvider.overrideWith(_SesionAdmin.new),
      ],
      child: const MaterialApp(home: Scaffold(body: PantallaUsuarios())),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  testWidgets('lista las cuentas con sus roles legibles y el bloqueo a la vista',
      (tester) async {
    await _montar(
      tester,
      _ClienteApiFalso([
        _cuenta(id: 'u1', nombres: 'Rosa', roles: ['DONANTE']),
        _cuenta(
          id: 'u2',
          nombres: 'Carlos',
          roles: ['AUDITOR'],
          estado: 'BLOQUEADO',
          exigeMfa: true,
        ),
      ]),
    );

    // Dentro de las tarjetas: los menus de filtro repiten las mismas etiquetas.
    Finder enTarjetas(String texto) =>
        find.descendant(of: find.byType(Card), matching: find.text(texto));

    expect(find.text('2 cuentas'), findsOneWidget);
    expect(enTarjetas('Rosa Prueba'), findsOneWidget);
    expect(enTarjetas('Auditor'), findsOneWidget);
    expect(enTarjetas('Bloqueada'), findsOneWidget);
    // Un auditor sin segundo factor no puede trabajar: se ve sin abrir la ficha.
    expect(enTarjetas('Dos pasos sin configurar'), findsOneWidget);
  });

  testWidgets('la propia cuenta no ofrece bloquearse ni quitarse el rol', (tester) async {
    await _montar(
      tester,
      _ClienteApiFalso([
        _cuenta(id: _miId, nombres: 'Ana', roles: ['ADMIN'], exigeMfa: true, totpHabilitado: true),
      ]),
    );

    await tester.tap(find.text('Ana Prueba'));
    await tester.pumpAndSettle();

    final chipAdmin = tester.widget<FilterChip>(
      find.ancestor(of: find.text('Administrador'), matching: find.byType(FilterChip)),
    );
    expect(chipAdmin.onSelected, isNull);
    expect(find.text('Bloquear cuenta'), findsNothing);
    expect(find.text('Restablecer dos pasos'), findsNothing);
  });

  testWidgets('bloquear no llama al servidor hasta tener un motivo suficiente', (tester) async {
    final cliente = _ClienteApiFalso([_cuenta(id: 'u1', nombres: 'Rosa')]);
    await _montar(tester, cliente);

    await tester.tap(find.text('Rosa Prueba'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Bloquear cuenta'));
    await tester.pumpAndSettle();

    // La consecuencia se dice antes de confirmar.
    expect(find.textContaining('Se cerrarán todas sus sesiones'), findsOneWidget);

    await tester.enterText(find.byType(TextFormField), 'porque');
    await tester.tap(find.widgetWithText(FilledButton, 'Bloquear'));
    await tester.pumpAndSettle();

    expect(find.text('Explique el motivo con al menos 10 caracteres.'), findsOneWidget);
    expect(cliente.enviados, isEmpty);

    await tester.enterText(find.byType(TextFormField), 'Reporte de suplantación confirmado.');
    await tester.tap(find.widgetWithText(FilledButton, 'Bloquear'));
    await tester.pumpAndSettle();

    expect(cliente.enviados, hasLength(1));
    expect(cliente.enviados.single.ruta, '/identidad/usuarios/u1/estado');
    expect(cliente.enviados.single.cuerpo, {
      'estado': 'BLOQUEADO',
      'motivo': 'Reporte de suplantación confirmado.',
    });
  });

  testWidgets('cambiar roles envia el conjunto completo y muestra el rechazo del servidor',
      (tester) async {
    final cliente = _ClienteApiFalso(
      [_cuenta(id: 'u3', nombres: 'Sofia', roles: ['ADMIN'], exigeMfa: true, totpHabilitado: true)],
      errorAlActualizar: const ErrorApi(
        mensaje: 'Es la unica cuenta administradora activa.',
        codigo: 409,
      ),
    );
    await _montar(tester, cliente);

    await tester.tap(find.text('Sofia Prueba'));
    await tester.pumpAndSettle();

    final guardar = find.widgetWithText(FilledButton, 'Guardar roles');
    // Sin cambios no hay nada que guardar.
    expect(tester.widget<FilledButton>(guardar).onPressed, isNull);

    await tester.tap(find.widgetWithText(FilterChip, 'Donante'));
    await tester.pump();
    await tester.tap(find.widgetWithText(FilterChip, 'Administrador'));
    await tester.pumpAndSettle();
    await tester.tap(guardar);
    await tester.pumpAndSettle();

    await tester.enterText(find.byType(TextFormField), 'Deja la administración del proyecto.');
    await tester.tap(find.widgetWithText(FilledButton, 'Guardar roles').last);
    await tester.pumpAndSettle();

    expect(cliente.enviados.single.cuerpo, {
      'roles': ['DONANTE'],
      'motivo': 'Deja la administración del proyecto.',
    });
    expect(find.text('Es la unica cuenta administradora activa.'), findsOneWidget);
  });
}
