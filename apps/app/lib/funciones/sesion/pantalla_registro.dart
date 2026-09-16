import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../nucleo/sesion.dart';
import '../../nucleo/tema.dart';

/// CU01 · Registro con consentimiento informado.
///
/// El consentimiento de tratamiento de datos se muestra como una casilla que
/// la persona debe marcar, no como un texto legal ya aceptado: un
/// consentimiento premarcado no es consentimiento (RF-DE-01). El de
/// comunicaciones va aparte y es opcional, porque son finalidades distintas
/// y la ley exige poder aceptarlas por separado.
class PantallaRegistro extends ConsumerStatefulWidget {
  const PantallaRegistro({super.key});

  @override
  ConsumerState<PantallaRegistro> createState() => _PantallaRegistroState();
}

class _PantallaRegistroState extends ConsumerState<PantallaRegistro> {
  final _formulario = GlobalKey<FormState>();
  final _nombres = TextEditingController();
  final _apellidos = TextEditingController();
  final _correo = TextEditingController();
  final _clave = TextEditingController();

  bool _tratamientoDatos = false;
  bool _comunicaciones = false;
  bool _ocultarClave = true;

  @override
  void dispose() {
    _nombres.dispose();
    _apellidos.dispose();
    _correo.dispose();
    _clave.dispose();
    super.dispose();
  }

  Future<void> _registrar() async {
    if (!_formulario.currentState!.validate()) return;

    await ref.read(sesionProvider.notifier).registrar(
          correo: _correo.text.trim(),
          clave: _clave.text,
          nombres: _nombres.text.trim(),
          apellidos: _apellidos.text.trim(),
          comunicaciones: _comunicaciones,
        );
  }

  @override
  Widget build(BuildContext context) {
    final estado = ref.watch(sesionProvider);
    final tema = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Crear cuenta')),
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 460),
            child: Form(
              key: _formulario,
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: TextFormField(
                          controller: _nombres,
                          decoration: const InputDecoration(labelText: 'Nombres'),
                          validator: (v) =>
                              (v == null || v.trim().length < 2) ? 'Indique sus nombres.' : null,
                        ),
                      ),
                      const SizedBox(width: 12),
                      Expanded(
                        child: TextFormField(
                          controller: _apellidos,
                          decoration: const InputDecoration(labelText: 'Apellidos'),
                          validator: (v) => (v == null || v.trim().length < 2)
                              ? 'Indique sus apellidos.'
                              : null,
                        ),
                      ),
                    ],
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _correo,
                    keyboardType: TextInputType.emailAddress,
                    decoration: const InputDecoration(labelText: 'Correo'),
                    validator: (v) =>
                        (v == null || !v.contains('@')) ? 'Ingrese un correo válido.' : null,
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _clave,
                    obscureText: _ocultarClave,
                    decoration: InputDecoration(
                      labelText: 'Contraseña',
                      helperText: 'Al menos 12 caracteres, con mayúscula, minúscula y número.',
                      helperMaxLines: 2,
                      suffixIcon: IconButton(
                        tooltip: _ocultarClave ? 'Mostrar contraseña' : 'Ocultar contraseña',
                        icon: Icon(_ocultarClave ? Icons.visibility : Icons.visibility_off),
                        onPressed: () => setState(() => _ocultarClave = !_ocultarClave),
                      ),
                    ),
                    validator: _validarClave,
                  ),

                  const SizedBox(height: 28),
                  Text('Sus datos', style: tema.textTheme.titleSmall),
                  const SizedBox(height: 8),

                  CheckboxListTile(
                    value: _tratamientoDatos,
                    onChanged: (v) => setState(() => _tratamientoDatos = v ?? false),
                    controlAffinity: ListTileControlAffinity.leading,
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Acepto el tratamiento de mis datos personales'),
                    subtitle: const Text(
                      'Necesario para crear la cuenta y registrar sus donaciones. '
                      'Puede pedir su eliminación en cualquier momento.',
                    ),
                    isError: !_tratamientoDatos && estado.error != null,
                  ),

                  CheckboxListTile(
                    value: _comunicaciones,
                    onChanged: (v) => setState(() => _comunicaciones = v ?? false),
                    controlAffinity: ListTileControlAffinity.leading,
                    contentPadding: EdgeInsets.zero,
                    title: const Text('Quiero recibir las narrativas de impacto'),
                    subtitle: const Text(
                      'Le contamos en qué se usó su aporte, con comprobante y evidencia. '
                      'Opcional: puede donar sin activarlo.',
                    ),
                  ),

                  if (estado.error != null) ...[
                    const SizedBox(height: 16),
                    Container(
                      padding: const EdgeInsets.all(12),
                      decoration: BoxDecoration(
                        color: TemaApp.nivelBajo.withValues(alpha: 0.08),
                        borderRadius: BorderRadius.circular(8),
                      ),
                      child: Text(
                        estado.error!,
                        style: tema.textTheme.bodySmall?.copyWith(color: TemaApp.nivelBajo),
                      ),
                    ),
                  ],

                  const SizedBox(height: 24),
                  FilledButton(
                    // Sin el consentimiento obligatorio el boton no habilita:
                    // es mas claro que dejarlo pulsar y luego rechazar.
                    onPressed: (estado.cargando || !_tratamientoDatos) ? null : _registrar,
                    child: estado.cargando
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Crear cuenta'),
                  ),
                  if (!_tratamientoDatos) ...[
                    const SizedBox(height: 8),
                    Text(
                      'Para continuar debe aceptar el tratamiento de sus datos.',
                      style: tema.textTheme.bodySmall?.copyWith(
                        color: tema.colorScheme.onSurfaceVariant,
                      ),
                      textAlign: TextAlign.center,
                    ),
                  ],
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: () => Navigator.of(context).pop(),
                    child: const Text('Ya tengo cuenta'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }

  String? _validarClave(String? valor) {
    if (valor == null || valor.length < 12) {
      return 'La contraseña debe tener al menos 12 caracteres.';
    }
    if (!RegExp(r'[a-z]').hasMatch(valor) || !RegExp(r'[A-Z]').hasMatch(valor)) {
      return 'Incluya al menos una letra minúscula y una mayúscula.';
    }
    if (!RegExp(r'\d').hasMatch(valor)) {
      return 'Incluya al menos un número.';
    }
    return null;
  }
}
