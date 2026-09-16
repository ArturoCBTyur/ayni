import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../funciones/auditor/pantalla_bandeja.dart';
import '../funciones/donante/pantalla_causas.dart';
import '../funciones/donante/pantalla_historial.dart';
import '../funciones/donante/pantalla_notificaciones.dart';
import '../funciones/ong/pantalla_fondos.dart';
import '../funciones/ong/pantalla_gastos.dart';
import 'sesion.dart';

/// Destino de navegacion, con el rol que lo habilita.
class _Destino {
  const _Destino({
    required this.etiqueta,
    required this.icono,
    required this.iconoActivo,
    required this.pantalla,
    required this.roles,
  });

  final String etiqueta;
  final IconData icono;
  final IconData iconoActivo;
  final Widget pantalla;

  /// Roles que ven este destino. Vacio significa que lo ve cualquiera.
  final List<String> roles;
}

const _destinos = <_Destino>[
  _Destino(
    etiqueta: 'Causas',
    icono: Icons.explore_outlined,
    iconoActivo: Icons.explore,
    pantalla: PantallaCausas(),
    roles: [],
  ),
  _Destino(
    etiqueta: 'Mis aportes',
    icono: Icons.receipt_long_outlined,
    iconoActivo: Icons.receipt_long,
    pantalla: PantallaHistorial(),
    roles: ['DONANTE'],
  ),
  _Destino(
    etiqueta: 'Impacto',
    icono: Icons.notifications_outlined,
    iconoActivo: Icons.notifications,
    pantalla: PantallaNotificaciones(),
    roles: ['DONANTE'],
  ),
  _Destino(
    etiqueta: 'Fondos',
    icono: Icons.account_balance_wallet_outlined,
    iconoActivo: Icons.account_balance_wallet,
    pantalla: PantallaFondos(),
    roles: ['ONG_ADMIN', 'ONG_OPERADOR'],
  ),
  _Destino(
    etiqueta: 'Gastos',
    icono: Icons.photo_camera_outlined,
    iconoActivo: Icons.photo_camera,
    pantalla: PantallaGastos(),
    roles: ['ONG_ADMIN', 'ONG_OPERADOR'],
  ),
  _Destino(
    etiqueta: 'Auditoría',
    icono: Icons.fact_check_outlined,
    iconoActivo: Icons.fact_check,
    pantalla: PantallaBandeja(),
    roles: ['AUDITOR', 'ADMIN'],
  ),
];

/// Contenedor principal con navegacion segun rol.
///
/// Se adapta al ancho: rail lateral en escritorio y barra inferior en movil.
/// No es solo estetica, es el caso de uso real del proyecto: el donante
/// navega desde la web y el operador de la ONG registra gastos desde el
/// celular, en campo.
class Shell extends ConsumerStatefulWidget {
  const Shell({super.key});

  @override
  ConsumerState<Shell> createState() => _ShellState();
}

class _ShellState extends ConsumerState<Shell> {
  int _indice = 0;

  @override
  Widget build(BuildContext context) {
    final sesion = ref.watch(sesionProvider);
    final usuario = sesion.usuario;

    final visibles = _destinos
        .where((d) => d.roles.isEmpty || d.roles.any((r) => usuario?.tieneRol(r) ?? false))
        .toList();

    // Si el rol cambia y el indice queda fuera de rango, se vuelve al inicio.
    final indice = _indice.clamp(0, visibles.length - 1);
    final esAncho = MediaQuery.sizeOf(context).width >= 840;

    return Scaffold(
      appBar: AppBar(
        title: Text(visibles[indice].etiqueta),
        actions: [
          if (usuario != null)
            PopupMenuButton<String>(
              tooltip: 'Cuenta',
              icon: CircleAvatar(
                radius: 16,
                child: Text(
                  usuario.nombres.characters.first.toUpperCase(),
                  style: const TextStyle(fontSize: 14),
                ),
              ),
              itemBuilder: (context) => [
                PopupMenuItem(
                  enabled: false,
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(usuario.nombreCompleto),
                      Text(
                        usuario.correo,
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                    ],
                  ),
                ),
                const PopupMenuDivider(),
                const PopupMenuItem(value: 'salir', child: Text('Cerrar sesión')),
              ],
              onSelected: (valor) {
                if (valor == 'salir') {
                  ref.read(sesionProvider.notifier).cerrarSesion();
                }
              },
            ),
          const SizedBox(width: 8),
        ],
      ),
      body: Row(
        children: [
          if (esAncho && visibles.length > 1)
            NavigationRail(
              selectedIndex: indice,
              onDestinationSelected: (i) => setState(() => _indice = i),
              labelType: NavigationRailLabelType.all,
              destinations: [
                for (final d in visibles)
                  NavigationRailDestination(
                    icon: Icon(d.icono),
                    selectedIcon: Icon(d.iconoActivo),
                    label: Text(d.etiqueta),
                  ),
              ],
            ),
          Expanded(child: visibles[indice].pantalla),
        ],
      ),
      bottomNavigationBar: (!esAncho && visibles.length > 1)
          ? NavigationBar(
              selectedIndex: indice,
              onDestinationSelected: (i) => setState(() => _indice = i),
              destinations: [
                for (final d in visibles)
                  NavigationDestination(
                    icon: Icon(d.icono),
                    selectedIcon: Icon(d.iconoActivo),
                    label: d.etiqueta,
                  ),
              ],
            )
          : null,
    );
  }
}
