// Ciclo de vida de la ONG: registro, verificacion y equipo.
//
// Las tres cosas existian en la API y ninguna en la aplicacion: una ONG
// nueva, su sello y sus operadores solo podian venir de la semilla.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/auditor/pantalla_verificacion_ong.dart';
import 'package:trazabilidad_radical/funciones/ong/pantalla_equipo.dart';
import 'package:trazabilidad_radical/funciones/ong/pantalla_registrar_ong.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';

const _expediente = <String, dynamic>{
  'id': 'ong-9',
  'ruc': '20601030579',
  'razonSocial': 'Asociacion Patitas de Pillco',
  'nombreComercial': 'Patitas de Pillco',
  'representanteLegal': 'Ana Maria Perez',
  'documentoRepresentante': '44556677',
  'direccion': 'Jr. Huallayco 123',
  'departamento': 'Huanuco',
  'provincia': null,
  'distrito': 'Pillco Marca',
  'correoContacto': 'contacto@patitas.pe',
  'telefono': '987654321',
  'sitioWeb': null,
  'descripcion': 'Rescate y esterilización de perros en Pillco Marca.',
  'estadoVerificacion': 'PENDIENTE',
  'terminosAceptadosEn': '2026-10-01T15:00:00.000Z',
  'versionTerminos': '1.0',
  'solicitadoEn': '2026-10-01T15:00:00.000Z',
  'contacto': {'nombres': 'Ana', 'apellidos': 'Perez', 'correo': 'ana@patitas.pe'},
};

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({this.errorAlEnviar});

  final ErrorApi? errorAlEnviar;
  final actualizaciones = <String, Object?>{};
  final envios = <String, Object?>{};

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      switch (ruta) {
        '/verificaciones/pendientes' => [_expediente],
        '/ongs/mias/listado' => [
            {
              'id': 'ong-1',
              'razonSocial': 'Huellas del Ande',
              'nombreComercial': 'Huellas del Ande',
              'cargo': 'ADMINISTRADOR',
            },
          ],
        '/ongs/ong-1/miembros' => [
            {
              'usuarioId': 'u1',
              'nombre': 'Miguel Tapia',
              'correo': 'ong.admin@demo.pe',
              'cargo': 'ADMINISTRADOR',
              'activo': true,
              'desde': '2026-09-01T00:00:00.000Z',
              'esUsted': true,
            },
          ],
        _ => const [],
      };

  @override
  Future<Map<String, dynamic>> actualizar(String ruta, {Object? cuerpo}) async {
    actualizaciones[ruta] = cuerpo;
    return const {};
  }

  @override
  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    envios[ruta] = cuerpo;
    if (errorAlEnviar != null) throw errorAlEnviar!;
    return const {};
  }
}

Future<_ClienteApiFalso> _montar(
  WidgetTester tester,
  Widget pantalla, {
  ErrorApi? errorAlEnviar,
}) async {
  await tester.binding.setSurfaceSize(const Size(1200, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  final cliente = _ClienteApiFalso(errorAlEnviar: errorAlEnviar);
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

  group('verificación de ONG', () {
    testWidgets('el auditor ve el expediente completo', (tester) async {
      await _montar(tester, const PantallaVerificacionOng());

      expect(find.text('Patitas de Pillco'), findsOneWidget);
      expect(find.text('Ana Maria Perez · doc. 44556677'), findsOneWidget);
      expect(find.textContaining('contacto@patitas.pe'), findsOneWidget);
    });

    testWidgets('verificar exige un motivo y lo envía con la decisión', (tester) async {
      final cliente = await _montar(tester, const PantallaVerificacionOng());

      await tester.tap(find.widgetWithText(FilledButton, 'Verificar'));
      await tester.pumpAndSettle();
      await tester.tap(find.widgetWithText(FilledButton, 'Verificar').last);
      await tester.pumpAndSettle();
      expect(find.text('Explique el motivo en al menos 10 caracteres.'), findsOneWidget);
      expect(cliente.actualizaciones, isEmpty);

      await tester.enterText(find.byType(TextField), 'RUC activo y habido en SUNAT.');
      await tester.tap(find.widgetWithText(FilledButton, 'Verificar').last);
      await tester.pumpAndSettle();
      expect(cliente.actualizaciones['/ongs/ong-9/verificacion'], {
        'decision': 'VERIFICADA',
        'motivo': 'RUC activo y habido en SUNAT.',
      });
    });
  });

  testWidgets('el administrador agrega un operador por correo', (tester) async {
    await tester.binding.setSurfaceSize(const Size(1200, 2400));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    final cliente = _ClienteApiFalso();
    await tester.pumpWidget(
      ProviderScope(
        overrides: [clienteApiProvider.overrideWithValue(cliente)],
        child: const MaterialApp(home: PantallaEquipo()),
      ),
    );
    await tester.pumpAndSettle();

    expect(find.text('Miguel Tapia (usted)'), findsOneWidget);

    await tester.tap(find.text('Agregar persona'));
    await tester.pumpAndSettle();
    await tester.enterText(find.widgetWithText(TextField, 'Correo'), 'lucia@demo.pe');
    await tester.tap(find.widgetWithText(FilledButton, 'Agregar'));
    await tester.pumpAndSettle();

    expect(cliente.envios['/ongs/ong-1/miembros'], {
      'correo': 'lucia@demo.pe',
      'cargo': 'OPERADOR',
    });
  });

  group('registro de ONG', () {
    Future<void> completar(WidgetTester tester) async {
      Future<void> escribir(String etiqueta, String texto) async {
        final campo = find.widgetWithText(TextFormField, etiqueta);
        await tester.ensureVisible(campo);
        await tester.enterText(campo, texto);
      }

      await escribir('RUC', '20601030579');
      await escribir('Razón social', 'Asociacion Patitas de Pillco');
      await escribir('Representante legal', 'Ana Maria Perez');
      await escribir('DNI o carné de extranjería del representante', '44556677');
      await escribir('Dirección fiscal', 'Jr. Huallayco 123');
      await escribir('Departamento', 'Huanuco');
      await escribir('Correo de contacto', 'contacto@patitas.pe');
      await escribir(
        'Labor de la organización',
        'Rescate y esterilización de perros en Pillco Marca desde 2019.',
      );
    }

    Future<void> enviar(WidgetTester tester) async {
      final boton = find.text('Enviar solicitud de verificación');
      await tester.ensureVisible(boton);
      await tester.tap(boton);
      await tester.pumpAndSettle();
    }

    testWidgets('sin aceptar los términos no envía nada', (tester) async {
      final cliente = await _montar(tester, const PantallaRegistrarOng());

      await completar(tester);
      await enviar(tester);

      expect(find.textContaining('Debe aceptar los términos'), findsOneWidget);
      expect(cliente.envios, isEmpty);
    });

    testWidgets('el error de un campo se muestra junto a ese campo', (tester) async {
      await _montar(
        tester,
        const PantallaRegistrarOng(),
        errorAlEnviar: const ErrorApi(
          mensaje: 'Revise los datos marcados.',
          errores: [(campo: 'ruc', mensaje: 'El digito verificador del RUC no coincide.')],
        ),
      );

      await completar(tester);
      await tester.tap(find.text('Acepto los términos de adhesión'));
      await enviar(tester);

      expect(find.text('El digito verificador del RUC no coincide.'), findsOneWidget);
    });
  });
}
