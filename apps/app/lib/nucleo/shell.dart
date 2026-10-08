import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../funciones/admin/pantalla_tablero.dart';
import '../funciones/admin/pantalla_usuarios.dart';
import '../funciones/auditor/pantalla_verificacion_ong.dart';
import '../funciones/cumplimiento/pantalla_arco_bandeja.dart';
import '../funciones/cumplimiento/pantalla_privacidad.dart';
import '../funciones/donante/pantalla_causas.dart';
import '../funciones/donante/pantalla_historial.dart';
import '../funciones/donante/pantalla_notificaciones.dart';
import '../funciones/ong/pantalla_campanas.dart';
import '../funciones/ong/pantalla_equipo.dart';
import '../funciones/ong/pantalla_fondos.dart';
import '../funciones/ong/pantalla_gastos.dart';
import '../funciones/ong/pantalla_registrar_ong.dart';
import '../funciones/salud/pantalla_salud.dart';
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
  // Causas es la vitrina del donante. Los demas roles la consultan desde el
  // menu de cuenta: como pestaña, y primera, ponia a un operador o a un
  // auditor frente a botones de "Donar" que no le corresponden.
  _Destino(
    etiqueta: 'Causas',
    icono: Icons.explore_outlined,
    iconoActivo: Icons.explore,
    pantalla: PantallaCausas(),
    roles: ['DONANTE'],
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
  // Solo el administrador de ONG la tiene como pestaña: es quien crea y
  // publica causas. El operador las ve en Fondos, que es lo que necesita.
  _Destino(
    etiqueta: 'Campañas',
    icono: Icons.campaign_outlined,
    iconoActivo: Icons.campaign,
    pantalla: PantallaCampanas(),
    roles: ['ONG_ADMIN'],
  ),
  _Destino(
    etiqueta: 'Auditoría',
    icono: Icons.fact_check_outlined,
    iconoActivo: Icons.fact_check,
    pantalla: PantallaAuditoria(),
    roles: ['AUDITOR', 'ADMIN'],
  ),
  _Destino(
    etiqueta: 'Tablero',
    icono: Icons.insights_outlined,
    iconoActivo: Icons.insights,
    pantalla: PantallaTablero(),
    roles: ['ADMIN', 'AUDITOR'],
  ),
  _Destino(
    etiqueta: 'Solicitudes',
    icono: Icons.privacy_tip_outlined,
    iconoActivo: Icons.privacy_tip,
    pantalla: PantallaArcoBandeja(),
    roles: ['ADMIN'],
  ),
  _Destino(
    etiqueta: 'Usuarios',
    icono: Icons.manage_accounts_outlined,
    iconoActivo: Icons.manage_accounts,
    pantalla: PantallaUsuarios(),
    roles: ['ADMIN'],
  ),
];

/// Destinos que ve un usuario, con los de su rol principal primero.
///
/// Quien es donante y a la vez opera una ONG entra a sus tareas de la ONG,
/// no al catalogo: el orden lo decide [UsuarioSesion.rolPrincipal]. Dentro de
/// cada grupo se respeta el orden de [_destinos].
List<_Destino> _destinosPara(UsuarioSesion? usuario) {
  if (usuario == null) return const [];

  final visibles = _destinos
      .where((d) => d.roles.isEmpty || d.roles.any(usuario.tieneRol))
      .toList();
  final principal = usuario.rolPrincipal;

  return [
    ...visibles.where((d) => d.roles.contains(principal)),
    ...visibles.where((d) => !d.roles.contains(principal)),
  ];
}

/// Etiquetas de la navegacion de un usuario, en orden. Solo para pruebas.
@visibleForTesting
List<String> etiquetasDeNavegacion(UsuarioSesion usuario) =>
    _destinosPara(usuario).map((d) => d.etiqueta).toList();

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

    var visibles = _destinosPara(usuario);
    // Una cuenta sin ningun rol con pantalla propia no se queda en blanco:
    // al menos puede ver las causas publicadas.
    if (visibles.isEmpty) visibles = [_destinos.first];

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
                if (!usuario.tieneRol('DONANTE'))
                  const PopupMenuItem(
                    value: 'causas',
                    child: Text('Causas publicadas'),
                  ),
                if (usuario.tieneRol('ONG_ADMIN'))
                  const PopupMenuItem(
                    value: 'equipo',
                    child: Text('Equipo de la organización'),
                  ),
                // Quien audita o administra la plataforma no registra una ONG:
                // seria juez y parte de su propia verificacion.
                if (!usuario.tieneRol('AUDITOR') && !usuario.tieneRol('ADMIN'))
                  const PopupMenuItem(
                    value: 'registrarOng',
                    child: Text('Registrar una organización'),
                  ),
                if (usuario.tieneRol('ADMIN'))
                  const PopupMenuItem(
                    value: 'salud',
                    child: Text('Estado del sistema'),
                  ),
                const PopupMenuItem(
                  value: 'privacidad',
                  child: Text('Mis datos y privacidad'),
                ),
                const PopupMenuItem(value: 'salir', child: Text('Cerrar sesión')),
              ],
              onSelected: (valor) {
                final pantalla = switch (valor) {
                  'privacidad' => const PantallaPrivacidad(),
                  'salud' => const PantallaSalud(),
                  'equipo' => const PantallaEquipo(),
                  'registrarOng' => const PantallaRegistrarOng(),
                  // Sin rol de donante, la ficha de cada causa se ve sin el
                  // boton de donar: es una consulta, no una vitrina.
                  'causas' => Scaffold(
                      appBar: AppBar(title: const Text('Causas publicadas')),
                      body: const PantallaCausas(),
                    ),
                  _ => null,
                };
                if (valor == 'salir') {
                  ref.read(sesionProvider.notifier).cerrarSesion();
                } else if (pantalla != null) {
                  Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => pantalla));
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
