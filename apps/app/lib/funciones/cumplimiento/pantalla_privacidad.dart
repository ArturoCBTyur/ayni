import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';

final consentimientosProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  return ref.read(clienteApiProvider).obtenerLista('/cumplimiento/consentimientos');
});

final misSolicitudesProvider = FutureProvider<List<Map<String, dynamic>>>((ref) async {
  return ref.read(clienteApiProvider).obtenerLista('/cumplimiento/arco');
});

/// Finalidades del consentimiento, con lo que cada una habilita.
///
/// El texto explica que pasa si se revoca, no solo que se revoca. Un
/// consentimiento que se otorga sin entender su alcance no es consentimiento
/// (RNF-05, Ley N.o 29733).
const _finalidades = <({String codigo, String titulo, String detalle, bool esencial})>[
  (
    codigo: 'TRATAMIENTO_DATOS',
    titulo: 'Tratamiento de mis datos',
    detalle: 'Necesario para tener cuenta, donar y recibir el comprobante de cada aporte. '
        'Si lo revoca, no podrá seguir usando la plataforma.',
    esencial: true,
  ),
  (
    codigo: 'COMUNICACIONES',
    titulo: 'Comunicaciones sobre mis aportes',
    detalle: 'Avisos de qué se hizo con su dinero y resúmenes de impacto. Si lo revoca, '
        'sus donaciones siguen igual: solo dejará de recibir estos mensajes.',
    esencial: false,
  ),
  (
    codigo: 'USO_IMAGEN',
    titulo: 'Uso de mi nombre en agradecimientos',
    detalle: 'Permite que su nombre aparezca al agradecer públicamente. Si lo revoca, '
        'sus aportes pasan a figurar como anónimos.',
    esencial: false,
  ),
];

/// CU21 · Mis datos y privacidad (RF-DE-01, RF-DE-02).
class PantallaPrivacidad extends ConsumerWidget {
  const PantallaPrivacidad({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Mis datos y privacidad')),
      body: ListView(
        children: [
          Contenido(
            ancho: 720,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text('Permisos que ha dado', style: tema.textTheme.titleLarge),
                Text(
                  'Puede cambiarlos cuando quiera. Guardamos el historial de cada cambio, '
                  'no lo borramos.',
                  style: tema.textTheme.bodySmall?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                const _Consentimientos(),
                const SizedBox(height: 32),
                Text('Mis solicitudes sobre mis datos', style: tema.textTheme.titleLarge),
                Text(
                  'La Ley N.° 29733 le reconoce el derecho a acceder a sus datos, '
                  'corregirlos, cancelarlos u oponerse a su uso.',
                  style: tema.textTheme.bodySmall?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 12),
                const _MisSolicitudes(),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 12,
                  runSpacing: 8,
                  children: [
                    FilledButton.icon(
                      onPressed: () => _nuevaSolicitud(context, ref),
                      icon: const Icon(Icons.add),
                      label: const Text('Presentar una solicitud'),
                    ),
                    OutlinedButton.icon(
                      onPressed: () => _exportar(context, ref),
                      icon: const Icon(Icons.download_outlined),
                      label: const Text('Ver todos mis datos'),
                    ),
                  ],
                ),
                const SizedBox(height: 32),
              ],
            ),
          ),
        ],
      ),
    );
  }

  Future<void> _nuevaSolicitud(BuildContext context, WidgetRef ref) async {
    final creada = await showDialog<bool>(
      context: context,
      builder: (_) => const _DialogoNuevaSolicitud(),
    );
    if (creada == true) ref.invalidate(misSolicitudesProvider);
  }

  Future<void> _exportar(BuildContext context, WidgetRef ref) async {
    try {
      final datos = await ref.read(clienteApiProvider).obtener('/cumplimiento/arco/exportacion');
      if (!context.mounted) return;
      await showDialog<void>(
        context: context,
        builder: (_) => _DialogoExportacion(datos: datos),
      );
    } on ErrorApi catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
      }
    }
  }
}

class _Consentimientos extends ConsumerWidget {
  const _Consentimientos();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final consentimientos = ref.watch(consentimientosProvider);

