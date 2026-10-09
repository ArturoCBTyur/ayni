import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/tema.dart';

/// Encuestas que a esta persona le corresponde responder hoy (RF-SO-05).
final encuestasPendientesProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return ref.read(clienteApiProvider).obtener('/encuestas/pendientes');
});

final instrumentoProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, codigo) async {
  return ref.read(clienteApiProvider).obtener('/encuestas/instrumentos/$codigo');
});

/// "Ahora no": la invitacion no vuelve a aparecer hasta la proxima sesion.
class EncuestaPospuestaNotifier extends Notifier<bool> {
  @override
  bool build() => false;

  void posponer() => state = true;
}

final encuestaPospuestaProvider =
    NotifierProvider<EncuestaPospuestaNotifier, bool>(EncuestaPospuestaNotifier.new);

/// Invitacion en el inicio. Es opcional y lo dice: una encuesta que se siente
/// obligatoria mide la paciencia de la persona, no su opinion.
class InvitacionEncuesta extends ConsumerWidget {
  const InvitacionEncuesta({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (ref.watch(encuestaPospuestaProvider)) return const SizedBox.shrink();

    return ref.watch(encuestasPendientesProvider).maybeWhen(
          data: (datos) {
            final pendientes =
                (datos['pendientes'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? const [];
            if (pendientes.isEmpty) return const SizedBox.shrink();
            final pendiente = pendientes.first;
            final consentimiento = datos['consentimiento'] == true;

            return Card(
              color: TemaApp.semilla.withValues(alpha: 0.06),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Row(
                      children: [
                        const Icon(Icons.quiz_outlined, color: TemaApp.semilla),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Una encuesta de ${pendiente['items']} preguntas, si quiere',
                            style: Theme.of(context).textTheme.titleSmall,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text('${pendiente['nombre']}. ${pendiente['motivo']}'),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: [
                        FilledButton(
                          onPressed: () => Navigator.of(context).push(
                            MaterialPageRoute<void>(
                              builder: (_) => PantallaEncuesta(
                                pendiente: pendiente,
                                consentimiento: consentimiento,
                              ),
                            ),
                          ),
                          child: const Text('Responder'),
                        ),
                        TextButton(
                          onPressed: () => ref.read(encuestaPospuestaProvider.notifier).posponer(),
                          child: const Text('Ahora no'),
                        ),
                      ],
                    ),
                  ],
                ),
              ),
            );
          },
          orElse: () => const SizedBox.shrink(),
        );
  }
}

/// RF-SO-05, RF-DE-06 · Una encuesta: primero el consentimiento, si falta;
/// despues los items, todos en la misma pantalla.
class PantallaEncuesta extends ConsumerStatefulWidget {
  const PantallaEncuesta({super.key, required this.pendiente, required this.consentimiento});

  final Map<String, dynamic> pendiente;
  final bool consentimiento;

  @override
  ConsumerState<PantallaEncuesta> createState() => _PantallaEncuestaState();
}

class _PantallaEncuestaState extends ConsumerState<PantallaEncuesta> {
  late bool _consentimiento = widget.consentimiento;
  final _valores = <int, int>{};
  var _enviando = false;

