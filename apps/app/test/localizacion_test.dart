// Pruebas de la localizacion de los widgets de Material (RNF-20).
//
// Existen por un fallo que no se veia: los textos propios de la aplicacion
// siempre estuvieron en español, pero los de Material --los botones de un
// dialogo, los meses de un calendario, las etiquetas que anuncia un lector de
// pantalla-- salian en ingles, porque faltaban los delegados y MaterialApp
// solo ofrece `DefaultMaterialLocalizations`, que es monolingue.
//
// Se descubrio al agregar el selector de la fecha de emision del comprobante:
// pedirle `Locale('es')` sin delegado que sepa producirlo no degrada a ingles,
// **revienta**. Y habria reventado en vivo, en el formulario que el operador
// usa para registrar un gasto.
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trazabilidad_radical/main.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';

/// Sin red: al abrir, la aplicacion intenta restaurar la sesion desde la
/// cookie de refresh, y un cliente de verdad deja una peticion en vuelo que la
/// prueba no puede cerrar. Falla rapido y el arranque termina.
class _ClienteApiSinRed extends ClienteApi {
  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async =>
      throw const ErrorApi(mensaje: 'sin red en la prueba');

  @override
  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async =>
      throw const ErrorApi(mensaje: 'sin red en la prueba');
}

void main() {
  testWidgets('la aplicacion declara es_PE y Material lo resuelve', (tester) async {
    await tester.pumpWidget(
      ProviderScope(
        overrides: [clienteApiProvider.overrideWithValue(_ClienteApiSinRed())],
        child: const AppTrazabilidadRadical(),
      ),
    );
    await tester.pumpAndSettle();

    final contexto = tester.element(find.byType(Navigator).first);

    expect(Localizations.localeOf(contexto).languageCode, 'es');
    // Y que el delegado de Material haya resuelto de verdad, no que la
    // aplicacion lo pida y Flutter caiga al ingles por su cuenta.
    expect(MaterialLocalizations.of(contexto).cancelButtonLabel, 'Cancelar');
  });

  testWidgets('el selector de fecha abre en español y no revienta', (tester) async {
    // El escenario exacto del formulario de registro de gasto.
    await tester.pumpWidget(
      MaterialApp(
        localizationsDelegates: const [
          GlobalMaterialLocalizations.delegate,
          GlobalWidgetsLocalizations.delegate,
          GlobalCupertinoLocalizations.delegate,
        ],
        supportedLocales: const [Locale('es'), Locale('es', 'PE')],
        locale: const Locale('es', 'PE'),
        home: Builder(
          builder: (contexto) => Scaffold(
            body: TextButton(
              onPressed: () => showDatePicker(
                context: contexto,
                initialDate: DateTime(2026, 10, 6),
                firstDate: DateTime(2025),
                lastDate: DateTime(2026, 10, 6),
                helpText: 'Fecha impresa en el comprobante',
                locale: const Locale('es'),
              ),
              child: const Text('fecha'),
            ),
          ),
        ),
      ),
    );

    await tester.tap(find.text('fecha'));
    await tester.pumpAndSettle();

    expect(find.text('Fecha impresa en el comprobante'), findsOneWidget);
    expect(find.text('Cancelar'), findsOneWidget);
    // Octubre en español, no "October".
    expect(find.textContaining('octubre', findRichText: true), findsWidgets);
  });
}