    return consentimientos.when(
      loading: () => const Center(child: Padding(
        padding: EdgeInsets.all(24),
        child: CircularProgressIndicator(),
      )),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar sus permisos.',
        onReintentar: () => ref.invalidate(consentimientosProvider),
      ),
      data: (filas) {
        // El backend devuelve solo los vigentes; la ausencia de una finalidad
        // significa que no esta otorgada. Se listan las tres igual, porque
        // ocultar un permiso no otorgado es ocultar que existe.
        final otorgados = {
          for (final f in filas) f['finalidad'] as String: f,
        };

        return Card(
          child: Column(
            children: [
              for (final f in _finalidades)
                _FilaConsentimiento(
                  finalidad: f,
                  otorgado: (otorgados[f.codigo]?['otorgado'] as bool?) ?? false,
                  desde: Formato.aFecha(otorgados[f.codigo]?['otorgadoEn']),
                ),
            ],
          ),
        );
      },
    );
  }
}

class _FilaConsentimiento extends ConsumerStatefulWidget {
  const _FilaConsentimiento({
    required this.finalidad,
    required this.otorgado,
    required this.desde,
  });

  final ({String codigo, String titulo, String detalle, bool esencial}) finalidad;
  final bool otorgado;
  final DateTime? desde;

  @override
  ConsumerState<_FilaConsentimiento> createState() => _FilaConsentimientoState();
}

class _FilaConsentimientoState extends ConsumerState<_FilaConsentimiento> {
  bool _guardando = false;

  Future<void> _cambiar(bool valor) async {
    // Revocar el consentimiento esencial deja la cuenta sin acceso. Es
    // legitimo hacerlo y no se impide, pero no puede ocurrir por un toque
    // accidental sobre un interruptor.
    if (!valor && widget.finalidad.esencial) {
      final confirmado = await showDialog<bool>(
        context: context,
        builder: (dialogo) => AlertDialog(
          title: const Text('¿Revocar este permiso?'),
          content: Text(widget.finalidad.detalle),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(dialogo).pop(false),
              child: const Text('Mantener'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(dialogo).pop(true),
              child: const Text('Revocar de todos modos'),
            ),
          ],
        ),
      );
      if (confirmado != true) return;
    }

    if (!mounted) return;
    setState(() => _guardando = true);
    try {
      await ref.read(clienteApiProvider).actualizar(
        '/cumplimiento/consentimientos',
        cuerpo: {'finalidad': widget.finalidad.codigo, 'otorgado': valor},
      );
      ref.invalidate(consentimientosProvider);
    } on ErrorApi catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
      }
    } finally {
      if (mounted) setState(() => _guardando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return SwitchListTile(
      value: widget.otorgado,
      onChanged: _guardando ? null : _cambiar,
      isThreeLine: true,
      title: Text(widget.finalidad.titulo),
      subtitle: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(widget.finalidad.detalle, style: tema.textTheme.bodySmall),
          if (widget.otorgado && widget.desde != null)
            Text(
              'Otorgado el ${Formato.fecha(widget.desde)}',
              style: tema.textTheme.labelSmall?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
        ],
      ),
    );
  }
}

class _MisSolicitudes extends ConsumerWidget {
  const _MisSolicitudes();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final solicitudes = ref.watch(misSolicitudesProvider);
    final tema = Theme.of(context);

    return solicitudes.when(
      loading: () => const Center(child: Padding(
        padding: EdgeInsets.all(24),
        child: CircularProgressIndicator(),
      )),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar sus solicitudes.',
        onReintentar: () => ref.invalidate(misSolicitudesProvider),
      ),
      data: (filas) {
        if (filas.isEmpty) {
          return const EstadoVacio(
            icono: Icons.privacy_tip_outlined,
            titulo: 'No ha presentado ninguna solicitud',
            descripcion:
                'Puede pedir una copia de sus datos, corregirlos, cancelarlos u oponerse '
                'a que se usen. Le respondemos dentro del plazo legal.',
          );
        }

        return Column(
          children: [
            for (final s in filas)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              tituloArco(s['tipo'] as String),
                              style: tema.textTheme.titleSmall,
                            ),
                          ),
                          _InsigniaEstadoArco(
                            estado: s['estado'] as String,
                            vencida: s['vencida'] == true,
                          ),
                        ],
                      ),
                      const SizedBox(height: 6),
                      Text(s['detalle'] as String, style: tema.textTheme.bodyMedium),
                      const SizedBox(height: 8),
                      _Plazo(
                        limite: Formato.aFecha(s['plazoLimite']),
                        resuelta: s['respondidoEn'] != null,
                        vencida: s['vencida'] == true,
                      ),
                      if (s['respuesta'] != null) ...[
                        const Divider(height: 24),
                        Text(
                          'Respuesta',
                          style: tema.textTheme.labelMedium?.copyWith(
                            color: tema.colorScheme.primary,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(s['respuesta'] as String, style: tema.textTheme.bodyMedium),
                        Text(
                          Formato.fechaHora(Formato.aFecha(s['respondidoEn'])),
                          style: tema.textTheme.labelSmall?.copyWith(
                            color: tema.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
          ],
        );
      },
    );
  }
}

