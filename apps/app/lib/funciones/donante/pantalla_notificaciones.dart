import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/visor_archivo.dart';
import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';

final notificacionesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  return ref.read(clienteApiProvider).obtenerLista('/notificaciones');
});

/// CU06 · Narrativas de impacto recibidas.
///
/// Es el cierre emocional del ciclo y la razon por la que el modelo
/// funciona: el donante no recibe un "gracias por tu apoyo", sino cuanto de
/// SU aporte pago que cosa concreta, con el comprobante detras.
class PantallaNotificaciones extends ConsumerWidget {
  const PantallaNotificaciones({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notificaciones = ref.watch(notificacionesProvider);

    return notificaciones.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar sus notificaciones.',
        onReintentar: () => ref.invalidate(notificacionesProvider),
      ),
      data: (lista) {
        if (lista.isEmpty) {
          return const EstadoVacio(
            icono: Icons.notifications_none,
            titulo: 'Aún no hay impacto que mostrar',
            descripcion:
                'Cuando la organización demuestre un gasto financiado con su aporte, le '
                'contaremos exactamente en qué se usó, con su comprobante y su evidencia.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(notificacionesProvider),
          child: Contenido(
            child: ListView.separated(
              itemCount: lista.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, i) => _TarjetaImpacto(notificacion: lista[i]),
            ),
          ),
        );
      },
    );
  }
}

class _TarjetaImpacto extends ConsumerWidget {
  const _TarjetaImpacto({required this.notificacion});

  final Map<String, dynamic> notificacion;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final leida = notificacion['leida'] as bool;
    final evidencia = notificacion['evidencia'] as Map<String, dynamic>?;

    return Card(
      color: leida ? null : tema.colorScheme.primaryContainer.withValues(alpha: 0.25),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.favorite, size: 18, color: TemaApp.semilla),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    notificacion['asunto'] as String,
                    style: tema.textTheme.titleSmall,
                  ),
                ),
                if (!leida)
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: tema.colorScheme.primary,
                      shape: BoxShape.circle,
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 12),

            Text(
              notificacion['narrativa'] as String,
              style: tema.textTheme.bodyMedium?.copyWith(height: 1.5),
            ),

            if (notificacion['montoAplicado'] != null) ...[
              const SizedBox(height: 16),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                decoration: BoxDecoration(
                  color: TemaApp.nivelAlto.withValues(alpha: 0.1),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Icon(Icons.check_circle, size: 16, color: TemaApp.nivelAlto),
                    const SizedBox(width: 8),
                    Text(
                      'De su aporte: ${Formato.soles(notificacion['montoAplicado'] as String?)}',
                      style: tema.textTheme.labelLarge?.copyWith(color: TemaApp.nivelAlto),
                    ),
                  ],
                ),
              ),
            ],

            if (evidencia != null) ...[
              const SizedBox(height: 16),
              MiniaturaArchivo(
                url: evidencia['url'] as String?,
                // Se dice explicitamente: la foto que ve el donante es la
                // publicable, nunca el original con rostros (RNF-06).
                etiqueta: 'Evidencia del gasto · si había personas, con rostros difuminados',
                ancho: 280,
                alto: 190,
              ),
            ],

            const SizedBox(height: 12),
            Row(
              children: [
                Text(
                  Formato.hace(Formato.aFecha(notificacion['creadoEn'])),
                  style: tema.textTheme.bodySmall?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
                const Spacer(),
                if (notificacion['gastoId'] != null)
                  TextButton.icon(
                    onPressed: () => _abrirFeedback(context, ref),
                    icon: const Icon(Icons.flag_outlined, size: 18),
                    label: const Text('Reportar'),
                  ),
                if (!leida)
                  TextButton(
                    onPressed: () async {
                      try {
                        await ref
                            .read(clienteApiProvider)
                            .enviar('/notificaciones/${notificacion['id']}/leida');
                        ref.invalidate(notificacionesProvider);
                      } on ErrorApi catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context)
                              .showSnackBar(SnackBar(content: Text(e.mensaje)));
                        }
                      }
                    },
                    child: const Text('Marcar leída'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  /// CU07 · El donante tambien audita (RF-SO-02).
  Future<void> _abrirFeedback(BuildContext context, WidgetRef ref) async {
    final controlador = TextEditingController();

    final enviado = await showDialog<bool>(
      context: context,
      builder: (contexto) => AlertDialog(
        title: const Text('Reportar una inconsistencia'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Su reporte abre un caso real: un auditor revisará el gasto y el dinero '
              'vuelve a quedar retenido mientras tanto.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controlador,
              maxLines: 4,
              decoration: const InputDecoration(
                labelText: '¿Qué observó?',
                hintText: 'Por ejemplo: la foto parece de otra campaña.',
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(contexto).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(contexto).pop(true),
            child: const Text('Enviar reporte'),
          ),
        ],
      ),
    );

    if (enviado != true || !context.mounted) return;

    try {
      await ref.read(clienteApiProvider).enviar('/feedback', cuerpo: {
        'notificacionId': notificacion['id'],
        'gastoId': notificacion['gastoId'],
        'comentario': controlador.text.trim(),
        'reportaInconsistencia': true,
      });

      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Gracias. Un auditor revisará el caso y le informaremos.'),
          ),
        );
      }
      ref.invalidate(notificacionesProvider);
    } on ErrorApi catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
      }
    }
  }
}
