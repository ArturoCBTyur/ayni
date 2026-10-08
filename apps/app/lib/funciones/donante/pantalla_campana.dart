import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';
import 'hoja_donar.dart';

final campanaProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, slug) async {
  return ref.read(clienteApiProvider).obtener('/causas/$slug');
});

/// Ficha de la campaña con sus fondos (CU02, CU03).
///
/// Cada fondo muestra los tres saldos: recaudado, retenido y ejecutado. Es
/// el corazon del modelo y conviene que el donante lo vea antes de aportar,
/// no despues: "retenido" significa que ese dinero todavia no se ha gastado
/// y no podra gastarse sin comprobante y evidencia.
class PantallaCampana extends ConsumerWidget {
  const PantallaCampana({super.key, required this.slug});

  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campana = ref.watch(campanaProvider(slug));

    return Scaffold(
      appBar: AppBar(title: const Text('Causa')),
      body: campana.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar la causa.',
          onReintentar: () => ref.invalidate(campanaProvider(slug)),
        ),
        data: (datos) => _Detalle(datos: datos, slug: slug),
      ),
    );
  }
}

class _Detalle extends ConsumerWidget {
  const _Detalle({required this.datos, required this.slug});

  final Map<String, dynamic> datos;
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final ong = datos['ong'] as Map<String, dynamic>;
    final fondos = (datos['fondos'] as List<dynamic>).cast<Map<String, dynamic>>();

    return SingleChildScrollView(
      child: Contenido(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(datos['titulo'] as String, style: tema.textTheme.headlineSmall),
            const SizedBox(height: 8),
            Row(
              children: [
                SelloVerificada(verificada: ong['verificada'] as bool),
                const SizedBox(width: 12),
                Text(
                  ong['nombre'] as String,
                  style: tema.textTheme.bodyMedium?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(datos['descripcion'] as String, style: tema.textTheme.bodyLarge),

            const SizedBox(height: 24),
            _PuntajeConfianza(ong: ong),

            const SizedBox(height: 32),
            Text('¿A qué destino quiere aportar?', style: tema.textTheme.titleMedium),
            const SizedBox(height: 4),
            Text(
              'Cada fondo tiene un destino concreto. Su aporte queda retenido en el que '
              'elija hasta que la organización demuestre el gasto.',
              style: tema.textTheme.bodySmall?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),

            for (final fondo in fondos) ...[
              _TarjetaFondo(
                fondo: fondo,
                onDonar: () => _abrirDonacion(context, ref, fondo),
              ),
              const SizedBox(height: 12),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _abrirDonacion(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> fondo,
  ) async {
    final dono = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => HojaDonar(
        fondoId: fondo['id'] as String,
        nombreFondo: fondo['nombre'] as String,
      ),
    );

    if (dono == true) ref.invalidate(campanaProvider(slug));
  }
}

/// RF-SO-01 · Puntaje de confianza con sus componentes explicados.
class _PuntajeConfianza extends StatelessWidget {
  const _PuntajeConfianza({required this.ong});

  final Map<String, dynamic> ong;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final desglose = ong['desglosePuntaje'] as Map<String, dynamic>?;
    final componentes =
        (desglose?['componentes'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];
    final puntaje = double.tryParse(ong['puntajeConfianza'] as String? ?? '') ?? 0;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.shield_outlined, color: TemaApp.semilla),
                const SizedBox(width: 8),
                Text('Confianza de la organización', style: tema.textTheme.titleSmall),
                const Spacer(),
                Text(
                  puntaje.toStringAsFixed(0),
                  style: tema.textTheme.headlineSmall?.copyWith(
                    color: TemaApp.semilla,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(' / 100', style: tema.textTheme.bodySmall),
              ],
            ),
            if (desglose?['historialInsuficiente'] == true) ...[
              const SizedBox(height: 8),
              Text(
                'Esta organización todavía tiene poco historial verificado, así que su '
                'puntaje parte de un valor neutro.',
                style: tema.textTheme.bodySmall?.copyWith(
                  color: tema.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: 12),
            // El desglose es lo que convierte un numero en una señal
            // comprensible: sin el, el puntaje seria otra caja negra.
            for (final c in componentes)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      c['valor'] == null ? Icons.remove_circle_outline : Icons.check_circle_outline,
                      size: 18,
                      color: c['valor'] == null
                          ? tema.colorScheme.outline
                          : TemaApp.nivelAlto,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(c['etiqueta'] as String, style: tema.textTheme.labelLarge),
                          Text(
                            c['detalle'] as String,
                            style: tema.textTheme.bodySmall?.copyWith(
                              color: tema.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

class _TarjetaFondo extends StatelessWidget {
  const _TarjetaFondo({required this.fondo, required this.onDonar});

  final Map<String, dynamic> fondo;
  final VoidCallback onDonar;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final avance = (fondo['avance'] as num?) ?? 0;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(fondo['nombre'] as String, style: tema.textTheme.titleSmall),
                ),
                Chip(
                  label: Text(Formato.categoria(fondo['categoriaGasto'] as String?)),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            if (fondo['descripcion'] != null) ...[
              const SizedBox(height: 6),
              Text(fondo['descripcion'] as String, style: tema.textTheme.bodySmall),
            ],
            const SizedBox(height: 14),
            BarraAvance(avance: avance),
            const SizedBox(height: 12),

            // Los tres saldos: es la transparencia que el proyecto promete.
            Wrap(
              spacing: 20,
              runSpacing: 8,
              children: [
                _Saldo(
                  etiqueta: 'Recaudado',
                  valor: Formato.soles(fondo['recaudado'] as String?),
                ),
                _Saldo(
                  etiqueta: 'Esperando evidencia',
                  valor: Formato.soles(fondo['retenido'] as String?),
                  color: TemaApp.nivelMedio,
                ),
                _Saldo(
                  etiqueta: 'Ejecutado y verificado',
                  valor: Formato.soles(fondo['ejecutado'] as String?),
                  color: TemaApp.nivelAlto,
                ),
              ],
            ),

            const SizedBox(height: 16),
            Align(
              alignment: Alignment.centerRight,
              child: FilledButton.icon(
                onPressed: onDonar,
                icon: const Icon(Icons.favorite_outline),
                label: Text('Donar a ${fondo['nombre']}'),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Saldo extends StatelessWidget {
  const _Saldo({required this.etiqueta, required this.valor, this.color});

  final String etiqueta;
  final String valor;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          etiqueta,
          style: tema.textTheme.labelSmall?.copyWith(
            color: tema.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(
          valor,
          style: tema.textTheme.titleSmall?.copyWith(
            color: color,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
