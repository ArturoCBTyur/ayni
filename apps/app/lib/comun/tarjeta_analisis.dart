import 'package:flutter/material.dart';

import '../nucleo/formato.dart';
import '../nucleo/tema.dart';
import 'widgets.dart';

/// RNF-09 · Los motivos del puntaje, en lenguaje legible.
///
/// La ven el auditor que decide y la ONG que tiene que corregir: la misma
/// explicacion, porque una que cambiara segun quien la lee dejaria de ser
/// una explicacion de la decision.
class TarjetaAnalisis extends StatelessWidget {
  const TarjetaAnalisis({super.key, required this.analisis});

  final Map<String, dynamic> analisis;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final explicacion = analisis['explicacion'] as Map<String, dynamic>?;
    final motivos =
        (explicacion?['motivos'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                InsigniaNivel(
                  nivel: analisis['nivel'] as String,
                  score: analisis['scoreFinal'] as num?,
                ),
                const Spacer(),
                Text(
                  Formato.hace(Formato.aFecha(analisis['creadoEn'])),
                  style: tema.textTheme.bodySmall,
                ),
              ],
            ),
            if (explicacion?['resumen'] != null) ...[
              const SizedBox(height: 12),
              Text(explicacion!['resumen'] as String, style: tema.textTheme.bodyMedium),
            ],
            if (motivos.isNotEmpty) ...[
              const Divider(height: 28),
              Text('Por qué el motor concluyó esto', style: tema.textTheme.labelLarge),
              const SizedBox(height: 8),
              for (final motivo in motivos)
                Padding(
                  padding: const EdgeInsets.only(bottom: 8),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Icon(
                        switch (motivo['resultado']) {
                          'ok' => Icons.check_circle_outline,
                          'advertencia' => Icons.info_outline,
                          _ => Icons.error_outline,
                        },
                        size: 16,
                        color: switch (motivo['resultado']) {
                          'ok' => TemaApp.nivelAlto,
                          'advertencia' => TemaApp.nivelMedio,
                          _ => TemaApp.nivelBajo,
                        },
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: Text(
                          motivo['mensaje'] as String,
                          style: tema.textTheme.bodySmall,
                        ),
                      ),
                      if ((motivo['penalizacion'] as num? ?? 0) > 0)
                        Text(
                          '−${motivo['penalizacion']}',
                          style: tema.textTheme.labelSmall?.copyWith(
                            color: tema.colorScheme.onSurfaceVariant,
                          ),
                        ),
                    ],
                  ),
                ),
            ],
          ],
        ),
      ),
    );
  }
}
