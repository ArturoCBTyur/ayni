import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/visor_archivo.dart';
import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';
import '../donante/pantalla_campana.dart';
import 'hoja_fondo.dart';
import 'pantalla_editar_campana.dart';
import 'pantalla_fondos.dart';

/// RF-04, RF-05 · Las campañas de la ONG, para crearlas y administrarlas.
///
/// Es la otra mitad de "Fondos": aquella pantalla muestra cuanto hay y cuanto
/// falta justificar; esta, que causas tiene la ONG y en que estado. Solo el
/// administrador de la organizacion cambia algo; el operador la ve igual,
/// para saber a que fondos puede imputar un gasto.
class PantallaCampanas extends ConsumerWidget {
  const PantallaCampanas({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ongs = ref.watch(misOngsProvider);

    return ongs.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar sus organizaciones.',
        onReintentar: () => ref.invalidate(misOngsProvider),
      ),
      data: (lista) {
        if (lista.isEmpty) {
          return const EstadoVacio(
            icono: Icons.domain_disabled,
            titulo: 'No pertenece a ninguna organización',
            descripcion: 'Solo el administrador de una ONG crea y publica campañas.',
          );
        }

        final seleccionada = ref.watch(ongActivaProvider) ?? lista.first['id'] as String;
        final ong = lista.firstWhere((o) => o['id'] == seleccionada, orElse: () => lista.first);

        return Column(
          children: [
            if (lista.length > 1)
              Padding(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
                child: DropdownMenu<String>(
                  initialSelection: ong['id'] as String,
                  label: const Text('Organización'),
                  onSelected: (v) => ref.read(ongActivaProvider.notifier).seleccionar(v),
                  dropdownMenuEntries: [
                    for (final o in lista)
                      DropdownMenuEntry(
                        value: o['id'] as String,
                        label: (o['nombreComercial'] ?? o['razonSocial']) as String,
                      ),
                  ],
                ),
              ),
            Expanded(child: _Panel(ong: ong)),
          ],
        );
      },
    );
  }
}

class _Panel extends ConsumerWidget {
  const _Panel({required this.ong});

  final Map<String, dynamic> ong;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ongId = ong['id'] as String;
    final esAdmin = ong['cargo'] == 'ADMINISTRADOR';
    final verificada = ong['estadoVerificacion'] == 'VERIFICADA';
    final campanas = ref.watch(estadoFondosProvider(ongId));

    return Scaffold(
      body: campanas.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar las campañas.',
          onReintentar: () => ref.invalidate(estadoFondosProvider(ongId)),
        ),
        data: (lista) => RefreshIndicator(
          onRefresh: () async => ref.invalidate(estadoFondosProvider(ongId)),
          child: Contenido(
            child: ListView(
              padding: const EdgeInsets.only(bottom: 88),
              children: [
                if (!esAdmin)
                  const _Aviso(
                    texto: 'Solo el administrador de la organización crea y edita campañas. '
                        'Usted las ve en modo consulta.',
                  ),
                if (esAdmin && !verificada)
                  const _Aviso(
                    texto: 'Su organización todavía no está verificada: puede preparar campañas '
                        'en borrador, pero no publicarlas hasta que un auditor la verifique.',
                  ),
                if (lista.isEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 48),
                    child: EstadoVacio(
                      icono: Icons.campaign_outlined,
                      titulo: 'Sin campañas todavía',
                      descripcion: esAdmin
                          ? 'Cree una campaña, agréguele fondos con un destino concreto y '
                              'publíquela para empezar a recibir aportes.'
                          : 'El administrador de la organización todavía no creó campañas.',
                      accion: esAdmin
                          ? FilledButton.icon(
                              onPressed: () => _nuevaCampana(context, ref, ongId),
                              icon: const Icon(Icons.add),
                              label: const Text('Crear la primera campaña'),
                            )
                          : null,
                    ),
                  ),
                for (final campana in _ordenadas(lista)) ...[
                  _TarjetaCampana(
                    campana: campana,
                    ongId: ongId,
                    esAdmin: esAdmin,
                    verificada: verificada,
                  ),
                  const SizedBox(height: 12),
                ],
              ],
            ),
          ),
        ),
      ),
      floatingActionButton: esAdmin && (campanas.value?.isNotEmpty ?? false)
          ? FloatingActionButton.extended(
              onPressed: () => _nuevaCampana(context, ref, ongId),
              icon: const Icon(Icons.add),
              label: const Text('Nueva campaña'),
            )
          : null,
    );
  }

  /// Primero lo que pide trabajo (borradores), al final lo cerrado.
  List<Map<String, dynamic>> _ordenadas(List<Map<String, dynamic>> lista) {
    const orden = {'BORRADOR': 0, 'ACTIVA': 1, 'PAUSADA': 2, 'CERRADA': 3};
    return [...lista]..sort((a, b) => (orden[a['estado']] ?? 9).compareTo(orden[b['estado']] ?? 9));
  }

  Future<void> _nuevaCampana(BuildContext context, WidgetRef ref, String ongId) async {
    final campanaId = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => PantallaEditarCampana(ongId: ongId)),
    );
    if (campanaId == null) return;

    ref.invalidate(estadoFondosProvider(ongId));
    if (!context.mounted) return;

    // Sin fondos no se puede publicar: se ofrece crear el primero ya mismo.
    final crear = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Borrador creado'),
        content: const Text(
          'Para publicarla necesita al menos un fondo: el destino concreto al que irán los '
          'aportes. ¿Lo crea ahora?',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Después'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Crear fondo'),
          ),
        ],
      ),
    );
    if (crear == true && context.mounted) {
      await abrirHojaFondo(context, ref, ongId: ongId, campanaId: campanaId);
    }
  }
}