/// Plazo legal, dicho en dias y no solo en fecha.
///
/// "Vence el 3 de octubre" obliga a calcular; "faltan 4 dias habiles" se
/// entiende de una vez. Para quien atiende la solicitud, esa diferencia es la
/// que evita el incumplimiento.
class _Plazo extends StatelessWidget {
  const _Plazo({required this.limite, required this.resuelta, required this.vencida});

  final DateTime? limite;
  final bool resuelta;
  final bool vencida;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    if (limite == null) return const SizedBox.shrink();

    if (resuelta) {
      return Text(
        'Plazo legal: ${Formato.fecha(limite)}',
        style: tema.textTheme.labelSmall?.copyWith(
          color: tema.colorScheme.onSurfaceVariant,
        ),
      );
    }

    final dias = limite!.difference(DateTime.now()).inDays;
    final color = vencida
        ? TemaApp.nivelBajo
        : dias <= 3
            ? TemaApp.nivelMedio
            : tema.colorScheme.onSurfaceVariant;

    final texto = vencida
        ? 'Fuera de plazo desde el ${Formato.fecha(limite)}'
        : dias <= 0
            ? 'Vence hoy'
            : 'Faltan $dias día(s) · vence el ${Formato.fecha(limite)}';

    return Row(
      children: [
        Icon(vencida ? Icons.error_outline : Icons.schedule, size: 16, color: color),
        const SizedBox(width: 6),
        Text(texto, style: tema.textTheme.labelMedium?.copyWith(color: color)),
      ],
    );
  }
}

class _InsigniaEstadoArco extends StatelessWidget {
  const _InsigniaEstadoArco({required this.estado, required this.vencida});

  final String estado;
  final bool vencida;

  @override
  Widget build(BuildContext context) {
    final color = vencida
        ? TemaApp.nivelBajo
        : switch (estado) {
            'ATENDIDA' => TemaApp.nivelAlto,
            'RECHAZADA' => TemaApp.nivelBajo,
            'EN_PROCESO' => TemaApp.nivelMedio,
            _ => Theme.of(context).colorScheme.onSurfaceVariant,
          };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.14),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        etiquetaEstadoArco(estado),
        style: Theme.of(context)
            .textTheme
            .labelSmall
            ?.copyWith(color: color, fontWeight: FontWeight.w700),
      ),
    );
  }
}

class _DialogoNuevaSolicitud extends ConsumerStatefulWidget {
  const _DialogoNuevaSolicitud();

  @override
  ConsumerState<_DialogoNuevaSolicitud> createState() => _DialogoNuevaSolicitudState();
}

class _DialogoNuevaSolicitudState extends ConsumerState<_DialogoNuevaSolicitud> {
  final _detalle = TextEditingController();
  final _formulario = GlobalKey<FormState>();
  String _tipo = 'ACCESO';
  bool _enviando = false;
  String? _error;

