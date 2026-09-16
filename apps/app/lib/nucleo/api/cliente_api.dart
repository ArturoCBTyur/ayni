import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config.dart';

/// Error de API ya traducido a lenguaje comprensible.
///
/// RF-PS-05 pide mensajes que expliquen que ocurrio y como resolverlo, asi
/// que el mensaje tecnico nunca llega crudo a la interfaz.
class ErrorApi implements Exception {
  const ErrorApi({required this.mensaje, this.codigo, this.detalles});

  final String mensaje;
  final int? codigo;
  final Map<String, dynamic>? detalles;

  @override
  String toString() => mensaje;
}

/// Cliente HTTP compartido.
///
/// `withCredentials` es indispensable: el refresh token viaja en una cookie
/// httpOnly emitida por el backend (RNF-02), no en almacenamiento del
/// navegador, que en web no es seguro.
class ClienteApi {
  ClienteApi() : _dio = Dio(BaseOptions(baseUrl: Config.apiBaseUrl)) {
    _dio.options
      ..connectTimeout = const Duration(seconds: 10)
      ..receiveTimeout = const Duration(seconds: 30)
      ..headers = {'Accept': 'application/json'}
      ..extra = {'withCredentials': true};

    _dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (opciones, handler) {
          if (_tokenAcceso != null) {
            opciones.headers['Authorization'] = 'Bearer $_tokenAcceso';
          }
          handler.next(opciones);
        },
        onError: (e, handler) => handler.reject(
          DioException(
            requestOptions: e.requestOptions,
            error: _traducir(e),
            type: e.type,
            response: e.response,
          ),
        ),
      ),
    );
  }

  final Dio _dio;

  /// El access token vive solo en memoria y se pierde al recargar: es
  /// deliberado. El refresh en cookie httpOnly reconstruye la sesion.
  String? _tokenAcceso;

  void establecerToken(String? token) => _tokenAcceso = token;

  Future<Map<String, dynamic>> obtener(String ruta, {Map<String, dynamic>? consulta}) async {
    final r = await _dio.get<Map<String, dynamic>>(ruta, queryParameters: consulta);
    return r.data ?? <String, dynamic>{};
  }

  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    final r = await _dio.post<Map<String, dynamic>>(ruta, data: cuerpo);
    return r.data ?? <String, dynamic>{};
  }

  ErrorApi _traducir(DioException e) {
    if (e.type == DioExceptionType.connectionError ||
        e.type == DioExceptionType.connectionTimeout) {
      return const ErrorApi(
        mensaje: 'No se pudo contactar al servidor. Revise su conexion e intente de nuevo.',
      );
    }

    final estado = e.response?.statusCode;
    final datos = e.response?.data;
    final mensajeServidor = datos is Map<String, dynamic> ? datos['message'] : null;

    final mensaje = switch (estado) {
      401 => 'Su sesion expiro. Vuelva a iniciar sesion.',
      403 => 'Su rol no tiene permiso para esta accion.',
      404 => 'No encontramos lo que buscaba.',
      429 => 'Demasiados intentos. Espere un momento antes de reintentar.',
      _ when estado != null && estado >= 500 =>
        'Tuvimos un problema procesando su solicitud. Ya quedo registrado; intente en unos minutos.',
      _ => mensajeServidor is String
          ? mensajeServidor
          : mensajeServidor is List && mensajeServidor.isNotEmpty
              ? mensajeServidor.first.toString()
              : 'Ocurrio un error inesperado.',
    };

    return ErrorApi(
      mensaje: mensaje,
      codigo: estado,
      detalles: datos is Map<String, dynamic> ? datos : null,
    );
  }
}

final clienteApiProvider = Provider<ClienteApi>((ref) => ClienteApi());
