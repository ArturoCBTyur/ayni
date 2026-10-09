// RF-CF-08 y RF-CF-09 · Estados mensuales en la app: la lista de meses con su
// cierre, las cifras de un mes, sus descargas y el aviso de cierre a la ONG.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/comun/estados_mensuales.dart';
import 'package:trazabilidad_radical/funciones/ong/pantalla_fondos.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';

const _hash = 'ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12cd34ef56ab12';

Map<String, dynamic> _estado({bool vigente = true}) => {
      'estado': {
        'actividades': {
          'donacionesBrutas': '400.00',
          'comisiones': '16.26',
          'liberadoNeto': '100.00',
        },
        'retenido': {'inicial': '0.00', 'final': '283.74', 'variacion': '283.74'},
      },
      'cerrado': true,
      'enCurso': false,
      'cierre': {'hash': _hash, 'vigente': vigente},
      'cadena': {'integra': true, 'movimientos': 10},
    };

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({this.vigente = true});

  final bool vigente;
  final descargas = <({String ruta, Map<String, dynamic>? consulta})>[];
  final envios = <String>[];
  var avisoLeido = false;

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async {
    if (ruta == '/analitica/estados/fondos/f1/periodos') {
      return {
        'fondo': {'id': 'f1', 'nombre': 'Atención veterinaria', 'ongId': 'ong-1'},
        'periodos': [
          {'codigo': '2026-10', 'nombre': 'octubre de 2026', 'enCurso': true, 'cerrado': false},
          {
            'codigo': '2026-09',
            'nombre': 'septiembre de 2026',
            'enCurso': false,
            'cerrado': true,
            'hash': _hash,
            'cerradoEn': '2026-10-01T07:00:00.000Z',
          },
          {'codigo': '2026-08', 'nombre': 'agosto de 2026', 'enCurso': false, 'cerrado': false},
        ],
      };
    }
    if (ruta == '/analitica/estados/fondos/f1' && consulta?['periodo'] == '2026-09') {
      return _estado(vigente: vigente);
    }
    throw const ErrorApi(mensaje: 'Ruta no prevista en la prueba.');
  }

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      switch (ruta) {
        '/ongs/mias/listado' => [
            {
              'id': 'ong-1',
              'razonSocial': 'Huellas del Ande',
              'ruc': '20601030579',
              'estadoVerificacion': 'VERIFICADA',
              'puntajeConfianza': '72.00',
              'cargo': 'OPERADOR',
            },
          ],
        '/ongs/ong-1/fondos' => [
            {
              'titulo': 'Rescate de invierno',
              'estado': 'ACTIVA',
              'fondos': [
                {
                  'id': 'f1',
                  'nombre': 'Atención veterinaria',
                  'categoriaGasto': 'ATENCION_VETERINARIA',
                  'recaudado': '335.96',
                  'retenido': '217.96',
                  'ejecutado': '118.00',
                  'meta': '5000.00',
                  'avance': 7,
                },
              ],
            },
          ],
        '/notificaciones' when !avisoLeido => [
            {
              'id': 'n1',
              'tipo': 'CIERRE_MENSUAL',
              'asunto': 'Estados de septiembre de 2026 listos',
              'narrativa': 'Se cerro septiembre de 2026 en 1 fondo(s).',
            },
            // Una narrativa de impacto no es un aviso de cierre: no va aqui.
            {'id': 'n2', 'tipo': 'IMPACTO', 'asunto': 'Su aporte se uso', 'narrativa': '...'},
          ],
        _ => const [],
      };

  @override
  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    envios.add(ruta);
    if (ruta == '/notificaciones/n1/leida') avisoLeido = true;
    return const {};
  }

  @override
  Future<List<int>> obtenerBytes(String ruta, {Map<String, dynamic>? consulta}) async {
    descargas.add((ruta: ruta, consulta: consulta));
    return const [0x25, 0x50, 0x44, 0x46];
  }
}

Future<_ClienteApiFalso> _montar(
  WidgetTester tester,
  Widget pantalla, {
  bool vigente = true,
}) async {
  await tester.binding.setSurfaceSize(const Size(1000, 1600));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  final cliente = _ClienteApiFalso(vigente: vigente);
  await tester.pumpWidget(
    ProviderScope(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
      child: MaterialApp(home: Scaffold(body: pantalla)),
    ),
  );
  await tester.pumpAndSettle();
  return cliente;
}

