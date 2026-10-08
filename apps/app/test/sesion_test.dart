// Restaurar la sesion al recargar la pagina.
//
// El refresco puede devolver un token de enrolamiento: la cuenta tiene un rol
// que exige segundo factor y todavia no lo configuro. La aplicacion tiene que
// llevarla a configurarlo, no tratarla como sesion plena; antes ni siquiera
// miraba ese dato, y pedia el perfil con un token que no lo abria.
import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trazabilidad_radical/nucleo/api/cliente_api.dart';
import 'package:trazabilidad_radical/nucleo/sesion.dart';

String _token(Map<String, dynamic> carga) {
  String parte(Map<String, dynamic> m) => base64Url.encode(utf8.encode(jsonEncode(m)));
  return '${parte({'alg': 'HS256'})}.${parte(carga)}.firma';
}

class _ClienteApiFalso extends ClienteApi {
  _ClienteApiFalso({required this.mfaPendiente});

  final bool mfaPendiente;
  final pedidas = <String>[];

  @override
  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    pedidas.add(ruta);
    return {
      'tokenAcceso': _token({
        'sub': 'u1',
        'correo': 'nueva.ong@prueba.pe',
        'roles': ['DONANTE', 'ONG_ADMIN'],
      }),
      'expiraEnSegundos': 900,
      'mfaPendiente': mfaPendiente,
    };
  }

  @override
  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async {
    pedidas.add(ruta);
    return {
      'id': 'u1',
      'correo': 'nueva.ong@prueba.pe',
      'nombres': 'Rosa',
      'apellidos': 'Chavez',
      'roles': [
        {'codigo': 'DONANTE'},
      ],
    };
  }
}

void main() {
  test('con el segundo factor pendiente, restaurar lleva a configurarlo', () async {
    final cliente = _ClienteApiFalso(mfaPendiente: true);
    final contenedor = ProviderContainer(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
    );
    addTearDown(contenedor.dispose);

    await contenedor.read(sesionProvider.notifier).restaurar();
    final estado = contenedor.read(sesionProvider);

    expect(estado.mfaPendiente, isTrue);
    expect(estado.autenticado, isFalse);
    expect(estado.usuario?.roles, ['DONANTE', 'ONG_ADMIN']);
    // El perfil no se pide: el token de enrolamiento no lo abre.
    expect(cliente.pedidas, isNot(contains('/identidad/perfil')));
  });

  test('sin pendiente, restaurar trae el perfil completo', () async {
    final cliente = _ClienteApiFalso(mfaPendiente: false);
    final contenedor = ProviderContainer(
      overrides: [clienteApiProvider.overrideWithValue(cliente)],
    );
    addTearDown(contenedor.dispose);

    await contenedor.read(sesionProvider.notifier).restaurar();
    final estado = contenedor.read(sesionProvider);

    expect(estado.autenticado, isTrue);
    expect(estado.usuario?.nombres, 'Rosa');
  });
}
