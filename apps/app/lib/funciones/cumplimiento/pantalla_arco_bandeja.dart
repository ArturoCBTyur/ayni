import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/descarga.dart';
import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';
import 'pantalla_privacidad.dart' show etiquetaEstadoArco, tituloArco;

class SoloPendientesNotifier extends Notifier<bool> {
  @override
  bool build() => true;

  void cambiar(bool valor) => state = valor;
}

final soloPendientesProvider =
    NotifierProvider<SoloPendientesNotifier, bool>(SoloPendientesNotifier.new);

final bandejaArcoProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  final soloPendientes = ref.watch(soloPendientesProvider);
  return ref.read(clienteApiProvider).obtenerLista(
        '/cumplimiento/arco/bandeja',
        consulta: soloPendientes ? null : {'todas': 'true'},
      );
});

/// CU21 · Bandeja de solicitudes ARCO (RF-DE-02).
///
/// Ordenada por plazo y no por fecha de llegada: lo que decide a cual entrar
/// primero es cuanto queda para incumplir, no cual llego antes. Una solicitud
/// de rectificacion presentada ayer vence antes que una de acceso de hace dos
/// semanas, porque la ley les da plazos distintos.
class PantallaArcoBandeja extends ConsumerWidget {
  const PantallaArcoBandeja({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bandeja = ref.watch(bandejaArcoProvider);
    final soloPendientes = ref.watch(soloPendientesProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: Row(
                children: [
                  SegmentedButton<bool>(
                    selected: {soloPendientes},
                    onSelectionChanged: (s) =>
                        ref.read(soloPendientesProvider.notifier).cambiar(s.first),
                    segments: const [
                      ButtonSegment(
                        value: true,
                        label: Text('Pendientes'),
                        icon: Icon(Icons.pending_actions),
                      ),
                      ButtonSegment(
                        value: false,
                        label: Text('Todas'),
                        icon: Icon(Icons.inbox),
                      ),
                    ],
                  ),
                  const Spacer(),
                  // RF-DE-08: lo que habria que mostrar ante una fiscalizacion.
                  PopupMenuButton<String>(
                    tooltip: 'Informe de cumplimiento de la Ley 29733',
                    icon: const Icon(Icons.policy_outlined),
                    onSelected: (formato) => _descargarInforme(context, ref, formato),
                    itemBuilder: (_) => const [
                      PopupMenuItem(value: 'xlsx', child: Text('Informe del año en Excel')),
                      PopupMenuItem(value: 'pdf', child: Text('Informe del año en PDF')),
                    ],
                  ),
                  IconButton(
                    tooltip: 'Actualizar',
                    onPressed: () => ref.invalidate(bandejaArcoProvider),
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
              onReintentar: () => ref.invalidate(bandejaArcoProvider),
            ),
            data: (filas) {
              if (filas.isEmpty) {
                return EstadoVacio(
                  icono: Icons.verified_user_outlined,
                  titulo: soloPendientes
                      ? 'No hay solicitudes pendientes'
                      : 'Todavía no hay solicitudes',
                  descripcion: soloPendientes
                      ? 'Todas las solicitudes de datos fueron respondidas.'
                      : 'Cuando alguien ejerza un derecho sobre sus datos, aparecerá aquí '
                          'con su plazo legal.',
                );
              }

              final vencidas = filas.where((s) => s['vencida'] == true).length;

              return ListView(
                children: [
                  Contenido(
                    ancho: 900,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        if (vencidas > 0) _AvisoVencidas(cantidad: vencidas),
                        for (final s in filas) _TarjetaSolicitud(solicitud: s),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}

/// Un incumplimiento de plazo no es un detalle de la lista: es una infraccion
/// a la Ley N.o 29733, asi que se dice arriba y con su cantidad.
/// Del 1 de enero a hoy: el periodo que se revisa en una fiscalizacion anual.
Future<void> _descargarInforme(BuildContext context, WidgetRef ref, String formato) {
  final hoy = DateTime.now();
  String dia(DateTime f) =>
      '${f.year}-${f.month.toString().padLeft(2, '0')}-${f.day.toString().padLeft(2, '0')}';
  return descargarArchivo(
    context,
    ref,
    ruta: '/cumplimiento/informe',
    consulta: {'desde': '${hoy.year}-01-01', 'hasta': dia(hoy), 'formato': formato},
    nombre: 'cumplimiento-ley-29733-${hoy.year}.$formato',
    tipo: formato == 'pdf'
        ? 'application/pdf'
        : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  );
}

class _AvisoVencidas extends StatelessWidget {
  const _AvisoVencidas({required this.cantidad});

  final int cantidad;

  @override
  Widget build(BuildContext context) {
    return Card(
      color: TemaApp.nivelBajo.withValues(alpha: 0.10),
      child: ListTile(
        leading: Icon(Icons.error_outline, color: TemaApp.nivelBajo),
        title: Text(
          cantidad == 1
              ? 'Una solicitud está fuera del plazo legal'
              : '$cantidad solicitudes están fuera del plazo legal',
          style: Theme.of(context)
              .textTheme
              .titleSmall
              ?.copyWith(color: TemaApp.nivelBajo, fontWeight: FontWeight.w700),
        ),
        subtitle: const Text(
          'El plazo de la Ley N.° 29733 ya venció. Responder ahora no lo subsana, '
          'pero limita el incumplimiento.',
        ),
      ),
    );
  }
}

class _TarjetaSolicitud extends ConsumerWidget {
  const _TarjetaSolicitud({required this.solicitud});

  final Map<String, dynamic> solicitud;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final vencida = solicitud['vencida'] == true;
    final estado = solicitud['estado'] as String;
    final resuelta = estado == 'ATENDIDA' || estado == 'RECHAZADA';
    final solicitante = solicitud['solicitante'] as Map<String, dynamic>;
    final limite = Formato.aFecha(solicitud['plazoLimite']);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    tituloArco(solicitud['tipo'] as String),
                    style: tema.textTheme.titleSmall,
                  ),
                ),
                Text(
                  etiquetaEstadoArco(estado),
                  style: tema.textTheme.labelMedium?.copyWith(
                    color: vencida ? TemaApp.nivelBajo : tema.colorScheme.onSurfaceVariant,
                    fontWeight: FontWeight.w700,
                  ),
                ),
              ],
            ),
            Text(
              '${solicitante['nombre']} · ${solicitante['correo']}',
              style: tema.textTheme.labelMedium?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 10),
            Text(solicitud['detalle'] as String, style: tema.textTheme.bodyMedium),
            const SizedBox(height: 12),
            Row(
              children: [
                Icon(
                  vencida ? Icons.error_outline : Icons.schedule,
                  size: 16,
                  color: vencida ? TemaApp.nivelBajo : tema.colorScheme.onSurfaceVariant,
                ),
                const SizedBox(width: 6),
                Expanded(
                  child: Text(
                    _textoPlazo(limite, vencida),
                    style: tema.textTheme.labelMedium?.copyWith(
                      color: vencida ? TemaApp.nivelBajo : tema.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
                if (!resuelta)
                  FilledButton.tonal(
                    onPressed: () => _responder(context, ref),
                    child: const Text('Responder'),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  static String _textoPlazo(DateTime? limite, bool vencida) {
    if (limite == null) return 'Sin plazo registrado';
    if (vencida) return 'Fuera de plazo desde el ${Formato.fecha(limite)}';

    final dias = limite.difference(DateTime.now()).inDays;
    if (dias <= 0) return 'Vence hoy';
    return 'Faltan $dias día(s) · vence el ${Formato.fecha(limite)}';
  }

  Future<void> _responder(BuildContext context, WidgetRef ref) async {
    final respondida = await showDialog<bool>(
      context: context,
      builder: (_) => _DialogoResponder(solicitud: solicitud),
    );
    if (respondida == true) ref.invalidate(bandejaArcoProvider);
  }
}

class _DialogoResponder extends ConsumerStatefulWidget {
  const _DialogoResponder({required this.solicitud});

  final Map<String, dynamic> solicitud;

  @override
  ConsumerState<_DialogoResponder> createState() => _DialogoResponderState();
}

class _DialogoResponderState extends ConsumerState<_DialogoResponder> {
  final _respuesta = TextEditingController();
  final _formulario = GlobalKey<FormState>();
  String _estado = 'ATENDIDA';
  bool _enviando = false;
  String? _error;

  @override
  void dispose() {
    _respuesta.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    if (!(_formulario.currentState?.validate() ?? false)) return;

    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await ref.read(clienteApiProvider).actualizar(
        '/cumplimiento/arco/${widget.solicitud['id']}',
        cuerpo: {'estado': _estado, 'respuesta': _respuesta.text.trim()},
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return AlertDialog(
      title: Text(tituloArco(widget.solicitud['tipo'] as String)),
      content: SizedBox(
        width: 480,
        child: SingleChildScrollView(
          child: Form(
            key: _formulario,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Container(
                  width: double.infinity,
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: tema.colorScheme.surfaceContainerHighest,
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    widget.solicitud['detalle'] as String,
                    style: tema.textTheme.bodySmall,
                  ),
                ),
                const SizedBox(height: 16),
                SegmentedButton<String>(
                  selected: {_estado},
                  onSelectionChanged: (s) => setState(() => _estado = s.first),
                  segments: const [
                    ButtonSegment(value: 'EN_PROCESO', label: Text('En proceso')),
                    ButtonSegment(value: 'ATENDIDA', label: Text('Atendida')),
                    ButtonSegment(value: 'RECHAZADA', label: Text('Rechazada')),
                  ],
                ),
                const SizedBox(height: 8),
                Text(
                  _estado == 'EN_PROCESO'
                      ? 'La solicitud sigue abierta y el plazo sigue corriendo.'
                      : 'La solicitud queda cerrada y se registra la fecha de respuesta.',
                  style: tema.textTheme.labelSmall?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _respuesta,
                  minLines: 3,
                  maxLines: 8,
                  maxLength: 4000,
                  decoration: InputDecoration(
                    labelText: 'Respuesta al titular',
                    alignLabelWithHint: true,
                    // Rechazar sin motivo deja al titular sin saber si puede
                    // insistir o reclamar, que es justamente lo que el derecho
                    // busca evitar.
                    helperText: _estado == 'RECHAZADA'
                        ? 'Explique el motivo legal del rechazo'
                        : 'Explique qué se hizo con la solicitud',
                  ),
                  validator: (v) => (v ?? '').trim().length >= 10
                      ? null
                      : 'La respuesta debe explicar qué se hizo con la solicitud.',
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(
                    _error!,
                    style: tema.textTheme.bodySmall?.copyWith(color: TemaApp.nivelBajo),
                  ),
                ],
              ],
            ),
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: _enviando ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _enviando ? null : _enviar,
          child: _enviando
              ? const SizedBox(
                  width: 18,
                  height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2),
                )
              : const Text('Enviar respuesta'),
        ),
      ],
    );
  }
}
