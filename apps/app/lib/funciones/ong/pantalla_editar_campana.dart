import 'dart:typed_data';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:image_picker/image_picker.dart';

import '../../comun/visor_archivo.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';

/// RF-04 · Crear o editar una campaña: la causa que ve el donante.
///
/// Una campaña nueva nace en borrador. Publicarla es otro paso, en la lista,
/// porque exige cosas que este formulario no puede garantizar: que la ONG
/// este verificada y que haya al menos un fondo al que donar.
///
/// Devuelve el id de la campaña guardada, o null si se cancelo.
class PantallaEditarCampana extends ConsumerStatefulWidget {
  const PantallaEditarCampana({super.key, required this.ongId, this.campana});

  final String ongId;

  /// La campaña a editar, tal como la devuelve el estado de fondos.
  final Map<String, dynamic>? campana;

  @override
  ConsumerState<PantallaEditarCampana> createState() => _PantallaEditarCampanaState();
}

class _PantallaEditarCampanaState extends ConsumerState<PantallaEditarCampana> {
  final _formulario = GlobalKey<FormState>();
  late final _titulo = TextEditingController(text: widget.campana?['titulo'] as String?);
  late final _causa = TextEditingController(text: widget.campana?['causa'] as String?);
  late final _descripcion =
      TextEditingController(text: widget.campana?['descripcion'] as String?);
  late final _departamento =
      TextEditingController(text: widget.campana?['departamento'] as String?);

  late DateTime _inicio = Formato.aDia(widget.campana?['fechaInicio']) ?? _hoy();
  late DateTime? _fin = Formato.aDia(widget.campana?['fechaFin']);

  /// Portada recien subida: el objeto para la API y los bytes para mostrarla.
  String? _imagenObjeto;
  Uint8List? _imagenBytes;
  bool _subiendo = false;

  bool _enviando = false;
  String? _error;

  bool get _editando => widget.campana != null;

  static DateTime _hoy() {
    final ahora = DateTime.now();
    return DateTime(ahora.year, ahora.month, ahora.day);
  }

  @override
  void dispose() {
    _titulo.dispose();
    _causa.dispose();
    _descripcion.dispose();
    _departamento.dispose();
    super.dispose();
  }

