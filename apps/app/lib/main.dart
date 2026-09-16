import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'funciones/sesion/pantalla_login.dart';
import 'funciones/sesion/pantalla_registro.dart';
import 'nucleo/config.dart';
import 'nucleo/sesion.dart';
import 'nucleo/shell.dart';
import 'nucleo/tema.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Fechas en español peruano (RNF-20): sin esto, intl formatea en ingles.
  await initializeDateFormatting(Config.locale);

  runApp(const ProviderScope(child: AppTrazabilidadRadical()));
}

class AppTrazabilidadRadical extends StatelessWidget {
  const AppTrazabilidadRadical({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: Config.nombreApp,
      debugShowCheckedModeBanner: false,
      theme: TemaApp.claro(),
      darkTheme: TemaApp.oscuro(),
      routes: {'/registro': (_) => const PantallaRegistro()},
      home: const _Raiz(),
    );
  }
}

/// Decide que mostrar segun el estado de la sesion.
class _Raiz extends ConsumerStatefulWidget {
  const _Raiz();

  @override
  ConsumerState<_Raiz> createState() => _RaizState();
}

class _RaizState extends ConsumerState<_Raiz> {
  bool _restaurando = true;

  @override
  void initState() {
    super.initState();
    // Al abrir, se intenta reconstruir la sesion desde la cookie de refresh.
    // El access token no sobrevive a una recarga a proposito: en web no hay
    // donde guardarlo de forma segura.
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      await ref.read(sesionProvider.notifier).restaurar();
      if (mounted) setState(() => _restaurando = false);
    });
  }

  @override
  Widget build(BuildContext context) {
    final sesion = ref.watch(sesionProvider);

    if (_restaurando) {
      return const Scaffold(body: Center(child: CircularProgressIndicator()));
    }

    if (sesion.mfaPendiente) return const _MfaPendiente();
    if (!sesion.autenticado) return const PantallaLogin();

    return const Shell();
  }
}

/// El rol exige segundo factor y la cuenta aun no lo configuro.
///
/// El token recibido solo abre las rutas de enrolamiento, asi que mostrar el
/// panel completo seria enseñar puertas que no se pueden abrir.
class _MfaPendiente extends ConsumerWidget {
  const _MfaPendiente();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);

    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 420),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.phonelink_lock, size: 48, color: TemaApp.nivelMedio),
                const SizedBox(height: 16),
                Text(
                  'Configure la verificación en dos pasos',
                  style: tema.textTheme.titleLarge,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 12),
                Text(
                  'Su rol maneja dinero de terceros o aprueba gastos, así que la plataforma '
                  'exige un segundo factor antes de darle acceso.',
                  style: tema.textTheme.bodyMedium,
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                Text(
                  'El enrolamiento con código QR se completa desde el panel de '
                  'administración de su cuenta.',
                  style: tema.textTheme.bodySmall?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                  textAlign: TextAlign.center,
                ),
                const SizedBox(height: 24),
                OutlinedButton(
                  onPressed: () => ref.read(sesionProvider.notifier).cerrarSesion(),
                  child: const Text('Cerrar sesión'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
