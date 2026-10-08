import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import 'pantalla_fondos.dart';

final equipoProvider =
    FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, ongId) async {
  return ref.read(clienteApiProvider).obtenerLista('/ongs/$ongId/miembros');
});

/// El equipo de la ONG: quien registra gastos y quien administra.
///
/// Antes los operadores solo existian si los creaba la semilla. La membresia
/// es lo que autoriza a registrar un gasto, asi que darla y quitarla queda en
/// manos del administrador de la organizacion, con rastro en la bitacora.
class PantallaEquipo extends ConsumerWidget {
  const PantallaEquipo({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ongs = ref.watch(misOngsProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Equipo de la organización')),
      body: ongs.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar sus organizaciones.',
          onReintentar: () => ref.invalidate(misOngsProvider),
        ),
        data: (lista) {
          final administradas = lista.where((o) => o['cargo'] == 'ADMINISTRADOR').toList();
          if (administradas.isEmpty) {
            return const EstadoVacio(
              icono: Icons.group_off_outlined,
              titulo: 'No administra ninguna organización',
              descripcion: 'Solo el administrador de una ONG gestiona su equipo.',
            );
          }

          final seleccionada = ref.watch(ongActivaProvider);
          final ong = administradas.firstWhere(
            (o) => o['id'] == seleccionada,
            orElse: () => administradas.first,
          );

          return Column(
            children: [
              if (administradas.length > 1)
                Padding(
                  padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                  child: DropdownMenu<String>(
                    initialSelection: ong['id'] as String,
                    label: const Text('Organización'),
                    onSelected: (v) => ref.read(ongActivaProvider.notifier).seleccionar(v),
                    dropdownMenuEntries: [
                      for (final o in administradas)
                        DropdownMenuEntry(
                          value: o['id'] as String,
                          label: (o['nombreComercial'] ?? o['razonSocial']) as String,
                        ),
                    ],
                  ),
                ),
              Expanded(child: _Equipo(ongId: ong['id'] as String)),
            ],
          );
        },
      ),
    );
  }
}

class _Equipo extends ConsumerWidget {
  const _Equipo({required this.ongId});

  final String ongId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final equipo = ref.watch(equipoProvider(ongId));
    final tema = Theme.of(context);

    return equipo.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar el equipo.',
        onReintentar: () => ref.invalidate(equipoProvider(ongId)),
      ),
      data: (miembros) => Contenido(
        child: ListView(
          children: [
            Text(
              'El operador registra gastos con su comprobante y su foto. El administrador, '
              'además, crea campañas y gestiona este equipo. Los dos necesitan verificación '
              'en dos pasos, que se les pedirá en su próximo ingreso.',
              style: tema.textTheme.bodySmall?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 12),
            Align(
              alignment: Alignment.centerLeft,
              child: FilledButton.icon(
                onPressed: () => _agregar(context, ref),
                icon: const Icon(Icons.person_add_alt),
                label: const Text('Agregar persona'),
              ),
            ),
            const SizedBox(height: 12),
            for (final m in miembros)
              Card(
                child: ListTile(
                  leading: CircleAvatar(
                    child: Text((m['nombre'] as String).characters.first.toUpperCase()),
                  ),
                  title: Text(
                    m['esUsted'] == true ? '${m['nombre']} (usted)' : m['nombre'] as String,
                    style: m['activo'] == true
                        ? null
                        : TextStyle(color: tema.colorScheme.onSurfaceVariant),
                  ),
                  subtitle: Text(
                    '${m['correo']}\n'
                    '${m['cargo'] == 'ADMINISTRADOR' ? 'Administrador' : 'Operador'}'
                    '${m['activo'] == true ? '' : ' · desactivado'}'
                    ' · desde ${Formato.fecha(Formato.aFecha(m['desde']))}',
                  ),
                  isThreeLine: true,
                  trailing: PopupMenuButton<String>(
                    tooltip: 'Acciones para ${m['nombre']}',
                    onSelected: (accion) => _cambiar(context, ref, m, accion),
                    itemBuilder: (_) => [
                      if (m['activo'] == true && m['cargo'] == 'OPERADOR')
                        const PopupMenuItem(
                          value: 'ADMINISTRADOR',
                          child: Text('Hacer administrador'),
                        ),
                      if (m['activo'] == true && m['cargo'] == 'ADMINISTRADOR')
                        const PopupMenuItem(value: 'OPERADOR', child: Text('Pasar a operador')),
                      PopupMenuItem(
                        value: m['activo'] == true ? 'desactivar' : 'reactivar',
                        child: Text(m['activo'] == true ? 'Desactivar' : 'Reactivar'),
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

  Future<void> _cambiar(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> miembro,
    String accion,
  ) async {
    final cuerpo = switch (accion) {
      'desactivar' => {'activo': false},
      'reactivar' => {'activo': true},
      _ => {'cargo': accion},
    };
    final mensajero = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(clienteApiProvider)
          .actualizar('/ongs/$ongId/miembros/${miembro['usuarioId']}', cuerpo: cuerpo);
      ref.invalidate(equipoProvider(ongId));
      mensajero.showSnackBar(const SnackBar(content: Text('Equipo actualizado.')));
    } on ErrorApi catch (e) {
      mensajero.showSnackBar(SnackBar(content: Text(e.mensaje)));
    }
  }

  Future<void> _agregar(BuildContext context, WidgetRef ref) async {
    final agregado = await showDialog<bool>(
      context: context,
      builder: (_) => _DialogoAgregar(ongId: ongId),
    );
    if (agregado == true) ref.invalidate(equipoProvider(ongId));
  }
}

class _DialogoAgregar extends ConsumerStatefulWidget {
  const _DialogoAgregar({required this.ongId});

  final String ongId;

  @override
  ConsumerState<_DialogoAgregar> createState() => _DialogoAgregarState();
}

class _DialogoAgregarState extends ConsumerState<_DialogoAgregar> {
  final _correo = TextEditingController();
  String _cargo = 'OPERADOR';
  bool _enviando = false;
  String? _error;

  @override
  void dispose() {
    _correo.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    if (!_correo.text.contains('@')) {
      setState(() => _error = 'Ingrese el correo de su cuenta en Ayni.');
      return;
    }
    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      await ref.read(clienteApiProvider).enviar(
        '/ongs/${widget.ongId}/miembros',
        cuerpo: {'correo': _correo.text.trim(), 'cargo': _cargo},
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ErrorApi catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Agregar al equipo'),
      content: SizedBox(
        width: 420,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('La persona tiene que haberse registrado en Ayni con ese correo.'),
            const SizedBox(height: 12),
            TextField(
              controller: _correo,
              keyboardType: TextInputType.emailAddress,
              decoration: InputDecoration(labelText: 'Correo', errorText: _error),
            ),
            const SizedBox(height: 12),
            SegmentedButton<String>(
              selected: {_cargo},
              onSelectionChanged: (s) => setState(() => _cargo = s.first),
              segments: const [
                ButtonSegment(value: 'OPERADOR', label: Text('Operador')),
                ButtonSegment(value: 'ADMINISTRADOR', label: Text('Administrador')),
              ],
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _enviando ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _enviando ? null : _enviar,
          child: const Text('Agregar'),
        ),
      ],
    );
  }
}
