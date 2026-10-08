import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:trazabilidad_radical/nucleo/config.dart';
import 'package:trazabilidad_radical/nucleo/formato.dart';

/// Pruebas del formato local (RNF-20).
///
/// Existen porque el formato de moneda salio mal en la primera version: los
/// datos de intl para es_PE escriben "1.234,50 S/", a la española, y en Perú
/// se escribe "S/ 1,234.50". Un importe mal formateado en una plataforma
/// cuyo argumento es la trazabilidad del dinero resta credibilidad antes de
/// que nadie mire la contabilidad.
void main() {
  setUpAll(() async => initializeDateFormatting(Config.locale));

  group('Montos en soles', () {
    test('usa el símbolo delante, coma para miles y punto para céntimos', () {
      expect(Formato.soles('1234.50'), 'S/ 1,234.50');
      expect(Formato.soles('19000.00'), 'S/ 19,000.00');
      expect(Formato.soles('0.00'), 'S/ 0.00');
    });

    test('siempre muestra dos decimales', () {
      expect(Formato.soles('100'), 'S/ 100.00');
      expect(Formato.soles('95.5'), 'S/ 95.50');
    });

    test('tolera un valor ausente o no numérico sin romper la pantalla', () {
      expect(Formato.soles(null), '—');
      // Si el backend enviara algo inesperado, se muestra tal cual en lugar
      // de dejar la interfaz en blanco.
      expect(Formato.soles('n/d'), 'n/d');
    });
  });

  group('Fechas', () {
    test('formatea en español', () {
      final fecha = DateTime(2026, 9, 13);

      expect(Formato.fecha(fecha), contains('2026'));
      // intl usa "septiembre", la forma que la RAE registra como principal.
      // El Entregable 2 escribe "setiembre", variante igualmente correcta y
      // más común en Perú. No se sobrescriben los datos de locale por una
      // preferencia ortográfica: ambas formas son válidas y mantener un
      // locale propio costaría más de lo que aporta.
      expect(Formato.fechaLarga(fecha).toLowerCase(), contains('septiembre'));
      expect(Formato.fechaLarga(fecha), contains('de 2026'));
    });

    test('interpreta la fecha ISO del backend', () {
      expect(Formato.aFecha('2026-09-13T15:30:00.000Z')?.year, 2026);
      expect(Formato.aFecha(null), isNull);
      expect(Formato.aFecha('no es una fecha'), isNull);
    });

    test('describe la antigüedad en lenguaje natural', () {
      final ahora = DateTime.now();

      expect(Formato.hace(ahora), 'recien');
      expect(Formato.hace(ahora.subtract(const Duration(hours: 3))), 'hace 3 h');
      expect(Formato.hace(ahora.subtract(const Duration(days: 1))), 'ayer');
      expect(Formato.hace(ahora.subtract(const Duration(days: 4))), 'hace 4 dias');
    });
  });

  group('Etiquetas', () {
    test('traduce categorías y roles a lenguaje legible', () {
      expect(Formato.categoria('ATENCION_VETERINARIA'), 'Atención veterinaria');
      expect(Formato.rol('ONG_OPERADOR'), 'Operador de ONG');
    });

    test('devuelve el código cuando no conoce la etiqueta', () {
      // Preferible a mostrar vacío: si aparece un valor nuevo del backend,
      // la pantalla sigue siendo legible.
      expect(Formato.categoria('CATEGORIA_NUEVA'), 'CATEGORIA_NUEVA');
      expect(Formato.rol('ROL_NUEVO'), 'ROL_NUEVO');
    });

    test('una fecha sin hora conserva su dia en cualquier zona horaria', () {
      // Una columna DATE llega como medianoche UTC. En Lima (UTC-5) eso es
      // la tarde del dia anterior; el dia de inicio de una campaña no cambia.
      expect(Formato.aDia('2026-06-01T00:00:00.000Z'), DateTime(2026, 6, 1));
      expect(Formato.aDia(null), isNull);
    });
  });
}