  Future<void> _elegirPortada() async {
    final archivo = await ImagePicker().pickImage(
      source: ImageSource.gallery,
      imageQuality: 85,
      maxWidth: 1920,
    );
    if (archivo == null) return;

    final bytes = await archivo.readAsBytes();
    final extension = archivo.name.split('.').last.toLowerCase();
    setState(() {
      _subiendo = true;
      _error = null;
    });

    try {
      final api = ref.read(clienteApiProvider);
      final url = await api.enviar('/gastos/url-subida', cuerpo: {
        'tipo': 'campana',
        'extension': ['jpg', 'jpeg', 'png', 'webp'].contains(extension) ? extension : 'jpg',
      });
      await api.subirArchivo(url['url'] as String, bytes, 'image/jpeg');

      setState(() {
        _imagenObjeto = url['objeto'] as String;
        _imagenBytes = bytes;
      });
    } on ErrorApi catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _subiendo = false);
    }
  }

  Future<void> _elegirFecha({required bool esFin}) async {
    final elegida = await showDatePicker(
      context: context,
      initialDate: esFin ? (_fin ?? _inicio.add(const Duration(days: 30))) : _inicio,
      firstDate: esFin ? _inicio.add(const Duration(days: 1)) : DateTime(2024),
      lastDate: DateTime(2030, 12, 31),
    );
    if (elegida == null) return;

    setState(() {
      if (esFin) {
        _fin = elegida;
      } else {
        _inicio = elegida;
        // Un cierre que quedo antes del nuevo inicio ya no tiene sentido.
        if (_fin != null && !_fin!.isAfter(elegida)) _fin = null;
      }
    });
  }

  String _soloFecha(DateTime f) =>
      '${f.year.toString().padLeft(4, '0')}-${f.month.toString().padLeft(2, '0')}-'
      '${f.day.toString().padLeft(2, '0')}';

  Future<void> _guardar() async {
    if (!_formulario.currentState!.validate()) return;

    setState(() {
      _enviando = true;
      _error = null;
    });

    final cuerpo = <String, dynamic>{
      'titulo': _titulo.text.trim(),
      'causa': _causa.text.trim(),
      'descripcion': _descripcion.text.trim(),
      if (_departamento.text.trim().isNotEmpty) 'departamento': _departamento.text.trim(),
      'fechaInicio': _soloFecha(_inicio),
      if (_fin != null) 'fechaFin': _soloFecha(_fin!),
      if (_imagenObjeto != null) 'imagenObjeto': _imagenObjeto,
    };

    try {
      final api = ref.read(clienteApiProvider);
      final guardada = _editando
          ? await api.actualizar('/campanas/${widget.campana!['id']}', cuerpo: cuerpo)
          : await api.enviar('/ongs/${widget.ongId}/campanas', cuerpo: cuerpo);
      if (mounted) Navigator.of(context).pop(guardada['id'] as String?);
    } on ErrorApi catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final portadaActual = widget.campana?['imagenUrl'] as String?;

    return Scaffold(
      appBar: AppBar(title: Text(_editando ? 'Editar campaña' : 'Nueva campaña')),
      body: Form(
        key: _formulario,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Center(
              child: ConstrainedBox(
                constraints: const BoxConstraints(maxWidth: 720),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (!_editando)
                      Text(
                        'La campaña se guarda como borrador. La publica después, cuando tenga '
                        'al menos un fondo.',
                        style: tema.textTheme.bodyMedium,
                      ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _titulo,
                      decoration: const InputDecoration(
                        labelText: 'Título',
                        hintText: 'Por ejemplo: Esterilización comunitaria en Amarilis',
                      ),
                      textCapitalization: TextCapitalization.sentences,
                      validator: (v) => (v?.trim().length ?? 0) < 5
                          ? 'El título debe explicar la causa (al menos 5 caracteres).'
                          : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _causa,
                      decoration: const InputDecoration(
                        labelText: 'Causa',
                        hintText: 'Por ejemplo: Bienestar animal',
                        helperText: 'Con esta palabra el donante la encuentra en el buscador.',
                      ),
                      textCapitalization: TextCapitalization.sentences,
                      validator: (v) =>
                          (v?.trim().length ?? 0) < 3 ? 'Indique la causa.' : null,
                    ),
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _descripcion,
                      decoration: const InputDecoration(
                        labelText: 'Descripción',
                        hintText: 'Qué problema atiende, a quién, dónde y cómo',
                        alignLabelWithHint: true,
                      ),
                      maxLines: 6,
                      maxLength: 4000,
                      validator: (v) => (v?.trim().length ?? 0) < 50
                          ? 'Describa la causa con al menos 50 caracteres para que el donante '
                              'entienda.'
                          : null,
                    ),
                    const SizedBox(height: 8),
                    TextFormField(
                      controller: _departamento,
                      decoration: const InputDecoration(
                        labelText: 'Departamento (opcional)',
                        helperText: 'Si lo deja vacío, se usa el de la organización.',
                      ),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Expanded(
                          child: _CampoFecha(
                            etiqueta: 'Inicio',
                            valor: Formato.fecha(_inicio),
                            onTap: () => _elegirFecha(esFin: false),
                          ),
                        ),
                        const SizedBox(width: 12),
                        Expanded(
                          child: _CampoFecha(
                            etiqueta: 'Cierre (opcional)',
                            valor: _fin == null ? 'Sin fecha' : Formato.fecha(_fin),
                            onTap: () => _elegirFecha(esFin: true),
                            onLimpiar: _fin == null ? null : () => setState(() => _fin = null),
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 24),
                    Text('Portada', style: tema.textTheme.titleSmall),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 16,
                      runSpacing: 12,
                      crossAxisAlignment: WrapCrossAlignment.center,
                      children: [
                        if (_imagenBytes != null)
                          ClipRRect(
                            borderRadius: BorderRadius.circular(8),
                            child: Image.memory(
                              _imagenBytes!,
                              width: 200,
                              height: 130,
                              fit: BoxFit.cover,
                            ),
                          )
                        else if (portadaActual != null)
                          MiniaturaArchivo(
                            url: portadaActual,
                            etiqueta: 'Portada actual',
                            alto: 130,
                          ),
                        OutlinedButton.icon(
                          onPressed: _subiendo || _enviando ? null : _elegirPortada,
                          icon: _subiendo
                              ? const SizedBox(
                                  width: 16,
                                  height: 16,
                                  child: CircularProgressIndicator(strokeWidth: 2),
                                )
                              : const Icon(Icons.add_photo_alternate_outlined),
                          label: Text(
                            _imagenBytes != null || portadaActual != null
                                ? 'Cambiar portada'
                                : 'Elegir portada',
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Evite fotos con rostros reconocibles de personas: la portada es pública.',
                      style: tema.textTheme.bodySmall?.copyWith(
                        color: tema.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    if (_error != null) ...[
                      const SizedBox(height: 16),
                      Text(_error!, style: TextStyle(color: tema.colorScheme.error)),
                    ],
                    const SizedBox(height: 24),
                    FilledButton(
                      onPressed: _enviando || _subiendo ? null : _guardar,
                      child: Text(_enviando
                          ? 'Guardando...'
                          : _editando
                              ? 'Guardar cambios'
                              : 'Crear borrador'),
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _CampoFecha extends StatelessWidget {
  const _CampoFecha({
    required this.etiqueta,
    required this.valor,
    required this.onTap,
    this.onLimpiar,
  });

  final String etiqueta;
  final String valor;
  final VoidCallback onTap;
  final VoidCallback? onLimpiar;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      button: true,
      label: 'Cambiar fecha de $etiqueta',
      child: InkWell(
        onTap: onTap,
        child: InputDecorator(
          decoration: InputDecoration(
            labelText: etiqueta,
            suffixIcon: onLimpiar == null
                ? const Icon(Icons.calendar_today_outlined, size: 18)
                : IconButton(
                    tooltip: 'Quitar la fecha de cierre',
                    icon: const Icon(Icons.close, size: 18),
                    onPressed: onLimpiar,
                  ),
          ),
          child: Text(valor),
        ),
      ),
    );
  }
}