/// Abre la hoja para crear o editar un fondo y refresca la lista al guardar.
Future<void> abrirHojaFondo(
  BuildContext context,
  WidgetRef ref, {
  required String ongId,
  required String campanaId,
  Map<String, dynamic>? fondo,
}) async {
  final guardo = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    builder: (_) => HojaFondo(campanaId: campanaId, fondo: fondo),
  );
  if (guardo == true) ref.invalidate(estadoFondosProvider(ongId));
}

class _TarjetaCampana extends ConsumerWidget {
  const _TarjetaCampana({
    required this.campana,
    required this.ongId,
    required this.esAdmin,
    required this.verificada,
  });

  final Map<String, dynamic> campana;
  final String ongId;
  final bool esAdmin;
  final bool verificada;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final estado = campana['estado'] as String;
    final fondos = (campana['fondos'] as List<dynamic>).cast<Map<String, dynamic>>();
    final editable = esAdmin && estado != 'CERRADA';
    final inicio = Formato.aDia(campana['fechaInicio']);
    final fin = Formato.aDia(campana['fechaFin']);

    return Card(
      clipBehavior: Clip.antiAlias,
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                if (campana['imagenUrl'] != null) ...[
                  ClipRRect(
                    borderRadius: BorderRadius.circular(8),
                    child: Image.network(
                      urlDeArchivo(campana['imagenUrl'] as String),
                      width: 88,
                      height: 66,
                      fit: BoxFit.cover,
                      semanticLabel: 'Portada de la campaña',
                      errorBuilder: (_, _, _) => const SizedBox(
                        width: 88,
                        height: 66,
                        child: Icon(Icons.image_not_supported_outlined),
                      ),
                    ),
                  ),
                  const SizedBox(width: 12),
                ],
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(campana['titulo'] as String, style: tema.textTheme.titleMedium),
                      const SizedBox(height: 4),
                      Text(
                        [
                          campana['causa'] as String? ?? '',
                          if (campana['departamento'] != null) campana['departamento'] as String,
                          fin == null
                              ? 'desde ${Formato.fecha(inicio)}'
                              : '${Formato.fecha(inicio)} – ${Formato.fecha(fin)}',
                        ].where((t) => t.isNotEmpty).join(' · '),
                        style: tema.textTheme.bodySmall?.copyWith(
                          color: tema.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                const SizedBox(width: 8),
                EtiquetaEstadoCampana(estado: estado),
              ],
            ),
            const SizedBox(height: 14),
            if (fondos.isEmpty)
              Text(
                estado == 'BORRADOR'
                    ? 'Sin fondos todavía. Agregue al menos uno para poder publicarla.'
                    : 'Sin fondos.',
                style: tema.textTheme.bodySmall?.copyWith(color: TemaApp.nivelMedio),
              ),
            for (final fondo in fondos)
              _FilaFondo(
                fondo: fondo,
                editable: editable && fondo['estado'] != 'CERRADO',
                onAccion: (accion) => _accionFondo(context, ref, fondo, accion),
              ),
            if (esAdmin) ...[
              const SizedBox(height: 8),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: _acciones(context, ref, estado, fondos),
              ),
            ],
          ],
        ),
      ),
    );
  }

  List<Widget> _acciones(
    BuildContext context,
    WidgetRef ref,
    String estado,
    List<Map<String, dynamic>> fondos,
  ) {
    final hayFondoActivo = fondos.any((f) => f['estado'] == 'ACTIVO');

    return [
      if (estado == 'BORRADOR')
        Tooltip(
          message: !verificada
              ? 'La organización todavía no está verificada'
              : !hayFondoActivo
                  ? 'Agregue al menos un fondo activo'
                  : 'Los donantes podrán encontrarla y aportar',
          child: FilledButton.icon(
            onPressed: verificada && hayFondoActivo
                ? () => _cambiarEstado(context, ref, 'ACTIVA')
                : null,
            icon: const Icon(Icons.public),
            label: const Text('Publicar'),
          ),
        ),
      if (estado == 'PAUSADA')
        FilledButton.icon(
          onPressed: () => _cambiarEstado(context, ref, 'ACTIVA'),
          icon: const Icon(Icons.play_arrow),
          label: const Text('Reanudar'),
        ),
      if (estado != 'CERRADA') ...[
        OutlinedButton.icon(
          onPressed: () => _editar(context, ref),
          icon: const Icon(Icons.edit_outlined),
          label: const Text('Editar'),
        ),
        OutlinedButton.icon(
          onPressed: () => abrirHojaFondo(
            context,
            ref,
            ongId: ongId,
            campanaId: campana['id'] as String,
          ),
          icon: const Icon(Icons.add),
          label: const Text('Agregar fondo'),
        ),
      ],
      if (estado == 'ACTIVA') ...[
        OutlinedButton.icon(
          onPressed: () => Navigator.of(context).push(
            MaterialPageRoute<void>(
              builder: (_) => PantallaCampana(slug: campana['slug'] as String),
            ),
          ),
          icon: const Icon(Icons.visibility_outlined),
          label: const Text('Ver como donante'),
        ),
        OutlinedButton.icon(
          onPressed: () => _cambiarEstado(context, ref, 'PAUSADA'),
          icon: const Icon(Icons.pause),
          label: const Text('Pausar'),
        ),
      ],
      if (estado == 'ACTIVA' || estado == 'PAUSADA' || estado == 'BORRADOR')
        TextButton.icon(
          onPressed: () => _cerrar(context, ref),
          icon: const Icon(Icons.lock_outline),
          label: const Text('Cerrar'),
        ),
    ];
  }

  Future<void> _editar(BuildContext context, WidgetRef ref) async {
    final guardada = await Navigator.of(context).push<String>(
      MaterialPageRoute(builder: (_) => PantallaEditarCampana(ongId: ongId, campana: campana)),
    );
    if (guardada != null) ref.invalidate(estadoFondosProvider(ongId));
  }

  Future<void> _cerrar(BuildContext context, WidgetRef ref) async {
    final confirma = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('¿Cerrar la campaña?'),
        content: const Text(
          'Dejará de recibir aportes y no se podrá reabrir. Lo que sus fondos retienen se '
          'sigue justificando con gastos, como hasta ahora.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(context).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(true),
            child: const Text('Cerrar campaña'),
          ),
        ],
      ),
    );
    if (confirma == true && context.mounted) await _cambiarEstado(context, ref, 'CERRADA');
  }

  Future<void> _cambiarEstado(BuildContext context, WidgetRef ref, String estado) async {
    await _llamar(
      context,
      ref,
      () => ref
          .read(clienteApiProvider)
          .actualizar('/campanas/${campana['id']}', cuerpo: {'estado': estado}),
      exito: switch (estado) {
        'ACTIVA' => 'Campaña publicada: ya aparece en el buscador de causas.',
        'PAUSADA' => 'Campaña pausada: no recibe aportes hasta que la reanude.',
        'CERRADA' => 'Campaña cerrada.',
        _ => 'Listo.',
      },
    );
  }

  Future<void> _accionFondo(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> fondo,
    String accion,
  ) async {
    if (accion == 'editar') {
      await abrirHojaFondo(
        context,
        ref,
        ongId: ongId,
        campanaId: campana['id'] as String,
        fondo: fondo,
      );
      return;
    }
    if (accion == 'CERRADO') {
      final confirma = await showDialog<bool>(
        context: context,
        builder: (context) => AlertDialog(
          title: Text('¿Cerrar el fondo ${fondo['nombre']}?'),
          content: const Text(
            'Dejará de recibir aportes y no se podrá reabrir. Lo que retiene se sigue '
            'justificando con gastos.',
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(false),
              child: const Text('Cancelar'),
            ),
            FilledButton(
              onPressed: () => Navigator.of(context).pop(true),
              child: const Text('Cerrar fondo'),
            ),
          ],
        ),
      );
      if (confirma != true || !context.mounted) return;
    }
    await _llamar(
      context,
      ref,
      () => ref
          .read(clienteApiProvider)
          .actualizar('/fondos/${fondo['id']}', cuerpo: {'estado': accion}),
      exito: switch (accion) {
        'PAUSADO' => 'Fondo pausado: no recibe aportes hasta que lo reanude.',
        'CERRADO' => 'Fondo cerrado. Lo que retiene se sigue justificando con gastos.',
        _ => 'Fondo reanudado.',
      },
    );
  }

  Future<void> _llamar(
    BuildContext context,
    WidgetRef ref,
    Future<Object?> Function() peticion, {
    required String exito,
  }) async {
    final mensajero = ScaffoldMessenger.of(context);
    try {
      await peticion();
      ref.invalidate(estadoFondosProvider(ongId));
      mensajero.showSnackBar(SnackBar(content: Text(exito)));
    } on ErrorApi catch (e) {
      mensajero.showSnackBar(SnackBar(content: Text(e.mensaje)));
    }
  }
}

