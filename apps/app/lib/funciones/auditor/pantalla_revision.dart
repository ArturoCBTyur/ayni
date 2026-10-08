import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/tarjeta_analisis.dart';
import '../../comun/visor_archivo.dart';
import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';
import 'pantalla_informe_ong.dart';

final gastoProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, gastoId) async {
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

    final ongId = gasto.value?['ongId'] as String?;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Revisar gasto'),
        actions: [
          if (ongId != null)
            IconButton(
              tooltip: 'Informe de auditoría de la organización',
              icon: const Icon(Icons.summarize_outlined),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => PantallaInformeOng(ongId: ongId)),
              ),
            ),
        ],
      ),
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
    final evidencias =
        (datos['evidencias'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();

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

            if (analisis != null) TarjetaAnalisis(analisis: analisis),
            for (final alerta
                in (datos['alertas'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
              _Alerta(gastoId: gastoId, alerta: alerta),
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

            const SizedBox(height: 20),
            Text('Los archivos originales', style: tema.textTheme.titleSmall),
            const SizedBox(height: 4),
            Text(
              // El auditor es el unico rol que recibe los originales: es lo
              // que necesita para comparar, y lo que nadie mas debe ver.
              'Usted ve los originales, con rostros sin difuminar. Toque una imagen para '
              'ampliarla.',
              style: tema.textTheme.bodySmall?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 10),
            Wrap(
              spacing: 12,
              runSpacing: 12,
              children: [
                if (comprobante != null)
                  MiniaturaArchivo(
                    url: comprobante['url'] as String?,
                    mime: comprobante['mime'] as String?,
                    etiqueta: 'Comprobante ${comprobante['serie']}-${comprobante['numero']}',
                  ),
                for (final (i, evidencia) in evidencias.indexed)
                  MiniaturaArchivo(
                    url: evidencia['url'] as String?,
                    etiqueta: etiquetaEvidencia(i, evidencia),
                  ),
              ],
            ),

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

/// Una alerta abierta del gasto, con la opcion de descartarla si no
/// corresponde. Descartar la saca del puntaje de la ONG, asi que pide nota.
class _Alerta extends ConsumerWidget {
  const _Alerta({required this.gastoId, required this.alerta});

  final String gastoId;
  final Map<String, dynamic> alerta;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final plazo = Formato.aFecha(alerta['plazoSubsanacion']);

    return Card(
      margin: const EdgeInsets.only(top: 12),
      color: TemaApp.nivelMedio.withValues(alpha: 0.08),
      child: ListTile(
        leading: Icon(Icons.warning_amber_outlined, color: TemaApp.nivelMedio),
        title: Text(alerta['titulo'] as String? ?? 'Alerta'),
        subtitle: Text(
          '${alerta['descripcion'] ?? ''}\n'
          '${alerta['estado'] == 'EN_SUBSANACION' ? 'La ONG la respondió' : 'Abierta'}'
          '${plazo != null ? ' · plazo ${Formato.fecha(plazo)}' : ''}',
          style: tema.textTheme.bodySmall,
        ),
        isThreeLine: true,
        trailing: TextButton(
          onPressed: () => _descartar(context, ref),
          child: const Text('Descartar'),
        ),
      ),
    );
  }

  Future<void> _descartar(BuildContext context, WidgetRef ref) async {
    final nota = await pedirTexto(
      context,
      titulo: 'Descartar alerta',
      explicacion: 'Deja de contar para el puntaje de la ONG. Explique por qué no corresponde.',
      minimo: 10,
      accion: 'Descartar',
    );
    if (nota == null || !context.mounted) return;

    final mensajero = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(clienteApiProvider)
          .enviar('/alertas/${alerta['id']}/descartar', cuerpo: {'nota': nota});
      ref.invalidate(gastoProvider(gastoId));
      mensajero.showSnackBar(const SnackBar(content: Text('Alerta descartada.')));
    } on ErrorApi catch (e) {
      mensajero.showSnackBar(SnackBar(content: Text(e.mensaje)));
    }
  }
}

/// Dialogo que pide un texto con un minimo de caracteres. Devuelve null si
/// se cancela.
Future<String?> pedirTexto(
  BuildContext context, {
  required String titulo,
  required String explicacion,
  required int minimo,
  required String accion,
}) {
  final controlador = TextEditingController();
  String? error;

  return showDialog<String>(
    context: context,
    builder: (context) => StatefulBuilder(
      builder: (context, setState) => AlertDialog(
        title: Text(titulo),
        content: SizedBox(
          width: 440,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(explicacion),
              const SizedBox(height: 12),
              TextField(
                controller: controlador,
                maxLines: 3,
                decoration: InputDecoration(labelText: 'Motivo', errorText: error),
              ),
            ],
          ),
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(context).pop(), child: const Text('Cancelar')),
          FilledButton(
            onPressed: () {
              final texto = controlador.text.trim();
              if (texto.length < minimo) {
                setState(() => error = 'Escriba al menos $minimo caracteres.');
                return;
              }
              Navigator.of(context).pop(texto);
            },
            child: Text(accion),
          ),
        ],
      ),
    ),
  );
}

/// Pie de una evidencia: su numero y si tiene personas, que es lo que decide
/// quien puede verla.
String etiquetaEvidencia(int indice, Map<String, dynamic> evidencia) {
  final base = 'Evidencia ${indice + 1}';
  if (evidencia['contienePersonas'] != true) return base;
  return evidencia['anonimizada'] == true
      ? '$base · con personas, difuminada para el donante'
      : '$base · con personas, todavía sin difuminar';
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
