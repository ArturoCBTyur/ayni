import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';
import 'pantalla_revision.dart';

class OrdenBandejaNotifier extends Notifier<String> {
  @override
  String build() => 'antiguedad';

  void ordenarPor(String orden) => state = orden;
}

final ordenBandejaProvider =
    NotifierProvider<OrdenBandejaNotifier, String>(OrdenBandejaNotifier.new);

final bandejaProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final orden = ref.watch(ordenBandejaProvider);
  return ref.read(clienteApiProvider).obtener('/auditoria/bandeja', consulta: {
    'orden': orden,
    'porPagina': 30,
  });
});

/// CU15 · Bandeja del auditor.
///
/// Ordenada por antiguedad o monto, con el SLA visible: lo que un auditor
/// necesita decidir primero es a que caso entrar, y eso depende de cuanto
/// lleva esperando y de cuanto dinero hay en juego.
class PantallaBandeja extends ConsumerWidget {
  const PantallaBandeja({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bandeja = ref.watch(bandejaProvider);
    final orden = ref.watch(ordenBandejaProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: Row(
                children: [
                  SegmentedButton<String>(
                    selected: {orden},
                    onSelectionChanged: (s) =>
                        ref.read(ordenBandejaProvider.notifier).ordenarPor(s.first),
                    segments: const [
                      ButtonSegment(
                        value: 'antiguedad',
                        label: Text('Más antiguos'),
                        icon: Icon(Icons.schedule),
                      ),
                      ButtonSegment(
                        value: 'monto',
                        label: Text('Mayor monto'),
                        icon: Icon(Icons.payments_outlined),
                      ),
                    ],
                  ),
                  const Spacer(),
                  IconButton(
                    tooltip: 'Actualizar',
                    onPressed: () => ref.invalidate(bandejaProvider),
                    icon: const Icon(Icons.refresh),
                  ),
                ],
              ),
            ),
          ),
        ),
        Expanded(
          child: bandeja.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => TarjetaError(
              mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar la bandeja.',
              onReintentar: () => ref.invalidate(bandejaProvider),
            ),
            data: (datos) {
              final casos = (datos['casos'] as List<dynamic>).cast<Map<String, dynamic>>();

              if (casos.isEmpty) {
                return const EstadoVacio(
                  icono: Icons.task_alt,
                  titulo: 'No hay casos pendientes',
                  descripcion:
                      'Cuando el motor derive un gasto de confianza media, o toque una '
                      'auditoría por muestreo, aparecerá aquí.',
                );
              }

              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(bandejaProvider),
                child: Contenido(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${datos['total']} caso(s) por revisar',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 12),
                      Expanded(
                        child: ListView.separated(
                          itemCount: casos.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 10),
                          itemBuilder: (context, i) => _TarjetaCaso(caso: casos[i]),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _TarjetaCaso extends ConsumerWidget {
  const _TarjetaCaso({required this.caso});

  final Map<String, dynamic> caso;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final ong = caso['ong'] as Map<String, dynamic>;
    final sla = caso['sla'] as Map<String, dynamic>;
    final conflicto = caso['conflictoInteres'] as bool;
    final vencido = sla['vencido'] as bool;

    return Card(
      child: InkWell(
        onTap: conflicto
            ? null
            : () async {
                final resuelto = await Navigator.of(context).push<bool>(
                  MaterialPageRoute(
                    builder: (_) => PantallaRevision(gastoId: caso['id'] as String),
                  ),
                );
                if (resuelto == true) ref.invalidate(bandejaProvider);
              },
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(caso['concepto'] as String, style: tema.textTheme.titleSmall),
                        Text(
                          '${ong['nombre']} · ${caso['proveedor']}',
                          style: tema.textTheme.bodySmall?.copyWith(
                            color: tema.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Text(
                    Formato.soles(caso['monto'] as String?),
                    style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                  ),
                ],
              ),

              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  if (caso['nivel'] != null)
                    InsigniaNivel(
                      nivel: caso['nivel'] as String,
                      score: caso['scoreFinal'] as num?,
                    ),
                  if (caso['esMuestreo'] == true)
                    Chip(
                      avatar: const Icon(Icons.casino_outlined, size: 16),
                      label: const Text('Muestreo'),
                      visualDensity: VisualDensity.compact,
                    ),
                  if ((caso['alertasAbiertas'] as int) > 0)
                    Chip(
                      avatar: Icon(Icons.warning_amber_outlined,
                          size: 16, color: TemaApp.nivelMedio),
                      label: Text('${caso['alertasAbiertas']} alerta(s)'),
                      visualDensity: VisualDensity.compact,
                    ),
                ],
              ),

              const SizedBox(height: 10),
              Row(
                children: [
                  Icon(
                    vencido ? Icons.alarm : Icons.schedule,
                    size: 14,
                    color: vencido ? TemaApp.nivelBajo : tema.colorScheme.onSurfaceVariant,
                  ),
                  const SizedBox(width: 6),
                  Text(
                    vencido
                        ? 'Fuera del plazo de 48 h hábiles'
                        : 'Recibido ${Formato.hace(Formato.aFecha(caso['recibidoEn']))}',
                    style: tema.textTheme.labelSmall?.copyWith(
                      color: vencido ? TemaApp.nivelBajo : tema.colorScheme.onSurfaceVariant,
                    ),
                  ),
                  const Spacer(),
                  if (conflicto)
                    // Se advierte antes de que lo intente, no despues de que
                    // el servidor lo rechace.
                    Row(
                      children: [
                        Icon(Icons.block, size: 14, color: TemaApp.nivelBajo),
                        const SizedBox(width: 4),
                        Text(
                          'Conflicto de interés',
                          style: tema.textTheme.labelSmall?.copyWith(
                            color: TemaApp.nivelBajo,
                          ),
                        ),
                      ],
                    ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
