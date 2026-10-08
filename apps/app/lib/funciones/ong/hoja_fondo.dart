import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';

const _categorias = [
  'ALIMENTOS',
  'ATENCION_VETERINARIA',
  'MEDICAMENTOS',
  'INSUMOS',
  'TRANSPORTE',
  'INFRAESTRUCTURA',
  'ESTERILIZACION',
  'OTROS',
];

/// RF-05 · Crear o editar un fondo: el destino concreto del dinero.
///
/// Devuelve `true` si guardo. Al editar, la categoria no se ofrece: es la
/// que el donante eligio al aportar y la que el motor usa para juzgar si un
/// gasto corresponde al fondo.
class HojaFondo extends ConsumerStatefulWidget {
  const HojaFondo({super.key, required this.campanaId, this.fondo});

  final String campanaId;

  /// El fondo a editar; null para crear uno nuevo.
  final Map<String, dynamic>? fondo;

  @override
  ConsumerState<HojaFondo> createState() => _HojaFondoState();
}

class _HojaFondoState extends ConsumerState<HojaFondo> {
  final _formulario = GlobalKey<FormState>();
  late final _nombre = TextEditingController(text: widget.fondo?['nombre'] as String?);
  late final _descripcion =
      TextEditingController(text: widget.fondo?['descripcion'] as String? ?? '');
  late final _meta = TextEditingController(text: widget.fondo?['meta'] as String?);
  late String _categoria = widget.fondo?['categoriaGasto'] as String? ?? 'ALIMENTOS';

  bool _enviando = false;
  String? _error;

  bool get _editando => widget.fondo != null;

  @override
  void dispose() {
    _nombre.dispose();
    _descripcion.dispose();
    _meta.dispose();
    super.dispose();
  }

  Future<void> _guardar() async {
    if (!_formulario.currentState!.validate()) return;

    setState(() {
      _enviando = true;
      _error = null;
    });

    final api = ref.read(clienteApiProvider);
    final cuerpo = {
      'nombre': _nombre.text.trim(),
      'descripcion': _descripcion.text.trim().isEmpty ? null : _descripcion.text.trim(),
      'meta': double.parse(_meta.text.trim()),
    }..removeWhere((_, v) => v == null);

    try {
      if (_editando) {
        await api.actualizar('/fondos/${widget.fondo!['id']}', cuerpo: cuerpo);
      } else {
        await api.enviar(
          '/campanas/${widget.campanaId}/fondos',
          cuerpo: {...cuerpo, 'categoriaGasto': _categoria},
        );
      }
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

    return Padding(
      padding: EdgeInsets.fromLTRB(20, 20, 20, 20 + MediaQuery.viewInsetsOf(context).bottom),
      child: Form(
        key: _formulario,
        child: SingleChildScrollView(
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(_editando ? 'Editar fondo' : 'Nuevo fondo', style: tema.textTheme.titleLarge),
              const SizedBox(height: 4),
              Text(
                'Un fondo es un destino concreto: lo que se done aquí solo podrá gastarse en '
                'su categoría, y quedará retenido hasta demostrar cada gasto.',
                style: tema.textTheme.bodySmall?.copyWith(
                  color: tema.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 20),
              TextFormField(
                controller: _nombre,
                decoration: const InputDecoration(
                  labelText: 'Nombre del fondo',
                  hintText: 'Por ejemplo: Cirugías de emergencia',
                ),
                textCapitalization: TextCapitalization.sentences,
                validator: (v) => (v?.trim().length ?? 0) < 3
                    ? 'El nombre debe decir el destino (al menos 3 caracteres).'
                    : null,
              ),
              const SizedBox(height: 16),
              if (_editando)
                InputDecorator(
                  decoration: const InputDecoration(
                    labelText: 'Categoría de gasto',
                    helperText: 'No se cambia después de crear el fondo.',
                  ),
                  child: Text(Formato.categoria(_categoria)),
                )
              else
                DropdownButtonFormField<String>(
                  initialValue: _categoria,
                  decoration: const InputDecoration(labelText: 'Categoría de gasto'),
                  items: [
                    for (final c in _categorias)
                      DropdownMenuItem(value: c, child: Text(Formato.categoria(c))),
                  ],
                  onChanged: (v) => setState(() => _categoria = v ?? _categoria),
                ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _meta,
                decoration: const InputDecoration(labelText: 'Meta', prefixText: 'S/ '),
                keyboardType: const TextInputType.numberWithOptions(decimal: true),
                inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9.]'))],
                validator: (v) {
                  final meta = double.tryParse(v?.trim() ?? '');
                  if (meta == null || meta <= 0) return 'Indique una meta mayor que cero.';
                  return null;
                },
              ),
              const SizedBox(height: 16),
              TextFormField(
                controller: _descripcion,
                decoration: const InputDecoration(
                  labelText: 'Descripción (opcional)',
                  hintText: 'Qué se va a comprar o pagar con este fondo',
                ),
                maxLines: 3,
                maxLength: 1000,
              ),
              if (_error != null) ...[
                const SizedBox(height: 8),
                Text(_error!, style: TextStyle(color: tema.colorScheme.error)),
              ],
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _enviando ? null : _guardar,
                child: Text(_enviando
                    ? 'Guardando...'
                    : _editando
                        ? 'Guardar cambios'
                        : 'Crear fondo'),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
