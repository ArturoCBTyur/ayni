import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';

import 'funciones/sesion/pantalla_login.dart';
import 'funciones/sesion/pantalla_mfa.dart';
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

    if (sesion.mfaPendiente) return const PantallaMfa();
    if (!sesion.autenticado) return const PantallaLogin();

    return const Shell();
  }
}