const _hoja = HojaEstadosMensuales(fondoId: 'f1', nombreFondo: 'Atención veterinaria');

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  testWidgets('lista los meses del fondo con su estado de cierre', (tester) async {
    await _montar(tester, _hoja);

    expect(find.text('Octubre de 2026'), findsOneWidget);
    expect(find.text('En curso: las cifras pueden cambiar'), findsOneWidget);
    expect(find.textContaining('Cerrado el'), findsOneWidget);
    expect(find.textContaining('hash ab12cd34ef56…'), findsOneWidget);
    expect(find.text('Terminado, todavía sin cierre'), findsOneWidget);
  });

  testWidgets('al abrir un mes cerrado muestra sus cifras', (tester) async {
    await _montar(tester, _hoja);

    await tester.tap(find.text('Septiembre de 2026'));
    await tester.pumpAndSettle();

    expect(find.text('S/ 400.00'), findsOneWidget);
    expect(find.text('S/ 283.74'), findsOneWidget);
    expect(find.textContaining('El libro ya no da estas cifras'), findsNothing);
  });

  testWidgets('avisa si el libro ya no sostiene el cierre', (tester) async {
    await _montar(tester, _hoja, vigente: false);

    await tester.tap(find.text('Septiembre de 2026'));
    await tester.pumpAndSettle();

    expect(find.textContaining('El libro ya no da estas cifras'), findsOneWidget);
  });

  testWidgets('descarga el Excel, el PDF y el PLE del mes que se abrio', (tester) async {
    final cliente = await _montar(tester, _hoja);

    await tester.tap(find.text('Septiembre de 2026'));
    await tester.pumpAndSettle();

    await tester.tap(find.text('Excel'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('PDF'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('PLE diario (borrador)'));
    await tester.pumpAndSettle();

    expect(cliente.descargas.map((d) => d.ruta).toList(), [
      '/analitica/estados/fondos/f1',
      '/analitica/estados/fondos/f1',
      '/analitica/ple/ongs/ong-1',
    ]);
    expect(cliente.descargas[0].consulta, {'periodo': '2026-09', 'formato': 'xlsx'});
    expect(cliente.descargas[1].consulta, {'periodo': '2026-09', 'formato': 'pdf'});
    expect(cliente.descargas[2].consulta, {'periodo': '2026-09', 'libro': 'diario'});
    // Fuera del navegador no hay donde guardar un binario, y se dice.
    expect(find.text('Este archivo se descarga desde la versión web.'), findsOneWidget);
  });

  testWidgets('el diario PCGE es de la auditoria, no de la ONG', (tester) async {
    await _montar(tester, _hoja);
    expect(find.text('Libro diario en cuentas PCGE (CSV)'), findsNothing);

    await _montar(
      tester,
      const HojaEstadosMensuales(
        fondoId: 'f1',
        nombreFondo: 'Atención veterinaria',
        conDiario: true,
      ),
    );
    expect(find.text('Libro diario en cuentas PCGE (CSV)'), findsOneWidget);
  });

  testWidgets('la ONG ve el aviso de cierre en Fondos y lo da por leido', (tester) async {
    final cliente = await _montar(tester, const PantallaFondos());

    expect(find.text('Estados de septiembre de 2026 listos'), findsOneWidget);
    expect(find.text('Su aporte se uso'), findsNothing);

    await tester.tap(find.text('Entendido'));
    await tester.pumpAndSettle();

    expect(cliente.envios, ['/notificaciones/n1/leida']);
    expect(find.text('Estados de septiembre de 2026 listos'), findsNothing);
  });

  testWidgets('cada fondo abre sus estados mensuales', (tester) async {
    await _montar(tester, const PantallaFondos());

    await tester.tap(find.text('Estados mensuales'));
    await tester.pumpAndSettle();

    expect(find.byType(HojaEstadosMensuales), findsOneWidget);
    expect(find.text('Septiembre de 2026'), findsOneWidget);
  });
}
