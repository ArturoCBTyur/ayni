import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';
import 'pantalla_fondos.dart';

/// Archivo capturado, ya subido al almacenamiento.
class _Adjunto {
  const _Adjunto({required this.objeto, required this.bytes, required this.mime});

  final String objeto;
  final List<int> bytes;
  final String mime;
}

/// CU10 · Registrar gasto con comprobante y evidencia.
///
/// En tres pasos y no en un formulario largo (RNF-14: el gasto se registra en
/// tres pantallas y menos de dos minutos). El operador de campo trabaja desde
/// el celular, muchas veces de pie y con poco tiempo, asi que cada pantalla
/// pide una sola cosa.
class PantallaRegistrarGasto extends ConsumerStatefulWidget {
  const PantallaRegistrarGasto({super.key, required this.ongId});

  final String ongId;

  @override
  ConsumerState<PantallaRegistrarGasto> createState() => _PantallaRegistrarGastoState();
}

class _PantallaRegistrarGastoState extends ConsumerState<PantallaRegistrarGasto> {
  final _selector = ImagePicker();

  int _paso = 0;
  bool _enviando = false;
  String? _error;

  _Adjunto? _comprobante;
  _Adjunto? _evidencia;

  /// Hora real de la captura, que se conserva al sincronizar (RNF-16).
  DateTime? _capturadoEn;

  String? _fondoId;
  final _monto = TextEditingController();
  final _concepto = TextEditingController();
  final _proveedor = TextEditingController();
  final _ruc = TextEditingController();
  final _serie = TextEditingController(text: 'B001');
  final _numero = TextEditingController();
  String _tipoComprobante = 'BOLETA';
  bool _contienePersonas = false;
  bool _consentimientoImagen = false;

  @override
  void dispose() {
    _monto.dispose();
    _concepto.dispose();
    _proveedor.dispose();
    _ruc.dispose();
    _serie.dispose();
    _numero.dispose();
    super.dispose();
  }

  Future<void> _capturar({required bool esComprobante}) async {
    final archivo = await _selector.pickImage(
      // La camara trasera es la que usa quien fotografia una boleta.
      source: ImageSource.camera,
      preferredCameraDevice: CameraDevice.rear,
      imageQuality: 88,
      maxWidth: 2400,
    );
    if (archivo == null) return;

    final bytes = await archivo.readAsBytes();
    final extension = archivo.name.split('.').last.toLowerCase();

    setState(() {
      _error = null;
      // Se registra la hora del dispositivo al capturar, no al subir: si no
      // hay conexion, el gasto se sincroniza despues sin parecer tardio.
      _capturadoEn ??= DateTime.now();
    });

    try {
      final api = ref.read(clienteApiProvider);
      final url = await api.enviar('/gastos/url-subida', cuerpo: {
        'tipo': esComprobante ? 'comprobante' : 'evidencia',
        'extension': ['jpg', 'jpeg', 'png', 'webp'].contains(extension) ? extension : 'jpg',
      });

      await api.subirArchivo(url['url'] as String, bytes, 'image/jpeg');

      final adjunto = _Adjunto(
        objeto: url['objeto'] as String,
        bytes: bytes,
        mime: 'image/jpeg',
      );

      setState(() {
        if (esComprobante) {
          _comprobante = adjunto;
        } else {
          _evidencia = adjunto;
        }
      });
    } on ErrorApi catch (e) {
      setState(() => _error = e.mensaje);
    }
  }

