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

/// Filtros de la bandeja: nivel del motor, una sola ONG y si entra el muestreo.
class FiltrosBandeja {
  const FiltrosBandeja({this.nivel, this.ong, this.muestreo = true});

  final String? nivel;

  /// La ONG elegida, con su nombre para mostrar el filtro activo.
  final ({String id, String nombre})? ong;
  final bool muestreo;
}

class FiltrosBandejaNotifier extends Notifier<FiltrosBandeja> {
  @override
  FiltrosBandeja build() => const FiltrosBandeja();

  void nivel(String? nivel) =>
      state = FiltrosBandeja(nivel: nivel, ong: state.ong, muestreo: state.muestreo);
  void ong(({String id, String nombre})? ong) =>
      state = FiltrosBandeja(nivel: state.nivel, ong: ong, muestreo: state.muestreo);
  void muestreo(bool muestreo) =>
      state = FiltrosBandeja(nivel: state.nivel, ong: state.ong, muestreo: muestreo);
}

final filtrosBandejaProvider =
    NotifierProvider<FiltrosBandejaNotifier, FiltrosBandeja>(FiltrosBandejaNotifier.new);

final bandejaProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final orden = ref.watch(ordenBandejaProvider);
  final filtros = ref.watch(filtrosBandejaProvider);
  return ref.read(clienteApiProvider).obtener('/auditoria/bandeja', consulta: {
    'orden': orden,
    'porPagina': 30,
    'incluirMuestreo': '${filtros.muestreo}',
    if (filtros.nivel != null) 'nivel': filtros.nivel,
    if (filtros.ong != null) 'ongId': filtros.ong!.id,
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
    final filtros = ref.watch(filtrosBandejaProvider);
    final cambiar = ref.read(filtrosBandejaProvider.notifier);

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
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: Wrap(
                spacing: 8,
                runSpacing: 4,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  for (final (valor, etiqueta) in const [
                    (null, 'Todos los niveles'),
                    ('BAJO', 'Bajo'),
                    ('MEDIO', 'Medio'),
                    ('ALTO', 'Alto'),
                  ])
                    ChoiceChip(
                      label: Text(etiqueta),
                      selected: filtros.nivel == valor,
                      onSelected: (_) => cambiar.nivel(valor),
                    ),
                  FilterChip(
                    label: const Text('Incluir muestreo'),
                    selected: filtros.muestreo,
                    onSelected: cambiar.muestreo,
                  ),
                  if (filtros.ong != null)
                    InputChip(
                      label: Text('Solo ${filtros.ong!.nombre}'),
                      onDeleted: () => cambiar.ong(null),
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

/// CU15, flujo 3b · Pasar el caso a otro auditor por conflicto de interes.
class _DialogoReasignar extends ConsumerStatefulWidget {
  const _DialogoReasignar({required this.gastoId});

  final String gastoId;

  @override
  ConsumerState<_DialogoReasignar> createState() => _DialogoReasignarState();
}

class _DialogoReasignarState extends ConsumerState<_DialogoReasignar> {
  final _motivo = TextEditingController();
  late final Future<List<Map<String, dynamic>>> _auditores = ref
      .read(clienteApiProvider)
      .obtenerLista('/auditoria/auditores', consulta: {'gastoId': widget.gastoId});
  String? _destino;
  String? _error;
  bool _enviando = false;

  @override
  void dispose() {
    _motivo.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    if (_destino == null || _motivo.text.trim().length < 10) {
      setState(() => _error = 'Elija un auditor y explique el motivo (al menos 10 caracteres).');
      return;
    }
    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await ref.read(clienteApiProvider).enviar(
        '/auditoria/gastos/${widget.gastoId}/reasignar',
        cuerpo: {'auditorDestinoId': _destino, 'motivo': _motivo.text.trim()},
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ErrorApi catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Reasignar el caso'),
      content: SizedBox(
        width: 440,
        child: FutureBuilder<List<Map<String, dynamic>>>(
          future: _auditores,
          builder: (context, snap) {
            if (!snap.hasData) {
              return const SizedBox(
                height: 80,
                child: Center(child: CircularProgressIndicator()),
              );
            }
            final auditores = snap.data!;
            return Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                const Text('Solo aparecen auditores sin vínculo con esta organización.'),
                const SizedBox(height: 12),
                if (auditores.isEmpty)
                  const Text('No hay otro auditor disponible. Avise al administrador.')
                else
                  DropdownButtonFormField<String>(
                    initialValue: _destino,
                    decoration: const InputDecoration(labelText: 'Auditor'),
                    items: [
                      for (final a in auditores)
                        DropdownMenuItem(
                          value: a['id'] as String,
                          child: Text(a['nombre'] as String),
                        ),
                    ],
                    onChanged: (v) => setState(() => _destino = v),
                  ),
                const SizedBox(height: 12),
                TextField(
                  controller: _motivo,
                  maxLines: 2,
                  decoration: InputDecoration(labelText: 'Motivo', errorText: _error),
                ),
              ],
            );
          },
        ),
      ),
      actions: [
        TextButton(
          onPressed: _enviando ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(onPressed: _enviando ? null : _enviar, child: const Text('Reasignar')),
      ],
    );
  }
}

class _TarjetaCaso extends ConsumerWidget {
  const _TarjetaCaso({required this.caso});

  final Map<String, dynamic> caso;

  Future<void> _reasignar(BuildContext context, WidgetRef ref) async {
    final hecho = await showDialog<bool>(
      context: context,
      builder: (_) => _DialogoReasignar(gastoId: caso['id'] as String),
    );
    if (hecho == true && context.mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Caso reasignado. Queda constancia del motivo.')),
      );
    }
  }

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
              Wrap(
                spacing: 4,
                children: [
                  TextButton.icon(
                    onPressed: () => ref.read(filtrosBandejaProvider.notifier).ong(
                          (id: ong['id'] as String, nombre: ong['nombre'] as String),
                        ),
                    icon: const Icon(Icons.filter_alt_outlined, size: 18),
                    label: Text('Solo ${ong['nombre']}'),
                  ),
                  if (conflicto)
                    TextButton.icon(
                      onPressed: () => _reasignar(context, ref),
                      icon: const Icon(Icons.swap_horiz, size: 18),
                      label: const Text('Reasignar'),
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