  @override
  void dispose() {
    _detalle.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    if (!(_formulario.currentState?.validate() ?? false)) return;

    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await ref.read(clienteApiProvider).enviar(
        '/cumplimiento/arco',
        cuerpo: {'tipo': _tipo, 'detalle': _detalle.text.trim()},
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
      title: const Text('Solicitud sobre mis datos'),
      content: SizedBox(
        width: 460,
        child: SingleChildScrollView(
          child: Form(
            key: _formulario,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                RadioGroup<String>(
                  groupValue: _tipo,
                  onChanged: (v) => setState(() => _tipo = v ?? _tipo),
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      for (final t in _tiposArco)
                        RadioListTile<String>(
                          value: t.codigo,
                          contentPadding: EdgeInsets.zero,
                          title: Text(t.titulo),
                          subtitle: Text(t.detalle, style: tema.textTheme.bodySmall),
                        ),
                    ],
                  ),
                ),
                const SizedBox(height: 12),
                TextFormField(
                  controller: _detalle,
                  minLines: 3,
                  maxLines: 6,
                  maxLength: 2000,
                  decoration: const InputDecoration(
                    labelText: 'Explique su solicitud',
                    helperText: 'Mientras más concreto, más rápido podemos atenderla',
                    alignLabelWithHint: true,
                  ),
                  validator: (v) => (v ?? '').trim().length >= 10
                      ? null
                      : 'Describa su solicitud con al menos 10 caracteres.',
                ),
                // El plazo se dice antes de enviar, no despues: es la
                // obligacion que la plataforma esta asumiendo al recibirla.
                Text(
                  'Plazo legal de respuesta: ${_tipo == 'ACCESO' ? 20 : 10} días hábiles.',
                  style: tema.textTheme.labelMedium?.copyWith(
                    color: tema.colorScheme.primary,
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 12),
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
              : const Text('Presentar'),
        ),
      ],
    );
  }
}

/// Los datos personales tal como estan guardados.
///
/// Se muestran en pantalla y se pueden copiar, en lugar de descargar un
/// archivo: la descarga en Flutter Web necesita `dart:html`, que rompe la
/// compilacion para Android e iOS (RNF-17). El derecho de acceso se satisface
/// igual, porque lo que la ley exige es que el titular pueda conocer sus
/// datos, no un formato concreto.
class _DialogoExportacion extends StatelessWidget {
  const _DialogoExportacion({required this.datos});

  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context) {
    final texto = const JsonEncoder.withIndent('  ').convert(datos);

    return AlertDialog(
      title: const Text('Todos mis datos'),
      content: SizedBox(
        width: 560,
        height: 420,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              datos['aviso'] as String? ?? '',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 12),
            Expanded(
              child: Container(
                width: double.infinity,
                padding: const EdgeInsets.all(12),
                decoration: BoxDecoration(
                  color: Theme.of(context).colorScheme.surfaceContainerHighest,
                  borderRadius: BorderRadius.circular(8),
                ),
                child: SingleChildScrollView(
                  child: SelectableText(
                    texto,
                    style: const TextStyle(fontFamily: 'monospace', fontSize: 12),
                  ),
                ),
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton.icon(
          onPressed: () async {
            await Clipboard.setData(ClipboardData(text: texto));
            if (context.mounted) {
              ScaffoldMessenger.of(context).showSnackBar(
                const SnackBar(content: Text('Datos copiados')),
              );
            }
          },
          icon: const Icon(Icons.copy_outlined),
          label: const Text('Copiar'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cerrar'),
        ),
      ],
    );
  }
}

const _tiposArco = <({String codigo, String titulo, String detalle})>[
  (
    codigo: 'ACCESO',
    titulo: 'Acceso',
    detalle: 'Quiero saber qué datos míos tienen y para qué los usan.',
  ),
  (
    codigo: 'RECTIFICACION',
    titulo: 'Rectificación',
    detalle: 'Hay un dato mío equivocado o incompleto y quiero corregirlo.',
  ),
  (
    codigo: 'CANCELACION',
    titulo: 'Cancelación',
    detalle: 'Quiero que eliminen mis datos cuando ya no sean necesarios.',
  ),
  (
    codigo: 'OPOSICION',
    titulo: 'Oposición',
    detalle: 'No quiero que usen mis datos para una finalidad determinada.',
  ),
];

String tituloArco(String tipo) => switch (tipo) {
      'ACCESO' => 'Acceso a mis datos',
      'RECTIFICACION' => 'Rectificación de mis datos',
      'CANCELACION' => 'Cancelación de mis datos',
      'OPOSICION' => 'Oposición al uso de mis datos',
      _ => tipo,
    };

String etiquetaEstadoArco(String estado) => switch (estado) {
      'RECIBIDA' => 'Recibida',
      'EN_PROCESO' => 'En proceso',
      'ATENDIDA' => 'Atendida',
      'RECHAZADA' => 'Rechazada',
      _ => estado,
    };
