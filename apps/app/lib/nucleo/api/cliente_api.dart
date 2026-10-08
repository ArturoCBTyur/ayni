import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../config.dart';

/// Error de API ya traducido a lenguaje comprensible.
///
/// RF-PS-05 pide mensajes que expliquen que ocurrio y como resolverlo, asi
/// que el mensaje tecnico nunca llega crudo a la interfaz.
class ErrorApi implements Exception {
  const ErrorApi({required this.mensaje, this.codigo, this.errores});

  final String mensaje;
  final int? codigo;

  /// Errores por campo, cuando la validacion los detalla.
  final List<({String campo, String mensaje})>? errores;

  @override
  String toString() => mensaje;
}

/// Cliente HTTP compartido.
///
/// `withCredentials` es indispensable: el refresh token viaja en una cookie
/// httpOnly emitida por el backend (RNF-02), no en almacenamiento del
/// navegador, que en web no es seguro.
class ClienteApi {
  /// `urlBase` solo existe para las pruebas; la aplicacion usa la de [Config].
  ClienteApi({String? urlBase}) : _dio = Dio(BaseOptions(baseUrl: urlBase ?? Config.apiBaseUrl)) {
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
    final r = await _llamar(() => _dio.get<dynamic>(ruta, queryParameters: consulta));
    return _comoMapa(r.data);
  }

  /// Para endpoints que devuelven una lista en la raiz.
  Future<List<Map<String, dynamic>>> obtenerLista(
    String ruta, {
    Map<String, dynamic>? consulta,
  }) async {
    final r = await _llamar(() => _dio.get<dynamic>(ruta, queryParameters: consulta));
    return _comoLista(r.data);
  }

  Future<Map<String, dynamic>> enviar(String ruta, {Object? cuerpo}) async {
    final r = await _llamar(() => _dio.post<dynamic>(ruta, data: cuerpo));
    return _comoMapa(r.data);
  }

  Future<Map<String, dynamic>> actualizar(String ruta, {Object? cuerpo}) async {
    final r = await _llamar(() => _dio.patch<dynamic>(ruta, data: cuerpo));
    return _comoMapa(r.data);
  }

  /// Para endpoints que devuelven texto plano, como las exportaciones CSV.
  Future<String> obtenerTexto(String ruta, {Map<String, dynamic>? consulta}) async {
    final r = await _llamar(
      () => _dio.get<dynamic>(
        ruta,
        queryParameters: consulta,
        options: Options(responseType: ResponseType.plain),
      ),
    );
    return r.data?.toString() ?? '';
  }

  /// Sube un archivo binario a una URL firmada, como haria contra S3.
  Future<void> subirArchivo(String urlFirmada, List<int> bytes, String mime) async {
    // La URL firmada ya trae su token; el prefijo de la API no se repite.
    final ruta = urlFirmada.replaceFirst(RegExp(r'^/api/v\d+'), '');
    await _llamar(
      () => _dio.put<dynamic>(
        ruta,
        data: Stream.fromIterable([bytes]),
        options: Options(
          headers: {'Content-Type': mime, 'Content-Length': bytes.length},
        ),
      ),
    );
  }

  /// Hace la peticion y, si falla, lanza el [ErrorApi] y no la DioException.
  ///
  /// El interceptor traduce el error, pero Dio lo entrega envuelto: lo que
  /// sale de `_dio.get` es una DioException con el ErrorApi en `.error`. Sin
  /// desenvolverlo aqui, todo `on ErrorApi catch` de las pantallas es codigo
  /// muerto, y el error escapa sin atrapar hasta la consola del navegador.
  Future<Response<dynamic>> _llamar(Future<Response<dynamic>> Function() peticion) async {
    try {
      return await peticion();
    } on DioException catch (e) {
      final error = e.error;
      throw error is ErrorApi ? error : _traducir(e);
    }
  }

  Map<String, dynamic> _comoMapa(dynamic datos) {
    if (datos is Map<String, dynamic>) return datos;
    if (datos == null || datos == '') return <String, dynamic>{};
    return <String, dynamic>{'datos': datos};
  }

  List<Map<String, dynamic>> _comoLista(dynamic datos) {
    if (datos is List) return datos.cast<Map<String, dynamic>>();
    return const [];
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
    final cuerpo = datos is Map<String, dynamic> ? datos : null;

    // El backend detalla los errores de validacion por campo; se conservan
    // para que el formulario pueda senalar exactamente donde esta el problema.
    final errores = (cuerpo?['errores'] as List<dynamic>?)
        ?.map((e) => (
              campo: (e as Map<String, dynamic>)['campo'] as String,
              mensaje: e['mensaje'] as String,
            ))
        .toList();

    final mensajeServidor = cuerpo?['message'];

    final mensaje = switch (estado) {
      401 => mensajeServidor is String ? mensajeServidor : 'Su sesion expiro. Vuelva a iniciar sesion.',
      403 => mensajeServidor is String ? mensajeServidor : 'Su rol no tiene permiso para esta accion.',
      404 => mensajeServidor is String ? mensajeServidor : 'No encontramos lo que buscaba.',
      429 => 'Demasiados intentos. Espere un momento antes de reintentar.',
      _ when estado != null && estado >= 500 =>
        'Tuvimos un problema procesando su solicitud. Ya quedo registrado; intente en unos minutos.',
      _ => mensajeServidor is String
          ? mensajeServidor
          : mensajeServidor is List && mensajeServidor.isNotEmpty
              ? mensajeServidor.first.toString()
              : 'Ocurrio un error inesperado.',
    };

    return ErrorApi(mensaje: mensaje, codigo: estado, errores: errores);
  }
}

final clienteApiProvider = Provider<ClienteApi>((ref) => ClienteApi());
