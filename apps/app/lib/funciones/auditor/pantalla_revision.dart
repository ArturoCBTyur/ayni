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

            if (analisis?['datosExtraidos'] != null) ...[
              const SizedBox(height: 20),
              _LoQueDiceElPapel(
                extraidos: analisis!['datosExtraidos'] as Map<String, dynamic>,
                comprobante: comprobante,
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

/// RF-IA-02 · Lo que el lector sacó del documento, frente a lo declarado.
///
/// El auditor ya veía la discrepancia narrada dentro de un motivo —«el
/// comprobante dice S/ 158.00 y se declaró S/ 185.00»— perdida entre quince
/// líneas de otras comprobaciones. Puesta campo a campo al lado de lo
/// declarado se ve de un golpe, que es lo que necesita quien tiene que decidir.
///
/// El veredicto no lo da esta tarjeta: lo dan los motivos de abajo, que son los
/// que el motor calculó con su tolerancia. Aquí la marca de diferencia es una
/// ayuda visual sobre los importes ya redondeados a céntimos.
class _LoQueDiceElPapel extends StatelessWidget {
  const _LoQueDiceElPapel({required this.extraidos, required this.comprobante});

  final Map<String, dynamic> extraidos;
  final Map<String, dynamic>? comprobante;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    // Sin lectura no hay nada que cotejar, y decirlo importa: significa que
    // los datos del comprobante no se verificaron contra el documento.
    if (extraidos['fuente'] != 'ocr') {
      return Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 18, color: tema.colorScheme.onSurfaceVariant),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              'El modelo no pudo leer el comprobante. Los datos se evaluaron tal '
              'como se declararon, sin contrastarlos con el documento.',
              style: tema.textTheme.bodySmall?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
          ),
        ],
      );
    }

    final serie = extraidos['serie'];
    final numero = extraidos['numero'];
    final leidoDocumento = serie == null || numero == null ? null : '$serie-$numero';
    final declaradoDocumento = comprobante == null
        ? null
        : '${comprobante!['serie']}-${comprobante!['numero']}';

    final totalLeido = (extraidos['total'] as num?)?.toDouble();
    final totalDeclarado = double.tryParse('${comprobante?['total']}');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            Icon(Icons.document_scanner_outlined, size: 18, color: tema.colorScheme.primary),
            const SizedBox(width: 8),
            Text('Lo que el modelo leyó en el papel', style: tema.textTheme.titleSmall),
          ],
        ),
        const SizedBox(height: 8),
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _FilaCotejo(
                  etiqueta: 'Documento',
                  leido: leidoDocumento,
                  declarado: declaradoDocumento,
                  coincide: leidoDocumento != null &&
                      _mismoNumero(leidoDocumento, declaradoDocumento),
                ),
                _FilaCotejo(
                  etiqueta: 'RUC emisor',
                  leido: extraidos['rucEmisor'] as String?,
                  declarado: comprobante?['rucEmisor'] as String?,
                  coincide: extraidos['rucEmisor'] == comprobante?['rucEmisor'],
                ),
                _FilaCotejo(
                  etiqueta: 'Fecha de emisión',
                  leido: Formato.fecha(Formato.aFecha(extraidos['fechaEmision'])),
                  declarado: Formato.fecha(Formato.aFecha(comprobante?['fechaEmision'])),
                  coincide: Formato.aFecha(extraidos['fechaEmision']) ==
                      Formato.aFecha(comprobante?['fechaEmision']),
                ),
                _FilaCotejo(
                  etiqueta: 'Importe total',
                  leido: Formato.soles(totalLeido?.toString()),
                  declarado: Formato.soles(comprobante?['total'] as String?),
                  coincide: totalLeido != null &&
                      totalDeclarado != null &&
                      (totalLeido - totalDeclarado).abs() <= 0.05,
                  destacado: true,
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// «004521» y «4521» son el mismo comprobante: el cero de relleno depende
  /// de cómo lo imprime cada emisor, no del documento.
  static bool _mismoNumero(String leido, String? declarado) {
    if (declarado == null) return false;
    String limpiar(String v) {
      final partes = v.split('-');
      if (partes.length < 2) return v.toUpperCase();
      return '${partes[0].toUpperCase()}-${partes[1].replaceFirst(RegExp(r'^0+'), '')}';
    }

    return limpiar(leido) == limpiar(declarado);
  }
}

class _FilaCotejo extends StatelessWidget {
  const _FilaCotejo({
    required this.etiqueta,
    required this.leido,
    required this.declarado,
    required this.coincide,
    this.destacado = false,
  });

  final String etiqueta;
  final String? leido;
  final String? declarado;
  final bool coincide;
  final bool destacado;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final sinLeer = leido == null || leido == '—';

    final color = sinLeer
        ? tema.colorScheme.onSurfaceVariant
        : coincide
            ? TemaApp.nivelAlto
            : TemaApp.nivelBajo;

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
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  sinLeer ? 'no se pudo leer' : leido!,
                  style: (destacado ? tema.textTheme.titleMedium : tema.textTheme.bodyMedium)
                      ?.copyWith(
                    color: color,
                    fontWeight: destacado ? FontWeight.w600 : null,
                    fontStyle: sinLeer ? FontStyle.italic : null,
                  ),
                ),
                if (!sinLeer && !coincide)
                  Text(
                    'se declaró ${declarado ?? '—'}',
                    style: tema.textTheme.bodySmall?.copyWith(color: TemaApp.nivelBajo),
                  ),
              ],
            ),
          ),
          if (!sinLeer)
            Semantics(
              label: coincide ? 'Coincide con lo declarado' : 'No coincide con lo declarado',
              child: Icon(
                coincide ? Icons.check_circle_outline : Icons.error_outline,
                size: 18,
                color: color,
              ),
            ),
        ],
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
