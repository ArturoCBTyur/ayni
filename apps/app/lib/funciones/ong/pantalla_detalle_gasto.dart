import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/tarjeta_analisis.dart';
import '../../comun/visor_archivo.dart';
import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';
import 'pantalla_difuminar.dart';
import 'pantalla_gastos.dart';

final detalleGastoOngProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, gastoId) async {
  return ref.read(clienteApiProvider).obtener('/gastos/$gastoId');
});

/// Detalle de un gasto para la ONG que lo registro.
///
/// Antes la tarjeta de la lista no se podia abrir: la ONG veia "Observado" y
/// unas lineas de motivo, pero no lo que habia subido ni que faltaba. Aqui
/// esta todo lo que la API le deja ver: su comprobante, sus fotos en la
/// version que vera el donante, y el analisis completo con sus motivos.
class PantallaDetalleGasto extends ConsumerWidget {
  const PantallaDetalleGasto({super.key, required this.gastoId});

  final String gastoId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gasto = ref.watch(detalleGastoOngProvider(gastoId));

    return Scaffold(
      appBar: AppBar(title: const Text('Detalle del gasto')),
      body: gasto.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar el gasto.',
          onReintentar: () => ref.invalidate(detalleGastoOngProvider(gastoId)),
        ),
        data: (datos) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(detalleGastoOngProvider(gastoId)),
          child: _Contenido(gastoId: gastoId, datos: datos),
        ),
      ),
    );
  }
}

class _Contenido extends StatelessWidget {
  const _Contenido({required this.gastoId, required this.datos});

