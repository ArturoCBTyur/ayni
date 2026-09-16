import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';

final gastoProvider =
    FutureProvider.family<Map<String, dynamic>, String>((ref, gastoId) async {
  return ref.read(clienteApiProvider).obtener('/gastos/$gastoId');
});

/// CU15 · Vista comparativa y decision del auditor.
///
/// Muestra lado a lado lo declarado, el comprobante y los motivos del motor.
/// La decision exige un comentario: una aprobacion sin fundamento registrado
/// no es auditable, y ademas cada decision queda como etiqueta para el
/// futuro reentrenamiento de AIni.
class PantallaRevision extends ConsumerWidget {
  const PantallaRevision({super.key, required this.gastoId});

  final String gastoId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final gasto = ref.watch(gastoProvider(gastoId));

    return Scaffold(
      appBar: AppBar(title: const Text('Revisar gasto')),
      body: gasto.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar el gasto.',
          onReintentar: () => ref.invalidate(gastoProvider(gastoId)),
        ),
        data: (datos) => _Detalle(gastoId: gastoId, datos: datos),
      ),
    );
  }
}

class _Detalle extends ConsumerWidget {
  const _Detalle({required this.gastoId, required this.datos});

  final String gastoId;
  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final comprobante = datos['comprobante'] as Map<String, dynamic>?;
    final analisis = datos['analisis'] as Map<String, dynamic>?;

    return SingleChildScrollView(
      child: Contenido(
        ancho: 760,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
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
            const SizedBox(height: 16),

            if (analisis != null) _Analisis(analisis: analisis),
            const SizedBox(height: 20),

            Text('Lo declarado', style: tema.textTheme.titleSmall),
            const SizedBox(height: 8),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  children: [
                    FilaDato(etiqueta: 'Proveedor', valor: datos['proveedor'] as String),
                    FilaDato(etiqueta: 'Fondo', valor: (datos['fondo'] as Map)['nombre'] as String),
                    FilaDato(etiqueta: 'Campaña', valor: datos['campana'] as String),
                    FilaDato(
                      etiqueta: 'Fecha del gasto',
                      valor: Formato.fecha(Formato.aFecha(datos['fechaGasto'])),
                    ),
                    if (datos['capturadoEn'] != null)
                      FilaDato(
                        etiqueta: 'Capturado en campo',
                        valor: Formato.fechaHora(Formato.aFecha(datos['capturadoEn'])),
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
                  child: Column(
                    children: [
                      FilaDato(
                        etiqueta: 'Documento',
                        valor: '${comprobante['tipo']} ${comprobante['serie']}-${comprobante['numero']}',
                      ),
                      FilaDato(etiqueta: 'RUC emisor', valor: comprobante['rucEmisor'] as String),
                      FilaDato(
                        etiqueta: 'Total',
                        valor: Formato.soles(comprobante['total'] as String?),
                        destacado: true,
                      ),
                      FilaDato(
                        etiqueta: 'Validez',
                        valor: switch (comprobante['validezCpe']) {
                          'VALIDO' => 'Bien formado (sin confirmar ante SUNAT)',
                          'INVALIDO' => 'Formato inválido',
                          _ => 'Sin validar',
                        },
                      ),
                    ],
                  ),
                ),
              ),
            ],

            const SizedBox(height: 28),
            _Acciones(gastoId: gastoId, montoDeclarado: datos['monto'] as String),
          ],
        ),
      ),
    );
  }
}

/// RNF-09 · Los motivos del puntaje, en lenguaje legible.
class _Analisis extends StatelessWidget {
  const _Analisis({required this.analisis});

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

class _Acciones extends ConsumerStatefulWidget {
  const _Acciones({required this.gastoId, required this.montoDeclarado});

  final String gastoId;
  final String montoDeclarado;

  @override
  ConsumerState<_Acciones> createState() => _AccionesState();
}

class _AccionesState extends ConsumerState<_Acciones> {
  final _comentario = TextEditingController();
  bool _enviando = false;
  String? _error;

  @override
  void dispose() {
    _comentario.dispose();
    super.dispose();
  }

  Future<void> _decidir(String decision) async {
    if (_comentario.text.trim().length < 15) {
      setState(() => _error = 'Explique su decisión en al menos 15 caracteres.');
      return;
    }

    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      await ref.read(clienteApiProvider).enviar(
        '/auditoria/gastos/${widget.gastoId}/revision',
        cuerpo: {'decision': decision, 'comentario': _comentario.text.trim()},
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
    final tema = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('Su decisión', style: tema.textTheme.titleSmall),
        const SizedBox(height: 8),
        TextField(
          controller: _comentario,
          maxLines: 3,
          decoration: const InputDecoration(
            labelText: 'Fundamento',
            helperText: 'Obligatorio. Queda como registro auditable y como etiqueta de calidad.',
            helperMaxLines: 2,
          ),
          onChanged: (_) {
            if (_error != null) setState(() => _error = null);
          },
        ),
        if (_error != null) ...[
          const SizedBox(height: 8),
          Text(_error!, style: tema.textTheme.bodySmall?.copyWith(color: TemaApp.nivelBajo)),
        ],
        const SizedBox(height: 16),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            FilledButton.icon(
              onPressed: _enviando ? null : () => _decidir('APROBAR'),
              icon: const Icon(Icons.check),
              label: Text('Aprobar ${Formato.soles(widget.montoDeclarado)}'),
            ),
            OutlinedButton.icon(
              onPressed: _enviando ? null : () => _decidir('OBSERVAR'),
              icon: const Icon(Icons.edit_note),
              label: const Text('Observar'),
            ),
            OutlinedButton.icon(
              onPressed: _enviando ? null : () => _decidir('RECHAZAR'),
              style: OutlinedButton.styleFrom(foregroundColor: TemaApp.nivelBajo),
              icon: const Icon(Icons.close),
              label: const Text('Rechazar'),
            ),
          ],
        ),
      ],
    );
  }
}
