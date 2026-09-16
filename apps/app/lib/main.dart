import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'funciones/salud/pantalla_salud.dart';
import 'nucleo/config.dart';
import 'nucleo/tema.dart';

void main() {
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
      // El enrutado por rol (go_router) entra en la Fase 2, cuando existan
      // sesiones que redirigir.
      home: const PantallaSalud(),
    );
  }
}