  Future<void> _autorizar() async {
    try {
      await ref.read(clienteApiProvider).actualizar(
        '/cumplimiento/consentimientos',
        cuerpo: {'finalidad': 'INVESTIGACION', 'otorgado': true},
      );
      setState(() => _consentimiento = true);
    } on ErrorApi catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
      }
    }
  }

  Future<void> _enviar(int items) async {
    setState(() => _enviando = true);
    final mensajero = ScaffoldMessenger.of(context);
    final navegador = Navigator.of(context);
    try {
      await ref.read(clienteApiProvider).enviar(
        '/encuestas/respuestas',
        cuerpo: {
          'codigo': widget.pendiente['codigo'],
          'version': widget.pendiente['version'],
          'momento': widget.pendiente['momento'],
          'valores': [for (var i = 1; i <= items; i++) _valores[i]],
        },
      );
      ref.invalidate(encuestasPendientesProvider);
      mensajero.showSnackBar(
        const SnackBar(content: Text('Gracias. Su respuesta se guardó sin su nombre.')),
      );
      navegador.pop();
    } on ErrorApi catch (e) {
      mensajero.showSnackBar(SnackBar(content: Text(e.mensaje)));
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final instrumento = ref.watch(instrumentoProvider(widget.pendiente['codigo'] as String));

    return Scaffold(
      appBar: AppBar(title: Text(widget.pendiente['nombre'] as String)),
      body: instrumento.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar la encuesta.',
          onReintentar: () =>
              ref.invalidate(instrumentoProvider(widget.pendiente['codigo'] as String)),
        ),
        data: (datos) => Contenido(
          child: ListView(
            children: [
              _Privacidad(consentimiento: _consentimiento, onAutorizar: _autorizar),
              if (_consentimiento) ..._items(context, datos),
            ],
          ),
        ),
      ),
    );
  }

  List<Widget> _items(BuildContext context, Map<String, dynamic> instrumento) {
    final tema = Theme.of(context);
    final escala = instrumento['escala'] as Map<String, dynamic>;
    final minimo = escala['minimo'] as int;
    final maximo = escala['maximo'] as int;
    final items = (instrumento['items'] as List<dynamic>).cast<Map<String, dynamic>>();
    final completa = items.every((i) => _valores.containsKey(i['numero']));

    return [
      const SizedBox(height: 12),
      Text(instrumento['instrucciones'] as String, style: tema.textTheme.bodyMedium),
      const SizedBox(height: 4),
      Text(
        '$minimo = ${escala['etiquetaMinimo']} · $maximo = ${escala['etiquetaMaximo']}',
        style: tema.textTheme.labelSmall?.copyWith(color: tema.colorScheme.onSurfaceVariant),
      ),
      for (final item in items)
        Padding(
          padding: const EdgeInsets.only(top: 16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('${item['numero']}. ${item['texto']}', style: tema.textTheme.bodyLarge),
              const SizedBox(height: 6),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [
                  for (var v = minimo; v <= maximo; v++)
                    Semantics(
                      label: v == minimo
                          ? '$v, ${escala['etiquetaMinimo']}'
                          : v == maximo
                              ? '$v, ${escala['etiquetaMaximo']}'
                              : '$v',
                      child: ChoiceChip(
                        label: Text('$v'),
                        selected: _valores[item['numero']] == v,
                        onSelected: (_) => setState(() => _valores[item['numero'] as int] = v),
                      ),
                    ),
                ],
              ),
            ],
          ),
        ),
      const SizedBox(height: 24),
      FilledButton(
        onPressed: completa && !_enviando ? () => _enviar(items.length) : null,
        child: Text(completa ? 'Enviar' : 'Responda todas las preguntas para enviar'),
      ),
      const SizedBox(height: 24),
    ];
  }
}

/// Lo que pasa con las respuestas, antes de la primera pregunta.
class _Privacidad extends StatelessWidget {
  const _Privacidad({required this.consentimiento, required this.onAutorizar});

  final bool consentimiento;
  final VoidCallback onAutorizar;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Qué pasa con sus respuestas', style: tema.textTheme.titleSmall),
            const SizedBox(height: 6),
            const Text(
              'Se guardan sin su nombre ni su cuenta, y solo se publican promedios de cinco '
              'personas o más. Sirven para saber si la plataforma cumple lo que promete. '
              'Responder es opcional y no cambia nada de sus aportes. Si después retira la '
              'autorización, sus respuestas quedan desvinculadas de usted.',
            ),
            if (!consentimiento) ...[
              const SizedBox(height: 10),
              FilledButton.tonal(
                onPressed: onAutorizar,
                child: const Text('Autorizo usar mis respuestas para investigación'),
              ),
            ],
          ],
        ),
      ),
    );
  }
}