  Future<void> _registrar() async {
    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      final monto = double.parse(_monto.text.replaceAll(',', '.'));
      final subtotal = double.parse((monto / 1.18).toStringAsFixed(2));

      await ref.read(clienteApiProvider).enviar('/gastos', cuerpo: {
        'fondoId': _fondoId,
        'montoDeclarado': monto,
        'concepto': _concepto.text.trim(),
        'proveedorNombre': _proveedor.text.trim(),
        'fechaGasto': DateTime.now().toIso8601String(),
        if (_capturadoEn != null) 'capturadoEn': _capturadoEn!.toIso8601String(),
        'comprobante': {
          'tipo': _tipoComprobante,
          'rucEmisor': _ruc.text.trim(),
          'serie': _serie.text.trim().toUpperCase(),
          'numero': _numero.text.trim(),
          'fechaEmision': DateTime.now().toIso8601String(),
          'subtotal': subtotal,
          'igv': double.parse((monto - subtotal).toStringAsFixed(2)),
          'total': monto,
          'objeto': _comprobante!.objeto,
          'mime': _comprobante!.mime,
        },
        'evidencias': [
          {
            'tipo': 'FOTO',
            'objeto': _evidencia!.objeto,
            'mime': _evidencia!.mime,
            'contienePersonas': _contienePersonas,
            'consentimientoImagen': _consentimientoImagen,
          },
        ],
      });

      if (mounted) Navigator.of(context).pop(true);
    } on ErrorApi catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  bool get _pasoValido => switch (_paso) {
        0 => _comprobante != null && _evidencia != null,
        1 => _fondoId != null &&
            double.tryParse(_monto.text.replaceAll(',', '.')) != null &&
            _concepto.text.trim().length >= 5 &&
            _proveedor.text.trim().length >= 2,
        2 => _ruc.text.trim().length == 11 &&
            _numero.text.trim().isNotEmpty &&
            (!_contienePersonas || _consentimientoImagen),
        _ => false,
      };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Registrar gasto'),
        bottom: PreferredSize(
          preferredSize: const Size.fromHeight(4),
          child: LinearProgressIndicator(value: (_paso + 1) / 3),
        ),
      ),
      body: Contenido(
        ancho: 620,
        child: SingleChildScrollView(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              switch (_paso) {
                0 => _PasoCaptura(
                    comprobante: _comprobante,
                    evidencia: _evidencia,
                    onCapturar: _capturar,
                  ),
                1 => _PasoDatos(
                    ongId: widget.ongId,
                    fondoId: _fondoId,
                    monto: _monto,
                    concepto: _concepto,
                    proveedor: _proveedor,
                    onFondo: (v) => setState(() => _fondoId = v),
                    onCambio: () => setState(() {}),
                  ),
                _ => _PasoComprobante(
                    tipo: _tipoComprobante,
                    ruc: _ruc,
                    serie: _serie,
                    numero: _numero,
                    contienePersonas: _contienePersonas,
                    consentimiento: _consentimientoImagen,
                    onTipo: (v) => setState(() => _tipoComprobante = v),
                    onPersonas: (v) => setState(() => _contienePersonas = v),
                    onConsentimiento: (v) => setState(() => _consentimientoImagen = v),
                    onCambio: () => setState(() {}),
                  ),
              },

              if (_error != null) ...[
                const SizedBox(height: 16),
                Container(
                  padding: const EdgeInsets.all(12),
                  decoration: BoxDecoration(
                    color: TemaApp.nivelBajo.withValues(alpha: 0.08),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: Text(
                    _error!,
                    style: Theme.of(context).textTheme.bodySmall?.copyWith(
                          color: TemaApp.nivelBajo,
                        ),
                  ),
                ),
              ],

              const SizedBox(height: 24),
              Row(
                children: [
                  if (_paso > 0)
                    OutlinedButton(
                      onPressed: _enviando ? null : () => setState(() => _paso--),
                      child: const Text('Atrás'),
                    ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: FilledButton(
                      onPressed: (!_pasoValido || _enviando)
                          ? null
                          : () {
                              if (_paso < 2) {
                                setState(() => _paso++);
                              } else {
                                _registrar();
                              }
                            },
                      child: _enviando
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(_paso < 2 ? 'Continuar' : 'Registrar gasto'),
                    ),
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

class _PasoCaptura extends StatelessWidget {
  const _PasoCaptura({
    required this.comprobante,
    required this.evidencia,
    required this.onCapturar,
  });

  final _Adjunto? comprobante;
  final _Adjunto? evidencia;
  final Future<void> Function({required bool esComprobante}) onCapturar;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('1. Capture el comprobante y la evidencia', style: tema.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Sin ambos, el dinero retenido no se puede liberar.',
          style: tema.textTheme.bodySmall?.copyWith(color: tema.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 20),
        _Captura(
          titulo: 'Comprobante de pago',
          descripcion: 'La boleta o factura, completa y legible.',
          icono: Icons.receipt_long,
          adjunto: comprobante,
          onCapturar: () => onCapturar(esComprobante: true),
        ),
        const SizedBox(height: 12),
        _Captura(
          titulo: 'Evidencia del gasto',
          descripcion: 'Una foto de lo comprado o de la acción realizada.',
          icono: Icons.photo_camera,
          adjunto: evidencia,
          onCapturar: () => onCapturar(esComprobante: false),
        ),
      ],
    );
  }
}

class _Captura extends StatelessWidget {
  const _Captura({
    required this.titulo,
    required this.descripcion,
    required this.icono,
    required this.adjunto,
    required this.onCapturar,
  });

  final String titulo;
  final String descripcion;
  final IconData icono;
  final _Adjunto? adjunto;
  final VoidCallback onCapturar;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final listo = adjunto != null;

    return Card(
      child: InkWell(
        onTap: onCapturar,
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Row(
            children: [
              Icon(
                listo ? Icons.check_circle : icono,
                size: 32,
                color: listo ? TemaApp.nivelAlto : tema.colorScheme.outline,
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(titulo, style: tema.textTheme.titleSmall),
                    Text(
                      listo ? 'Capturado. Toque para repetir.' : descripcion,
                      style: tema.textTheme.bodySmall?.copyWith(
                        color: tema.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ),
              ),
              const Icon(Icons.chevron_right),
            ],
          ),
        ),
      ),
    );
  }
}

class _PasoDatos extends ConsumerWidget {
  const _PasoDatos({
    required this.ongId,
    required this.fondoId,
    required this.monto,
    required this.concepto,
    required this.proveedor,
    required this.onFondo,
    required this.onCambio,
  });

  final String ongId;
  final String? fondoId;
  final TextEditingController monto;
  final TextEditingController concepto;
  final TextEditingController proveedor;
  final ValueChanged<String?> onFondo;
  final VoidCallback onCambio;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final campanas = ref.watch(estadoFondosProvider(ongId));

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('2. ¿De qué fondo salió y en qué se gastó?', style: tema.textTheme.titleMedium),
        const SizedBox(height: 20),

        campanas.when(
          loading: () => const LinearProgressIndicator(),
          error: (_, _) => const Text('No pudimos cargar los fondos.'),
          data: (lista) {
            final fondos = [
              for (final c in lista)
                for (final f in (c['fondos'] as List<dynamic>).cast<Map<String, dynamic>>())
                  f,
            ];

            return DropdownMenu<String>(
              initialSelection: fondoId,
              expandedInsets: EdgeInsets.zero,
              label: const Text('Fondo'),
              helperText: 'Solo puede gastar de lo que ese fondo tiene retenido.',
              onSelected: onFondo,
              dropdownMenuEntries: [
                for (final f in fondos)
                  DropdownMenuEntry(
                    value: f['id'] as String,
                    label: '${f['nombre']} · ${Formato.soles(f['retenido'] as String?)}',
                  ),
              ],
            );
          },
        ),

        const SizedBox(height: 16),
        TextField(
          controller: monto,
          keyboardType: const TextInputType.numberWithOptions(decimal: true),
          decoration: const InputDecoration(labelText: 'Monto', prefixText: 'S/ '),
          onChanged: (_) => onCambio(),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: concepto,
          decoration: const InputDecoration(
            labelText: '¿En qué se gastó?',
            hintText: 'Alimento balanceado para veinte perros',
          ),
          onChanged: (_) => onCambio(),
        ),
        const SizedBox(height: 16),
        TextField(
          controller: proveedor,
          decoration: const InputDecoration(labelText: 'Proveedor'),
          onChanged: (_) => onCambio(),
        ),
      ],
    );
  }
}

