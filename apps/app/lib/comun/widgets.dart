import 'package:flutter/material.dart';

import '../nucleo/tema.dart';

/// Mensaje de error con accion de reintento.
///
/// RF-PS-05: explica que ocurrio y ofrece que hacer, en lugar de mostrar un
/// codigo. La accion importa tanto como el texto: un error sin salida deja
/// al usuario atrapado.
class TarjetaError extends StatelessWidget {
  const TarjetaError({super.key, required this.mensaje, this.onReintentar, this.sugerencia});

  final String mensaje;
  final String? sugerencia;
  final VoidCallback? onReintentar;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 480),
        child: Card(
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(Icons.error_outline, color: TemaApp.nivelBajo),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(mensaje, style: Theme.of(context).textTheme.titleMedium),
                    ),
                  ],
                ),
                if (sugerencia != null) ...[
                  const SizedBox(height: 12),
                  Text(sugerencia!, style: Theme.of(context).textTheme.bodySmall),
                ],
                if (onReintentar != null) ...[
                  const SizedBox(height: 20),
                  FilledButton.icon(
                    onPressed: onReintentar,
                    icon: const Icon(Icons.refresh),
                    label: const Text('Reintentar'),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// Estado vacio con explicacion de que hacer a continuacion.
class EstadoVacio extends StatelessWidget {
  const EstadoVacio({
    super.key,
    required this.icono,
    required this.titulo,
    required this.descripcion,
    this.accion,
  });

  final IconData icono;
  final String titulo;
  final String descripcion;
  final Widget? accion;

  @override
  Widget build(BuildContext context) {
    final esquema = Theme.of(context).colorScheme;

    return Center(
      child: ConstrainedBox(
        constraints: const BoxConstraints(maxWidth: 420),
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(icono, size: 56, color: esquema.outline),
              const SizedBox(height: 16),
              Text(
                titulo,
                style: Theme.of(context).textTheme.titleMedium,
                textAlign: TextAlign.center,
              ),
              const SizedBox(height: 8),
              Text(
                descripcion,
                style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                      color: esquema.onSurfaceVariant,
                    ),
                textAlign: TextAlign.center,
              ),
              if (accion != null) ...[const SizedBox(height: 24), accion!],
            ],
          ),
        ),
      ),
    );
  }
}

/// Distintivo del nivel de confianza que devolvio el motor de verificacion.
///
/// El mismo color significa lo mismo en toda la app: verde aprobado, ambar
/// en revision, rojo bloqueado. La consistencia cromatica es lo que permite
/// leer una bandeja de un vistazo.
class InsigniaNivel extends StatelessWidget {
  const InsigniaNivel({super.key, required this.nivel, this.score});

  final String nivel;
  final num? score;

  @override
  Widget build(BuildContext context) {
    final color = TemaApp.colorNivel(nivel);
    final etiqueta = switch (nivel.toUpperCase()) {
      'ALTO' => 'Confianza alta',
      'MEDIO' => 'Requiere revisión',
      'BAJO' => 'Bloqueado',
      _ => nivel,
    };

    return Semantics(
      label: '$etiqueta${score != null ? ', puntaje $score de 100' : ''}',
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 5),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.12),
          borderRadius: BorderRadius.circular(999),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.circle, size: 8, color: color),
            const SizedBox(width: 6),
            Text(
              score != null ? '$etiqueta · $score' : etiqueta,
              style: Theme.of(context).textTheme.labelMedium?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w600,
                  ),
            ),
          ],
        ),
      ),
    );
  }
}

/// Sello de ONG verificada (RF-SO-01).
class SelloVerificada extends StatelessWidget {
  const SelloVerificada({super.key, required this.verificada});

  final bool verificada;

  @override
  Widget build(BuildContext context) {
    if (!verificada) return const SizedBox.shrink();

    return Tooltip(
      message: 'Un auditor revisó el RUC, el representante legal y la documentación.',
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.verified, size: 16, color: TemaApp.nivelAlto),
          const SizedBox(width: 4),
          Text(
            'Verificada',
            style: Theme.of(context).textTheme.labelMedium?.copyWith(
                  color: TemaApp.nivelAlto,
                  fontWeight: FontWeight.w600,
                ),
          ),
        ],
      ),
    );
  }
}

/// Barra de avance de la meta de un fondo.
class BarraAvance extends StatelessWidget {
  const BarraAvance({super.key, required this.avance, this.alto = 8});

  final num avance;
  final double alto;

  @override
  Widget build(BuildContext context) {
    final fraccion = (avance / 100).clamp(0.0, 1.0).toDouble();

    return Semantics(
      label: 'Avance de la meta: ${avance.toStringAsFixed(0)} por ciento',
      child: ClipRRect(
        borderRadius: BorderRadius.circular(999),
        child: LinearProgressIndicator(
          value: fraccion,
          minHeight: alto,
          backgroundColor: Theme.of(context).colorScheme.surfaceContainerHighest,
        ),
      ),
    );
  }
}

/// Limita el ancho del contenido en pantallas grandes.
///
/// Una linea de texto de 1600 px es incomoda de leer; el limite mantiene la
/// medida tipografica razonable sin sacrificar el uso en movil.
class Contenido extends StatelessWidget {
  const Contenido({super.key, required this.child, this.ancho = 900});

  final Widget child;
  final double ancho;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: ancho),
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 20),
          child: child,
        ),
      ),
    );
  }
}

/// Fila de dato con etiqueta, para fichas y detalles.
class FilaDato extends StatelessWidget {
  const FilaDato({super.key, required this.etiqueta, required this.valor, this.destacado = false});

  final String etiqueta;
  final String valor;
  final bool destacado;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 160,
            child: Text(
              etiqueta,
              style: tema.textTheme.labelLarge?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
          Expanded(
            child: Text(
              valor,
              style: destacado
                  ? tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)
                  : tema.textTheme.bodyMedium,
            ),
          ),
        ],
      ),
    );
  }
}
