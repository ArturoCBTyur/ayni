import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/sesion.dart';
import '../../nucleo/tema.dart';

/// Datos de enrolamiento que entrega el backend.
final enrolamientoMfaProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return ref.read(clienteApiProvider).enviar('/identidad/mfa/iniciar');
});

/// Enrolamiento del segundo factor (RNF-02).
///
/// Es la unica pantalla que un rol con MFA obligatorio puede ver antes de
/// tener acceso: el token que recibio solo abre estas rutas. Sin esta pantalla,
/// el auditor y el administrador quedaban encerrados afuera de su propia
/// cuenta, con el sistema pidiendoles algo que no tenian forma de dar.
class PantallaMfa extends ConsumerStatefulWidget {
  const PantallaMfa({super.key});

  @override
  ConsumerState<PantallaMfa> createState() => _PantallaMfaState();
}

class _PantallaMfaState extends ConsumerState<PantallaMfa> {
  final _codigo = TextEditingController();
  final _formulario = GlobalKey<FormState>();

  bool _enviando = false;
  String? _error;
  bool _listo = false;

  @override
  void dispose() {
    _codigo.dispose();
    super.dispose();
  }

  Future<void> _confirmar() async {
    if (!(_formulario.currentState?.validate() ?? false)) return;

    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      await ref.read(clienteApiProvider).enviar(
            '/identidad/mfa/confirmar',
            cuerpo: {'codigoTotp': _codigo.text.trim()},
          );
      if (mounted) setState(() => _listo = true);
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final enrolamiento = ref.watch(enrolamientoMfaProvider);

    return Scaffold(
      body: SafeArea(
        child: SingleChildScrollView(
          child: Contenido(
            ancho: 460,
            child: _listo ? _Confirmado() : _formularioEnrolamiento(tema, enrolamiento),
          ),
        ),
      ),
    );
  }

  Widget _formularioEnrolamiento(
    ThemeData tema,
    AsyncValue<Map<String, dynamic>> enrolamiento,
  ) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Icon(Icons.phonelink_lock, size: 44, color: TemaApp.nivelMedio),
        const SizedBox(height: 14),
        Text(
          'Configure la verificación en dos pasos',
          style: tema.textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 10),
        Text(
          'Su rol maneja dinero de terceros o aprueba gastos, así que la plataforma '
          'exige un segundo factor antes de darle acceso.',
          style: tema.textTheme.bodyMedium,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),
        enrolamiento.when(
          loading: () => const Center(
            child: Padding(
              padding: EdgeInsets.all(32),
              child: CircularProgressIndicator(),
            ),
          ),
          error: (e, _) => TarjetaError(
            mensaje: e is ErrorApi ? e.mensaje : 'No pudimos generar su código.',
            onReintentar: () => ref.invalidate(enrolamientoMfaProvider),
          ),
          data: (datos) => _Codigo(datos: datos),
        ),
        if (enrolamiento.hasValue) ...[
          const SizedBox(height: 24),
          Form(
            key: _formulario,
            child: TextFormField(
              controller: _codigo,
              autofocus: true,
              keyboardType: TextInputType.number,
              maxLength: 6,
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Código de 6 dígitos',
                helperText: 'El que muestra su aplicación en este momento',
                counterText: '',
                prefixIcon: Icon(Icons.pin_outlined),
              ),
              validator: (v) => (v ?? '').trim().length == 6
                  ? null
                  : 'Ingrese los 6 dígitos que muestra su aplicación.',
              onFieldSubmitted: (_) => _confirmar(),
            ),
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(
              _error!,
              style: tema.textTheme.bodyMedium?.copyWith(color: TemaApp.nivelBajo),
            ),
          ],
          const SizedBox(height: 16),
          SizedBox(
            height: TemaApp.areaToqueMinima,
            child: FilledButton(
              onPressed: _enviando ? null : _confirmar,
              child: _enviando
                  ? const SizedBox(
                      width: 20,
                      height: 20,
                      child: CircularProgressIndicator(strokeWidth: 2),
                    )
                  : const Text('Activar'),
            ),
          ),
        ],
        const SizedBox(height: 8),
        TextButton(
          onPressed: () => ref.read(sesionProvider.notifier).cerrarSesion(),
          child: const Text('Cerrar sesión'),
        ),
      ],
    );
  }
}

