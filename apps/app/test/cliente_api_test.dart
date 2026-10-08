// El contrato del cliente: si una peticion falla, lo que se lanza es un
// ErrorApi. Las pantallas lo atrapan con `on ErrorApi catch`, y los clientes
// falsos de las demas pruebas lo lanzan asi, de modo que si el cliente real
// dejara escapar la DioException, todas esas pruebas seguirian en verde
// mientras la aplicacion acumula errores sin atrapar en la consola.

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
  });
}
