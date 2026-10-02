// Pruebas de la vista de revision del auditor, en lo que toca al lector de
// comprobantes (RF-IA-02).
//
// Lo que se comprueba no es que la tarjeta dibuje: es que ponga delante del
// auditor el dato que le hace cambiar de decision. Un importe leido del papel
// que no coincide con el declarado estaba antes narrado dentro de un motivo,
// perdido entre quince lineas de comprobaciones que salieron bien. Si la
// tarjeta deja de mostrarlo, el auditor aprueba un gasto que el modelo habia
// marcado, y eso no lo ve ninguna prueba del backend.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/funciones/auditor/pantalla_revision.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';
import 'package:trazabilidad_radical/nucleo/sesion.dart';

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso(this.porRuta);

  final Map<String, Map<String, dynamic>> porRuta;

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async {
    final respuesta = porRuta[ruta];
    if (respuesta == null) throw StateError('Ruta no simulada en la prueba: $ruta');
    return respuesta;
  }
}

class _SesionAuditor extends SesionNotifier {
  @override
  EstadoSesion build() => const EstadoSesion(
        usuario: UsuarioSesion(
          id: 'u1',
          correo: 'auditor@prueba.pe',
          nombres: 'Aldo',
          apellidos: 'Auditor',
          roles: ['AUDITOR'],
        ),
      );
}

/// El gasto tal como lo devuelve `GET /gastos/:id`.
///
/// Por defecto el comprobante declara S/ 185 --lo que el operador tecleo-- y
/// cada prueba decide que leyo el papel. Se altera un campo a la vez, para que
/// lo que falle señale una causa y no varias.
Map<String, dynamic> _gasto({
  Map<String, dynamic>? datosExtraidos,
  String totalDeclarado = '185.00',
}) =>
    <String, dynamic>{
      'id': 'g1',
      'estado': 'EN_REVISION',
      'monto': '185.00',
      'montoAprobado': null,
      'concepto': 'vacunacion antirrabica de doce gatos',
      'proveedor': 'Clinica Veterinaria San Roque',
      'fechaGasto': '2026-09-14T00:00:00.000Z',
      'capturadoEn': '2026-09-14T15:00:00.000Z',
      'fondo': {'id': 'f1', 'nombre': 'Atencion veterinaria'},
      'campana': 'Rescate animal en Huanuco',
      'comprobante': {
        'tipo': 'BOLETA',
        'serie': 'B001',
        'numero': '005288',
        'rucEmisor': '20601030579',
        'fechaEmision': '2026-09-14T00:00:00.000Z',
        'total': totalDeclarado,
        'validezCpe': 'VALIDO',
        'url': null,
      },
      'evidencias': <Map<String, dynamic>>[],
      'analisis': {
        'nivel': 'MEDIO',
        'scoreFinal': 68.47,
        'explicacion': {'resumen': 'Hay observaciones.', 'motivos': <Map<String, dynamic>>[]},
        'datosExtraidos': datosExtraidos,
        'creadoEn': '2026-09-15T10:00:00.000Z',
      },
      'alertasAbiertas': 0,
    };

Map<String, dynamic> _leido({
  String? ruc = '20601030579',
  String? serie = 'B001',
  String? numero = '005288',
  String? fecha = '2026-09-14T00:00:00.000Z',
  num? total = 158,
}) =>
    <String, dynamic>{
      'fuente': 'ocr',
      'tipo': 'BOLETA',
      'rucEmisor': ruc,
      'serie': serie,
      'numero': numero,
      'fechaEmision': fecha,
      'subtotal': 133.9,
      'igv': 24.1,
      'total': total,
    };

Widget _envolver(Map<String, dynamic> gasto) => ProviderScope(
      overrides: [
        clienteApiProvider.overrideWithValue(_ClienteApiFalso({'/gastos/g1': gasto})),
        sesionProvider.overrideWith(_SesionAuditor.new),
      ],
      child: const MaterialApp(home: PantallaRevision(gastoId: 'g1')),
    );

Future<void> _mostrar(WidgetTester tester, Map<String, dynamic> gasto) async {
  await tester.binding.setSurfaceSize(const Size(1200, 2400));
  addTearDown(() => tester.binding.setSurfaceSize(null));
  await tester.pumpWidget(_envolver(gasto));
  await tester.pumpAndSettle();
}

void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  testWidgets('el importe leido del papel se muestra, no el declarado', (tester) async {
    // El caso que justifica todo el lector: se declaro S/ 185 sobre una
    // boleta de S/ 158.
    await _mostrar(tester, _gasto(datosExtraidos: _leido(total: 158)));

    expect(find.text('Lo que el modelo leyó en el papel'), findsOneWidget);
    expect(find.text('S/ 158.00'), findsOneWidget);
    // Y se dice explicitamente contra que no coincide, porque "S/ 158.00"
    // solo no le dice al auditor que hay un problema.
    expect(find.text('se declaró S/ 185.00'), findsOneWidget);
  });

  testWidgets('cuando el papel y lo declarado coinciden no se grita', (tester) async {
    await _mostrar(tester, _gasto(datosExtraidos: _leido(total: 185)));

    expect(find.textContaining('se declaró'), findsNothing);
  });

  testWidgets('un campo que no se pudo leer se declara, no se inventa', (tester) async {
    await _mostrar(tester, _gasto(datosExtraidos: _leido(ruc: null)));

    expect(find.text('no se pudo leer'), findsOneWidget);
    // Y no se marca como discrepancia: no verificar no es contradecir.
    expect(find.text('se declaró 20601030579'), findsNothing);
  });

  testWidgets('los ceros a la izquierda del numero no son una discrepancia', (tester) async {
    // El emisor imprime "5288" y se declaro "005288": mismo documento.
    await _mostrar(tester, _gasto(datosExtraidos: _leido(numero: '5288')));

    expect(find.textContaining('se declaró B001-005288'), findsNothing);
  });

  testWidgets('sin lectura se avisa que los datos no se contrastaron', (tester) async {
    await _mostrar(
      tester,
      _gasto(datosExtraidos: <String, dynamic>{'fuente': 'declarado', 'total': 185}),
    );

    expect(find.textContaining('no pudo leer el comprobante'), findsOneWidget);
    expect(find.text('Lo que el modelo leyó en el papel'), findsNothing);
  });

  testWidgets('un analisis sin datos extraidos no rompe la pantalla', (tester) async {
    // Los analisis que ya estaban en la base antes de que el campo existiera.
    await _mostrar(tester, _gasto(datosExtraidos: null));

    expect(find.text('Revisar gasto'), findsOneWidget);
    expect(find.text('Lo que el modelo leyó en el papel'), findsNothing);
  });
}
