import 'package:flutter/material.dart';

/// Tema de la aplicacion.
///
/// Los colores se eligieron verificando contraste AA de WCAG 2.1 sobre
/// blanco y sobre la superficie oscura (RNF-15), y los objetivos de toque
/// se fijan en 48 dp porque el operador de campo usa el celular con una
/// sola mano (RNF-14).
class TemaApp {
  const TemaApp._();

  /// Verde institucional: confianza y reciprocidad (ayni).
  static const Color semilla = Color(0xFF0F766E);

  /// Colores de los tres niveles de confianza, usados en toda la app para
  /// que el mismo significado tenga siempre el mismo color.
  static const Color nivelAlto = Color(0xFF15803D);
  static const Color nivelMedio = Color(0xFFB45309);
  static const Color nivelBajo = Color(0xFFB91C1C);

  static const double areaToqueMinima = 48;

  static ThemeData claro() => _base(Brightness.light);

  static ThemeData oscuro() => _base(Brightness.dark);

  static ThemeData _base(Brightness brillo) {
    final esquema = ColorScheme.fromSeed(seedColor: semilla, brightness: brillo);

    return ThemeData(
      useMaterial3: true,
      colorScheme: esquema,
      visualDensity: VisualDensity.standard,
      // Garantiza el area de toque minima en todos los botones.
      materialTapTargetSize: MaterialTapTargetSize.padded,
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size(64, areaToqueMinima),
          textStyle: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(minimumSize: const Size(64, areaToqueMinima)),
      ),
      inputDecorationTheme: const InputDecorationTheme(
        border: OutlineInputBorder(),
        // Los mensajes de error se leen completos, no se truncan (RF-PS-05).
        errorMaxLines: 3,
      ),
      cardTheme: CardThemeData(
        elevation: 0,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: esquema.outlineVariant),
        ),
      ),
    );
  }

  /// Color del nivel de confianza devuelto por el motor de verificacion.
  static Color colorNivel(String nivel) => switch (nivel.toUpperCase()) {
        'ALTO' => nivelAlto,
        'MEDIO' => nivelMedio,
        'BAJO' => nivelBajo,
        _ => const Color(0xFF64748B),
      };
}