class _PasoComprobante extends StatelessWidget {
  const _PasoComprobante({
    required this.tipo,
    required this.ruc,
    required this.serie,
    required this.numero,
    required this.contienePersonas,
    required this.consentimiento,
    required this.onTipo,
    required this.onPersonas,
    required this.onConsentimiento,
    required this.onCambio,
  });

  final String tipo;
  final TextEditingController ruc;
  final TextEditingController serie;
  final TextEditingController numero;
  final bool contienePersonas;
  final bool consentimiento;
  final ValueChanged<String> onTipo;
  final ValueChanged<bool> onPersonas;
  final ValueChanged<bool> onConsentimiento;
  final VoidCallback onCambio;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Text('3. Datos del comprobante', style: tema.textTheme.titleMedium),
        const SizedBox(height: 4),
        Text(
          'Cópielos del documento que fotografió. Verificamos el RUC y que las cifras cuadren.',
          style: tema.textTheme.bodySmall?.copyWith(color: tema.colorScheme.onSurfaceVariant),
        ),
        const SizedBox(height: 20),

        SegmentedButton<String>(
          selected: {tipo},
          onSelectionChanged: (s) => onTipo(s.first),
          segments: const [
            ButtonSegment(value: 'BOLETA', label: Text('Boleta')),
            ButtonSegment(value: 'FACTURA', label: Text('Factura')),
          ],
        ),
        const SizedBox(height: 16),

        TextField(
          controller: ruc,
          keyboardType: TextInputType.number,
          maxLength: 11,
          decoration: const InputDecoration(
            labelText: 'RUC del emisor',
            helperText: 'Los 11 dígitos. Se valida el dígito verificador.',
            counterText: '',
          ),
          onChanged: (_) => onCambio(),
        ),
        const SizedBox(height: 16),
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: serie,
                decoration: const InputDecoration(labelText: 'Serie'),
                onChanged: (_) => onCambio(),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              flex: 2,
              child: TextField(
                controller: numero,
                keyboardType: TextInputType.number,
                decoration: const InputDecoration(labelText: 'Número'),
                onChanged: (_) => onCambio(),
              ),
            ),
          ],
        ),

        const SizedBox(height: 24),
        // RF-DE-04 · Sin deteccion automatica de rostros, esta declaracion es
        // lo que activa la exigencia de anonimizar antes de publicar.
        SwitchListTile(
          value: contienePersonas,
          onChanged: onPersonas,
          contentPadding: EdgeInsets.zero,
          title: const Text('En la foto aparecen personas'),
          subtitle: const Text(
            'Si aparecen, deberá difuminar sus rostros antes de que el donante la vea.',
          ),
        ),
        if (contienePersonas)
          CheckboxListTile(
            value: consentimiento,
            onChanged: (v) => onConsentimiento(v ?? false),
            controlAffinity: ListTileControlAffinity.leading,
            contentPadding: EdgeInsets.zero,
            title: const Text('Cuento con su consentimiento para usar la imagen'),
            isError: !consentimiento,
          ),
      ],
    );
  }
}
