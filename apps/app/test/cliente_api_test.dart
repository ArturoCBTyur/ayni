// El contrato del cliente: si una peticion falla, lo que se lanza es un
// ErrorApi. Las pantallas lo atrapan con `on ErrorApi catch`, y los clientes
// falsos de las demas pruebas lo lanzan asi, de modo que si el cliente real
// dejara escapar la DioException, todas esas pruebas seguirian en verde
// mientras la aplicacion acumula errores sin atrapar en la consola.

import 'dart:convert';
import 'dart:io';

import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  // Puerto 9 (discard): nada escucha ahi, la conexion se rechaza al instante.
  final cliente = ClienteApi(urlBase: 'http://127.0.0.1:9');

  test('sin servidor, el cliente lanza ErrorApi y no DioException', () async {
    await expectLater(
      cliente.enviar('/notificaciones/x/leida'),
      throwsA(
        isA<ErrorApi>().having((e) => e.mensaje, 'mensaje', contains('No se pudo contactar')),
      ),
    );
  });

  test('vale para todos los metodos', () async {
    await expectLater(cliente.obtener('/x'), throwsA(isA<ErrorApi>()));
    await expectLater(cliente.obtenerLista('/x'), throwsA(isA<ErrorApi>()));
    await expectLater(cliente.actualizar('/x'), throwsA(isA<ErrorApi>()));
    await expectLater(cliente.subirArchivo('/x', [1, 2, 3], 'image/jpeg'), throwsA(isA<ErrorApi>()));
    await expectLater(cliente.obtenerBytes('/x'), throwsA(isA<ErrorApi>()));
  });

  group('contra un servidor local', () {
    late HttpServer servidor;
    late ClienteApi local;

    setUp(() async {
      servidor = await HttpServer.bind(InternetAddress.loopbackIPv4, 0);
      servidor.listen((peticion) {
        final respuesta = peticion.response;
        if (peticion.uri.path == '/csv') {
          respuesta.headers.contentType = ContentType('text', 'csv', charset: 'utf-8');
          respuesta.add(utf8.encode('\uFEFFsecuencia,monto\r\n'));
        } else {
          respuesta.statusCode = 403;
          respuesta.headers.contentType = ContentType.json;
          respuesta.write(jsonEncode({'message': 'Los estados los ven su ONG y la auditoria.'}));
        }
        respuesta.close();
      });
      local = ClienteApi(urlBase: 'http://127.0.0.1:${servidor.port}');
    });

    tearDown(() => servidor.close(force: true));

    test('una descarga binaria que falla conserva el mensaje del servidor', () async {
      // El error llega como bytes, igual que el archivo que se pidio. Sin
      // decodificarlo, la pantalla mostraria el mensaje generico del 403.
      await expectLater(
        local.obtenerBytes('/estado'),
        throwsA(
          isA<ErrorApi>()
              .having((e) => e.mensaje, 'mensaje', 'Los estados los ven su ONG y la auditoria.')
              .having((e) => e.codigo, 'codigo', 403),
        ),
      );
    });

    test('el cliente quita el BOM que pone la API al decodificar el CSV', () async {
      // Por eso la descarga web lo vuelve a poner: sin el, Excel abre el CSV
      // como Latin-1 y rompe las tildes.
      final csv = await local.obtenerTexto('/csv');
      expect(csv.startsWith('\uFEFF'), isFalse);
      expect(csv, startsWith('secuencia,monto'));
    });
  });
}
