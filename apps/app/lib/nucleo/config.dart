/// Configuracion de compilacion.
///
/// Se resuelve con --dart-define para que el mismo codigo sirva en local y
/// en el despliegue de la Fase 11:
///   flutter run -d edge --dart-define=API_BASE_URL=http://localhost:3000/api/v1
class Config {
  const Config._();

  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'http://localhost:3000/api/v1',
  );

  static const String nombreApp = 'Ayni';

  /// Moneda y locale del contexto de operacion (RNF-20: español peruano,
  /// montos en soles con formato local).
  static const String locale = 'es_PE';
  static const String monedaSimbolo = 'S/';
  static const String monedaCodigo = 'PEN';
}
