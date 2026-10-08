import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'api/cliente_api.dart';

/// Usuario en sesion, tal como lo devuelve el backend.
class UsuarioSesion {
  const UsuarioSesion({
    required this.id,
    required this.correo,
    required this.nombres,
    required this.apellidos,
    required this.roles,
  });

  factory UsuarioSesion.desdeJson(Map<String, dynamic> json) => UsuarioSesion(
        id: json['id'] as String,
        correo: json['correo'] as String,
        nombres: json['nombres'] as String,
        apellidos: json['apellidos'] as String,
        roles: (json['roles'] as List<dynamic>).cast<String>(),
      );

  final String id;
  final String correo;
  final String nombres;
  final String apellidos;
  final List<String> roles;

  String get nombreCompleto => '$nombres $apellidos';

  bool tieneRol(String rol) => roles.contains(rol);

  /// Rol con el que se decide que panel abrir.
  ///
  /// Una persona puede ser donante y a la vez operar una ONG. Se prioriza el
  /// rol de mayor responsabilidad porque es el que trae tareas pendientes;
  /// el panel de donante siempre queda accesible desde el menu.
  String get rolPrincipal {
    for (final rol in ['ADMIN', 'AUDITOR', 'ONG_ADMIN', 'ONG_OPERADOR', 'DONANTE']) {
      if (roles.contains(rol)) return rol;
    }
    return 'DONANTE';
  }
}

/// Estado de la sesion.
class EstadoSesion {
  const EstadoSesion({
    this.usuario,
    this.cargando = false,
    this.mfaPendiente = false,
    this.error,
  });

  final UsuarioSesion? usuario;
  final bool cargando;

  /// El rol exige segundo factor y la cuenta aun no lo configuro. El token
  /// recibido solo abre las rutas de enrolamiento.
  final bool mfaPendiente;
  final String? error;

  bool get autenticado => usuario != null && !mfaPendiente;

  EstadoSesion copiarCon({
    UsuarioSesion? usuario,
    bool? cargando,
    bool? mfaPendiente,
    String? error,
    bool limpiarError = false,
    bool limpiarUsuario = false,
  }) =>
      EstadoSesion(
        usuario: limpiarUsuario ? null : (usuario ?? this.usuario),
        cargando: cargando ?? this.cargando,
        mfaPendiente: mfaPendiente ?? this.mfaPendiente,
        error: limpiarError ? null : (error ?? this.error),
      );
}

/// Controla el inicio y cierre de sesion.
///
/// El access token vive solo en memoria de este notifier: en Flutter Web no
/// hay almacenamiento seguro, y guardarlo en localStorage lo expondria a
/// cualquier script inyectado. Al recargar la pagina se reconstruye la sesion
/// con el refresh token, que viaja en una cookie httpOnly que el JavaScript
/// de la app nunca puede leer.
class SesionNotifier extends Notifier<EstadoSesion> {
  @override
  EstadoSesion build() => const EstadoSesion();

  ClienteApi get _api => ref.read(clienteApiProvider);

  Future<void> iniciarSesion({
    required String correo,
    required String clave,
    String? codigoTotp,
  }) async {
    state = state.copiarCon(cargando: true, limpiarError: true);

    try {
      final respuesta = await _api.enviar('/identidad/sesion', cuerpo: {
        'correo': correo,
        'clave': clave,
        if (codigoTotp != null && codigoTotp.isNotEmpty) 'codigoTotp': codigoTotp,
      });

      _api.establecerToken(respuesta['tokenAcceso'] as String);

      state = EstadoSesion(
        usuario: UsuarioSesion.desdeJson(respuesta['usuario'] as Map<String, dynamic>),
        mfaPendiente: respuesta['mfaPendiente'] as bool? ?? false,
      );
    } on ErrorApi catch (e) {
      state = EstadoSesion(error: e.mensaje);
    } catch (e) {
      state = EstadoSesion(error: e.toString());
    }
  }

  Future<void> registrar({
    required String correo,
    required String clave,
    required String nombres,
    required String apellidos,
    required bool comunicaciones,
  }) async {
    state = state.copiarCon(cargando: true, limpiarError: true);

    try {
      await _api.enviar('/identidad/registro', cuerpo: {
        'correo': correo,
        'clave': clave,
        'nombres': nombres,
        'apellidos': apellidos,
        'consentimientos': {
          // El tratamiento de datos es obligatorio para tener cuenta; las
          // comunicaciones no, y por eso van por separado.
          'tratamientoDatos': true,
          'comunicaciones': comunicaciones,
          'usoImagen': false,
        },
      });

      await iniciarSesion(correo: correo, clave: clave);
    } on ErrorApi catch (e) {
      state = EstadoSesion(error: e.mensaje);
    }
  }

  /// Reconstruye la sesion desde la cookie de refresh, al abrir la app.
  Future<void> restaurar() async {
    state = state.copiarCon(cargando: true);

    try {
      final respuesta = await _api.enviar('/identidad/sesion/refrescar');
      _api.establecerToken(respuesta['tokenAcceso'] as String);
      final mfaPendiente = respuesta['mfaPendiente'] as bool? ?? false;

      // Con el enrolamiento pendiente, el token solo abre las rutas de MFA:
      // el perfil se pediria con un 403. Basta con lo que trae el token.
      if (mfaPendiente) {
        state = EstadoSesion(usuario: _usuarioDelToken(respuesta), mfaPendiente: true);
        return;
      }

      final perfil = await _api.obtener('/identidad/perfil');
      state = EstadoSesion(
        usuario: UsuarioSesion(
          id: perfil['id'] as String,
          correo: perfil['correo'] as String,
          nombres: perfil['nombres'] as String,
          apellidos: perfil['apellidos'] as String,
          roles: (perfil['roles'] as List<dynamic>)
              .map((r) => (r as Map<String, dynamic>)['codigo'] as String)
              .toList(),
        ),
      );
    } catch (_) {
      // Sin sesion previa no es un error: es el caso normal de quien entra
      // por primera vez.
      state = const EstadoSesion();
    }
  }

  /// Usuario a partir de la carga del token de acceso.
  ///
  /// Solo se usa mientras el segundo factor esta pendiente, cuando el perfil
  /// no se puede pedir. No es una verificacion de la firma, ni hace falta:
  /// lo que el token autoriza lo decide el servidor, no esta lectura.
  UsuarioSesion _usuarioDelToken(Map<String, dynamic> respuesta) {
    final partes = (respuesta['tokenAcceso'] as String).split('.');
    final carga = jsonDecode(utf8.decode(base64Url.decode(base64Url.normalize(partes[1]))))
        as Map<String, dynamic>;
    return UsuarioSesion(
      id: carga['sub'] as String,
      correo: carga['correo'] as String,
      nombres: '',
      apellidos: '',
      roles: (carga['roles'] as List<dynamic>).cast<String>(),
    );
  }

  Future<void> cerrarSesion() async {
    try {
      await _api.enviar('/identidad/sesion/cerrar');
    } catch (_) {
      // Aunque el servidor falle, la sesion local se limpia igual.
    }
    _api.establecerToken(null);
    state = const EstadoSesion();
  }

  void limpiarError() => state = state.copiarCon(limpiarError: true);
}

final sesionProvider =
    NotifierProvider<SesionNotifier, EstadoSesion>(SesionNotifier.new);