  final String gastoId;
  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final comprobante = datos['comprobante'] as Map<String, dynamic>?;
    final analisis = datos['analisis'] as Map<String, dynamic>?;
    final evidencias =
        (datos['evidencias'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();
    final alertas = datos['alertasAbiertas'] as int? ?? 0;

    return SingleChildScrollView(
      physics: const AlwaysScrollableScrollPhysics(),
      child: Contenido(
        ancho: 760,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Text(datos['concepto'] as String, style: tema.textTheme.titleLarge),
                ),
                Text(
                  Formato.soles(datos['monto'] as String?),
                  style: tema.textTheme.headlineSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
              ],
            ),
            const SizedBox(height: 8),
            EstadoGasto(estado: datos['estado'] as String),

            if (alertas > 0) ...[
              const SizedBox(height: 16),
              _Aviso(
                icono: Icons.warning_amber_outlined,
                color: TemaApp.nivelMedio,
                texto: alertas == 1
                    ? 'Este gasto tiene una observación abierta. Respóndala desde la pestaña '
                        'Fondos, en «Observaciones por resolver».'
                    : 'Este gasto tiene $alertas observaciones abiertas. Respóndalas desde la '
                        'pestaña Fondos, en «Observaciones por resolver».',
              ),
            ],

            const SizedBox(height: 16),
            if (analisis != null)
              TarjetaAnalisis(analisis: analisis)
            else
              const _Aviso(
                icono: Icons.hourglass_empty,
                texto: 'El análisis todavía no termina. Deslice hacia abajo para actualizar.',
              ),

            const SizedBox(height: 20),
            Text('Lo declarado', style: tema.textTheme.titleSmall),
            const SizedBox(height: 8),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    FilaDato(etiqueta: 'Proveedor', valor: datos['proveedor'] as String),
                    FilaDato(
                      etiqueta: 'Fondo',
                      valor: (datos['fondo'] as Map<String, dynamic>)['nombre'] as String,
                    ),
                    FilaDato(etiqueta: 'Campaña', valor: datos['campana'] as String),
                    FilaDato(
                      etiqueta: 'Fecha del gasto',
                      valor: Formato.fecha(Formato.aFecha(datos['fechaGasto'])),
                    ),
                    if (datos['montoAprobado'] != null)
                      FilaDato(
                        etiqueta: 'Monto aprobado',
                        valor: Formato.soles(datos['montoAprobado'] as String?),
                        destacado: true,
                      ),
                  ],
                ),
              ),
            ),

            if (comprobante != null) ...[
              const SizedBox(height: 20),
              Text('El comprobante', style: tema.textTheme.titleSmall),
              const SizedBox(height: 8),
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Wrap(
                    spacing: 20,
                    runSpacing: 16,
                    children: [
                      MiniaturaArchivo(
                        url: comprobante['url'] as String?,
                        mime: comprobante['mime'] as String?,
                        etiqueta: 'Comprobante ${comprobante['serie']}-${comprobante['numero']}',
                      ),
                      ConstrainedBox(
                        constraints: const BoxConstraints(maxWidth: 380),
                        child: Column(
                          children: [
                            FilaDato(
                              etiqueta: 'Documento',
                              valor: '${Formato.tipoComprobante(comprobante['tipo'] as String?)} '
                                  '${comprobante['serie']}-${comprobante['numero']}',
                            ),
                            FilaDato(
                              etiqueta: 'RUC emisor',
                              valor: comprobante['rucEmisor'] as String,
                            ),
                            FilaDato(
                              etiqueta: 'Total',
                              valor: Formato.soles(comprobante['total'] as String?),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],

            const SizedBox(height: 20),
            Text('Las fotos de evidencia', style: tema.textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(
              'Así las verá el donante. Las que tienen personas solo se publican con los '
              'rostros difuminados.',
              style: tema.textTheme.bodySmall?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 8),
            for (final (i, evidencia) in evidencias.indexed)
              _TarjetaEvidencia(gastoId: gastoId, indice: i, evidencia: evidencia),
          ],
        ),
      ),
    );
  }
}

class _TarjetaEvidencia extends ConsumerWidget {
  const _TarjetaEvidencia({
    required this.gastoId,
    required this.indice,
    required this.evidencia,
  });

  final String gastoId;
  final int indice;
  final Map<String, dynamic> evidencia;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final urlParaDifuminar = evidencia['urlParaDifuminar'] as String?;
    final conPersonas = evidencia['contienePersonas'] == true;

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Wrap(
          spacing: 20,
          runSpacing: 12,
          crossAxisAlignment: WrapCrossAlignment.center,
          children: [
            MiniaturaArchivo(
              url: evidencia['url'] as String?,
              etiqueta: 'Evidencia ${indice + 1}',
              sinArchivo: 'El donante todavía no puede verla',
            ),
            ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 380),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    switch ((conPersonas, urlParaDifuminar != null)) {
                      (false, _) => 'Sin personas: se publica tal cual.',
                      (true, true) =>
                        'Tiene personas y sus rostros todavía no se difuminaron. El donante '
                            'no la verá hasta que lo haga.',
                      (true, false) => 'Tiene personas y ya se difuminaron sus rostros.',
                    },
                    style: tema.textTheme.bodyMedium,
                  ),
                  if (urlParaDifuminar != null) ...[
                    const SizedBox(height: 12),
                    FilledButton.icon(
                      onPressed: () => _difuminar(context, ref, urlParaDifuminar),
                      icon: const Icon(Icons.blur_on),
                      label: const Text('Difuminar rostros'),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _difuminar(BuildContext context, WidgetRef ref, String url) async {
    final listo = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => PantallaDifuminar(evidenciaId: evidencia['id'] as String, url: url),
      ),
    );

    if (listo == true) {
      ref.invalidate(detalleGastoOngProvider(gastoId));
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Listo: el donante verá la foto con los rostros difuminados.'),
          ),
        );
      }
    }
  }
}

class _Aviso extends StatelessWidget {
  const _Aviso({required this.icono, required this.texto, this.color});

  final IconData icono;
  final String texto;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final tono = color ?? tema.colorScheme.onSurfaceVariant;

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tono.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(icono, size: 18, color: tono),
          const SizedBox(width: 10),
          Expanded(child: Text(texto, style: tema.textTheme.bodyMedium)),
        ],
      ),
    );
  }
}
