// Fotos y comprobantes segun quien mira.
//
// Que archivo recibe cada rol lo decide la API; lo que se fija aqui es que
// la aplicacion lo muestre, y que diga por que no hay foto cuando no la hay.
// Antes ninguna pantalla mostraba una sola imagen: el donante leia "incluye
// evidencia visual" y no la veia, y la ONG no podia abrir su propio gasto.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/comun/visor_archivo.dart';
import 'package:trazabilidad_radical/funciones/auditor/pantalla_revision.dart';
import 'package:trazabilidad_radical/funciones/donante/pantalla_campana.dart';
import 'package:trazabilidad_radical/funciones/ong/pantalla_detalle_gasto.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';
import 'package:trazabilidad_radical/nucleo/sesion.dart';

const _urlFirmada = '/api/v1/almacenamiento/evidencias/e1.jpg?token=abc';

Map<String, dynamic> _gasto({required List<Map<String, dynamic>> evidencias}) => {
      'id': 'g1',
      'estado': 'EN_REVISION',
      'monto': '80.00',
      'montoAprobado': null,
      'concepto': 'cirugía de un perro atropellado',
      'proveedor': 'Clinica Veterinaria San Roque',
      'fechaGasto': '2026-10-07T00:00:00.000Z',
      'capturadoEn': null,
      'fondo': {'id': 'f1', 'nombre': 'Atención veterinaria'},
      'campana': 'Rescate de perros',
      'comprobante': {
        'tipo': 'BOLETA',
        'serie': 'B001',
        'numero': '004521',
        'rucEmisor': '20601030579',
        'fechaEmision': '2026-10-07T00:00:00.000Z',
        'total': '80.00',
        'validezCpe': 'VALIDO',
        'url': '/api/v1/almacenamiento/comprobantes/c1.jpg?token=abc',
        'mime': 'image/jpeg',
      },
      'evidencias': evidencias,
      'analisis': null,
      'alertasAbiertas': 0,
    };

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso(this.respuestas);

  final Map<String, Map<String, dynamic>> respuestas;

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async =>
      respuestas[ruta] ?? const {};

  @override
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async =>
      const [];
}

class _SesionDonante extends SesionNotifier {
  @override
  EstadoSesion build() => const EstadoSesion(
        usuario: UsuarioSesion(
          id: 'u1',
          correo: 'donante@prueba.pe',
          nombres: 'Rosa',
          apellidos: 'Donante',
          roles: ['DONANTE'],
        ),
      );
}

Future<void> _montar(
  WidgetTester tester,
  Widget pantalla,
  Map<String, Map<String, dynamic>> respuestas,
) async {
  await tester.binding.setSurfaceSize(const Size(1200, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(
    ProviderScope(
      overrides: [
        clienteApiProvider.overrideWithValue(_ClienteApiFalso(respuestas)),
        sesionProvider.overrideWith(_SesionDonante.new),
      ],
      child: MaterialApp(home: pantalla),
    ),
  );
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  test('la URL firmada se resuelve contra el origen de la API', () {
    expect(
      urlDeArchivo(_urlFirmada),
      'http://localhost:3000/api/v1/almacenamiento/evidencias/e1.jpg?token=abc',
    );
    expect(urlDeArchivo('https://s3.example/x.jpg'), 'https://s3.example/x.jpg');
  });

  group('la ONG en el detalle de su gasto', () {
    testWidgets('una foto con personas sin difuminar ofrece difuminarla', (tester) async {
      await _montar(tester, const PantallaDetalleGasto(gastoId: 'g1'), {
        '/gastos/g1': _gasto(evidencias: [
          {
            'id': 'e1',
            'contienePersonas': true,
            'anonimizada': false,
            'url': null,
            'urlParaDifuminar': _urlFirmada,
          },
        ]),
      });

      expect(find.text('El donante todavía no puede verla'), findsOneWidget);
      expect(find.text('Difuminar rostros'), findsOneWidget);
      // Su propio comprobante, con la imagen.
      expect(find.text('Comprobante B001-004521'), findsOneWidget);
    });

    testWidgets('una foto ya publicable no pide nada', (tester) async {
      await _montar(tester, const PantallaDetalleGasto(gastoId: 'g1'), {
        '/gastos/g1': _gasto(evidencias: [
          {
            'id': 'e1',
            'contienePersonas': false,
            'anonimizada': true,
            'url': _urlFirmada,
            'urlParaDifuminar': null,
          },
        ]),
      });

      expect(find.text('Difuminar rostros'), findsNothing);
      expect(find.text('Sin personas: se publica tal cual.'), findsOneWidget);
    });
  });

  testWidgets('el auditor ve los originales y sabe cuales tienen rostros', (tester) async {
    await _montar(tester, const PantallaRevision(gastoId: 'g1'), {
      '/gastos/g1': _gasto(evidencias: [
        {
          'id': 'e1',
          'contienePersonas': true,
          'anonimizada': false,
          'url': _urlFirmada,
          'urlParaDifuminar': null,
        },
      ]),
    });

    expect(find.text('Los archivos originales'), findsOneWidget);
    expect(find.text('Evidencia 1 · con personas, todavía sin difuminar'), findsOneWidget);
  });

  testWidgets('la ficha de la causa muestra en qué se usó lo ejecutado', (tester) async {
    await _montar(tester, const PantallaCampana(slug: 'rescate'), {
      '/causas/rescate': {
        'titulo': 'Rescate de perros en Huánuco',
        'descripcion': 'Atención veterinaria para perros rescatados.',
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
            'categoriaGasto': 'ATENCION_VETERINARIA',
            'recaudado': '300.00',
            'retenido': '200.00',
            'ejecutado': '80.00',
            'avance': 30,
            'impacto': {
              'unidad': 'animales atendidos',
              'unidades': 4,
              'gastosConUnidades': 1,
              'gastosAprobados': 1,
              'costoPorUnidad': '20.00',
            },
            'gastosVerificados': [
              {
                'id': 'g1',
                'concepto': 'cirugía de un perro atropellado',
                'proveedor': 'Clinica Veterinaria San Roque',
                'monto': '80.00',
                'fechaGasto': '2026-10-07T00:00:00.000Z',
                'comprobante': 'BOLETA B001-004521',
                'evidencias': [_urlFirmada],
              },
            ],
          },
        ],
      },
    });

    expect(find.text('En qué se usó: 1 gasto verificado'), findsOneWidget);
    // RF-SO-09: el costo por unidad, y sobre cuantos gastos se calculo.
    expect(
      find.text('4 animales atendidos · S/ 20.00 cada uno, según 1 de 1 gastos verificados'),
      findsOneWidget,
    );

    await tester.tap(find.text('En qué se usó: 1 gasto verificado'));
    await tester.pumpAndSettle();

    expect(find.text('cirugía de un perro atropellado'), findsOneWidget);
    expect(find.textContaining('BOLETA B001-004521'), findsOneWidget);
  });
}