/// QR mas la clave en texto.
///
/// La clave escrita no es un extra para quien no pueda escanear: es la via
/// accesible. Un QR es una imagen sin contenido para un lector de pantalla, y
/// el proyecto se compromete con WCAG 2.1 AA (RNF-15). Quien no ve la pantalla
/// escribe la clave a mano en su aplicacion y llega al mismo lugar.
class _Codigo extends StatelessWidget {
  const _Codigo({required this.datos});

  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final secreto = datos['secreto'] as String;
    final qr = datos['qr'] as String?;
    final bytes = _bytesDelQr(qr);

    return Column(
      children: [
        if (bytes != null)
          Semantics(
            label:
                'Código QR de enrolamiento. Si no puede verlo, use la clave escrita '
                'que aparece debajo.',
            image: true,
            child: Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: Colors.white,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: tema.colorScheme.outlineVariant),
              ),
              child: Image.memory(bytes, width: 200, height: 200),
            ),
          ),
        const SizedBox(height: 16),
        Text(
          datos['instrucciones'] as String? ??
              'Escanee el código con su aplicación de autenticación.',
          style: tema.textTheme.bodySmall,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 16),
        Card(
          margin: EdgeInsets.zero,
          child: Padding(
            padding: const EdgeInsets.all(12),
            child: Column(
              children: [
                Text(
                  'O escriba esta clave en su aplicación',
                  style: tema.textTheme.labelMedium?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
                const SizedBox(height: 6),
                Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Expanded(
                      child: SelectableText(
                        secreto,
                        textAlign: TextAlign.center,
                        style: tema.textTheme.titleMedium?.copyWith(
                          fontFamily: 'monospace',
                          letterSpacing: 1.5,
                        ),
                      ),
                    ),
                    IconButton(
                      tooltip: 'Copiar la clave',
                      onPressed: () async {
                        await Clipboard.setData(ClipboardData(text: secreto));
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Clave copiada')),
                          );
                        }
                      },
                      icon: const Icon(Icons.copy_outlined),
                    ),
                  ],
                ),
              ],
            ),
          ),
        ),
      ],
    );
  }

  /// El backend entrega el QR como data URL; la imagen vive en el base64.
  static Uint8List? _bytesDelQr(String? url) {
    if (url == null) return null;
    final coma = url.indexOf(',');
    if (coma < 0) return null;
    try {
      return base64Decode(url.substring(coma + 1));
    } catch (_) {
      // Si el QR no se puede decodificar, la clave en texto sigue sirviendo:
      // no se pierde el enrolamiento por una imagen.
      return null;
    }
  }
}

/// Activado. Hace falta entrar de nuevo, esta vez con el codigo.
///
/// El token actual solo abria las rutas de enrolamiento, asi que no se puede
/// ascender a una sesion completa sin volver a autenticarse. Se dice
/// explicitamente para que no parezca que algo fallo.
class _Confirmado extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const SizedBox(height: 24),
        Icon(Icons.verified_user_outlined, size: 48, color: TemaApp.nivelAlto),
        const SizedBox(height: 16),
        Text(
          'Verificación en dos pasos activada',
          style: tema.textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 12),
        Text(
          'Inicie sesión de nuevo y, junto con su contraseña, ingrese el código '
          'que muestre su aplicación.',
          style: tema.textTheme.bodyMedium,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),
        SizedBox(
          height: TemaApp.areaToqueMinima,
          child: FilledButton(
            onPressed: () => ref.read(sesionProvider.notifier).cerrarSesion(),
            child: const Text('Ir a iniciar sesión'),
          ),
        ),
      ],
    );
  }
}
