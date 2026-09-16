import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../nucleo/sesion.dart';
import '../../nucleo/tema.dart';

/// Inicio de sesion.
///
/// El campo de codigo TOTP aparece solo cuando el servidor lo pide, en lugar
/// de mostrarse siempre: al donante no se le exige segundo factor y verlo
/// desde el inicio sugeriria una friccion que no existe para su rol.
class PantallaLogin extends ConsumerStatefulWidget {
  const PantallaLogin({super.key});

  @override
  ConsumerState<PantallaLogin> createState() => _PantallaLoginState();
}

class _PantallaLoginState extends ConsumerState<PantallaLogin> {
  final _formulario = GlobalKey<FormState>();
  final _correo = TextEditingController();
  final _clave = TextEditingController();
  final _totp = TextEditingController();

  bool _mostrarTotp = false;
  bool _ocultarClave = true;

  @override
  void dispose() {
    _correo.dispose();
    _clave.dispose();
    _totp.dispose();
    super.dispose();
  }

  Future<void> _entrar() async {
    if (!_formulario.currentState!.validate()) return;

    await ref.read(sesionProvider.notifier).iniciarSesion(
          correo: _correo.text.trim(),
          clave: _clave.text,
          codigoTotp: _totp.text.trim(),
        );

    final estado = ref.read(sesionProvider);
    // El backend distingue "falta el codigo" de "credenciales incorrectas";
    // se usa esa señal para revelar el campo solo cuando corresponde.
    if (estado.error != null && estado.error!.toLowerCase().contains('codigo')) {
      setState(() => _mostrarTotp = true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final estado = ref.watch(sesionProvider);
    final tema = Theme.of(context);

    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 420),
            child: Form(
              key: _formulario,
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Icon(Icons.volunteer_activism, size: 48, color: TemaApp.semilla),
                  const SizedBox(height: 16),
                  Text(
                    'Trazabilidad Radical',
                    style: tema.textTheme.headlineSmall,
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 8),
                  Text(
                    'Cada sol donado, verificado con comprobante y evidencia.',
                    style: tema.textTheme.bodyMedium?.copyWith(
                      color: tema.colorScheme.onSurfaceVariant,
                    ),
                    textAlign: TextAlign.center,
                  ),
                  const SizedBox(height: 32),

                  TextFormField(
                    controller: _correo,
                    keyboardType: TextInputType.emailAddress,
                    autofillHints: const [AutofillHints.email],
                    decoration: const InputDecoration(
                      labelText: 'Correo',
                      prefixIcon: Icon(Icons.mail_outline),
                    ),
                    validator: (v) =>
                        (v == null || !v.contains('@')) ? 'Ingrese un correo válido.' : null,
                  ),
                  const SizedBox(height: 16),

                  TextFormField(
                    controller: _clave,
                    obscureText: _ocultarClave,
                    autofillHints: const [AutofillHints.password],
                    decoration: InputDecoration(
                      labelText: 'Contraseña',
                      prefixIcon: const Icon(Icons.lock_outline),
                      suffixIcon: IconButton(
                        tooltip: _ocultarClave ? 'Mostrar contraseña' : 'Ocultar contraseña',
                        icon: Icon(_ocultarClave ? Icons.visibility : Icons.visibility_off),
                        onPressed: () => setState(() => _ocultarClave = !_ocultarClave),
                      ),
                    ),
                    validator: (v) =>
                        (v == null || v.isEmpty) ? 'Ingrese su contraseña.' : null,
                    onFieldSubmitted: (_) => _entrar(),
                  ),

                  if (_mostrarTotp) ...[
                    const SizedBox(height: 16),
                    TextFormField(
                      controller: _totp,
                      keyboardType: TextInputType.number,
                      maxLength: 6,
                      decoration: const InputDecoration(
                        labelText: 'Código de verificación',
                        helperText: 'Los 6 dígitos de su app de autenticación.',
                        prefixIcon: Icon(Icons.phonelink_lock_outlined),
                        counterText: '',
                      ),
                    ),
                  ],

                  if (estado.error != null) ...[
                    const SizedBox(height: 16),
                    _AvisoError(mensaje: estado.error!),
                  ],

                  const SizedBox(height: 24),
                  FilledButton(
                    onPressed: estado.cargando ? null : _entrar,
                    child: estado.cargando
                        ? const SizedBox(
                            height: 20,
                            width: 20,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Text('Entrar'),
                  ),
                  const SizedBox(height: 12),
                  TextButton(
                    onPressed: estado.cargando
                        ? null
                        : () {
                            ref.read(sesionProvider.notifier).limpiarError();
                            Navigator.of(context).pushNamed('/registro');
                          },
                    child: const Text('Crear una cuenta de donante'),
                  ),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}

class _AvisoError extends StatelessWidget {
  const _AvisoError({required this.mensaje});

  final String mensaje;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: TemaApp.nivelBajo.withValues(alpha: 0.08),
        borderRadius: BorderRadius.circular(8),
        border: Border.all(color: TemaApp.nivelBajo.withValues(alpha: 0.3)),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 20, color: TemaApp.nivelBajo),
          const SizedBox(width: 10),
          Expanded(
            child: Text(
              mensaje,
              style: Theme.of(context).textTheme.bodySmall?.copyWith(
                    color: TemaApp.nivelBajo,
                  ),
            ),
          ),
        ],
      ),
    );
  }
}