/// Estado de una campaña en palabras de quien la administra.
class EtiquetaEstadoCampana extends StatelessWidget {
  const EtiquetaEstadoCampana({super.key, required this.estado});

  final String estado;

  @override
  Widget build(BuildContext context) {
    final (texto, color) = switch (estado) {
      'BORRADOR' => ('Borrador', Theme.of(context).colorScheme.outline),
      'ACTIVA' => ('Publicada', TemaApp.nivelAlto),
      'PAUSADA' => ('Pausada', TemaApp.nivelMedio),
      'CERRADA' => ('Cerrada', Theme.of(context).colorScheme.onSurfaceVariant),
      _ => (estado, Theme.of(context).colorScheme.outline),
    };

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Text(
        texto,
        style: Theme.of(context).textTheme.labelMedium?.copyWith(color: color),
      ),
    );
  }
}

class _FilaFondo extends StatelessWidget {
  const _FilaFondo({required this.fondo, required this.editable, required this.onAccion});

  final Map<String, dynamic> fondo;
  final bool editable;
  final void Function(String accion) onAccion;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final estado = fondo['estado'] as String? ?? 'ACTIVO';

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Icon(Icons.savings_outlined, size: 18, color: tema.colorScheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  estado == 'ACTIVO'
                      ? fondo['nombre'] as String
                      : '${fondo['nombre']} · ${estado == 'PAUSADO' ? 'pausado' : 'cerrado'}',
                  style: tema.textTheme.bodyMedium,
                ),
                Text(
                  '${Formato.categoria(fondo['categoriaGasto'] as String?)} · '
                  '${Formato.soles(fondo['recaudado'] as String?)} de '
                  '${Formato.soles(fondo['meta'] as String?)}',
                  style: tema.textTheme.bodySmall?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
          if (editable)
            PopupMenuButton<String>(
              tooltip: 'Acciones del fondo ${fondo['nombre']}',
              onSelected: onAccion,
              itemBuilder: (_) => [
                const PopupMenuItem(value: 'editar', child: Text('Editar')),
                if (estado == 'ACTIVO') const PopupMenuItem(value: 'PAUSADO', child: Text('Pausar')),
                if (estado == 'PAUSADO')
                  const PopupMenuItem(value: 'ACTIVO', child: Text('Reanudar')),
                const PopupMenuItem(value: 'CERRADO', child: Text('Cerrar')),
              ],
            ),
        ],
      ),
    );
  }
}

class _Aviso extends StatelessWidget {
  const _Aviso({required this.texto});

  final String texto;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tema.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 18, color: tema.colorScheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(child: Text(texto, style: tema.textTheme.bodySmall)),
        ],
      ),
    );
  }
}
