import 'package:intl/intl.dart';

import 'config.dart';

/// Formato de montos y fechas en español peruano (RNF-20).
///
/// El backend entrega los importes como texto con dos decimales a proposito:
/// convertirlos a double aqui reintroduciria el error de punto flotante que
/// el modelo de datos evita usando NUMERIC. Por eso se formatea sobre el
/// texto y solo se parsea para agrupar los miles.
class Formato {
  const Formato._();

  /// Moneda con el formato que realmente se usa en Perú: "S/ 1,234.50".
  ///
  /// No se usa el locale es_PE tal cual porque los datos de intl para ese
  /// locale colocan el simbolo al final y usan la coma como separador
  /// decimal ("1.234,50 S/"), que es la convencion de España y no la
  /// peruana. La SUNAT, los bancos y cualquier boleta del pais escriben el
  /// simbolo delante, con coma para los miles y punto para los centimos.
  /// Se toma el patron de agrupacion de en_US, que coincide con el peruano,
  /// y se le pone el simbolo del sol.
  static final _moneda = NumberFormat.currency(
    locale: 'en_US',
    symbol: '${Config.monedaSimbolo} ',
    decimalDigits: 2,
  );

  static final _fechaCorta = DateFormat('d MMM y', Config.locale);
  static final _fechaLarga = DateFormat("d 'de' MMMM 'de' y", Config.locale);
  static final _fechaHora = DateFormat('d MMM y, HH:mm', Config.locale);

  /// "S/ 1,234.50" a partir de "1234.50".
  static String soles(String? monto) {
    if (monto == null) return '—';
    final valor = double.tryParse(monto);
    return valor == null ? monto : _moneda.format(valor);
  }

  static String fecha(DateTime? valor) => valor == null ? '—' : _fechaCorta.format(valor);

  static String fechaLarga(DateTime? valor) =>
      valor == null ? '—' : _fechaLarga.format(valor);

  static String fechaHora(DateTime? valor) => valor == null ? '—' : _fechaHora.format(valor);

  /// Interpreta una fecha ISO del backend; devuelve null si viene vacia.
  static DateTime? aFecha(dynamic valor) {
    if (valor == null) return null;
    return DateTime.tryParse(valor.toString())?.toLocal();
  }

  /// Fecha sin hora (columnas DATE): el dia que dice, sin pasar por la zona
  /// horaria. Con [aFecha], "2026-06-01T00:00:00Z" se convierte a la hora de
  /// Lima y se muestra como el 31 de mayo.
  static DateTime? aDia(dynamic valor) {
    final fecha = valor == null ? null : DateTime.tryParse(valor.toString());
    return fecha == null ? null : DateTime(fecha.year, fecha.month, fecha.day);
  }

  /// "hace 3 dias", para listas donde la antiguedad importa mas que la fecha.
  static String hace(DateTime? valor) {
    if (valor == null) return '—';
    final diferencia = DateTime.now().difference(valor);

    if (diferencia.inMinutes < 1) return 'recien';
    if (diferencia.inMinutes < 60) return 'hace ${diferencia.inMinutes} min';
    if (diferencia.inHours < 24) return 'hace ${diferencia.inHours} h';
    if (diferencia.inDays == 1) return 'ayer';
    if (diferencia.inDays < 30) return 'hace ${diferencia.inDays} dias';
    return fecha(valor);
  }

  /// Porcentaje con un decimal, sin ceros innecesarios.
  static String porcentaje(num? valor) {
    if (valor == null) return '—';
    final texto = valor.toStringAsFixed(1);
    return '${texto.endsWith('.0') ? texto.substring(0, texto.length - 2) : texto} %';
  }

  /// Nombre legible de una categoria de gasto.
  static String categoria(String? codigo) => switch (codigo) {
        'ALIMENTOS' => 'Alimentos',
        'ATENCION_VETERINARIA' => 'Atención veterinaria',
        'MEDICAMENTOS' => 'Medicamentos',
        'INSUMOS' => 'Insumos',
        'TRANSPORTE' => 'Transporte',
        'INFRAESTRUCTURA' => 'Infraestructura',
        'ESTERILIZACION' => 'Esterilización',
        'OTROS' => 'Otros',
        _ => codigo ?? '—',
      };

  /// Nombre legible de un tipo de comprobante de pago.
  static String tipoComprobante(String? codigo) => switch (codigo) {
        'FACTURA' => 'Factura',
        'BOLETA' => 'Boleta',
        'RECIBO_HONORARIOS' => 'Recibo por honorarios',
        'NOTA_VENTA' => 'Nota de venta',
        _ => codigo ?? '—',
      };

  /// Nombre legible de un rol.
  static String rol(String codigo) => switch (codigo) {
        'DONANTE' => 'Donante',
        'ONG_ADMIN' => 'Administrador de ONG',
        'ONG_OPERADOR' => 'Operador de ONG',
        'AUDITOR' => 'Auditor',
        'ADMIN' => 'Administrador',
        _ => codigo,
      };
}
