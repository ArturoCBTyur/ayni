import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import 'pantalla_campana.dart';

/// Filtros del buscador de causas (RF-06).
class FiltrosCausas {
  const FiltrosCausas({this.texto = '', this.orden = 'relevancia'});

  final String texto;
  final String orden;

  FiltrosCausas copiarCon({String? texto, String? orden}) =>
      FiltrosCausas(texto: texto ?? this.texto, orden: orden ?? this.orden);
}

/// Riverpod 3 retiro StateProvider; un Notifier expresa mejor las
/// transiciones validas y evita mutaciones dispersas desde la interfaz.
class FiltrosCausasNotifier extends Notifier<FiltrosCausas> {
  @override
  FiltrosCausas build() => const FiltrosCausas();

  void buscar(String texto) => state = state.copiarCon(texto: texto);
  void ordenarPor(String orden) => state = state.copiarCon(orden: orden);
  void limpiar() => state = state.copiarCon(texto: '');
}

final filtrosCausasProvider =
    NotifierProvider<FiltrosCausasNotifier, FiltrosCausas>(FiltrosCausasNotifier.new);

final causasProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final filtros = ref.watch(filtrosCausasProvider);
  return ref.read(clienteApiProvider).obtener('/causas', consulta: {
    if (filtros.texto.trim().isNotEmpty) 'q': filtros.texto.trim(),
    'orden': filtros.orden,
    'porPagina': 12,
  });
});

/// CU02 · Explorar causas de ONG verificadas.
///
/// Solo aparecen campañas activas de organizaciones verificadas: el sello es
/// la señal sobre la que descansa la confianza del donante, y mostrarlas
/// mezcladas con no verificadas lo vaciaria de sentido.
class PantallaCausas extends ConsumerWidget {
  const PantallaCausas({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final causas = ref.watch(causasProvider);
    final filtros = ref.watch(filtrosCausasProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 8),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      decoration: const InputDecoration(
                        hintText: 'Buscar una causa: alimentos, veterinaria, esterilización...',
                        prefixIcon: Icon(Icons.search),
                      ),
                      textInputAction: TextInputAction.search,
                      onSubmitted: (v) =>
                          ref.read(filtrosCausasProvider.notifier).buscar(v),
                    ),
                  ),
                  const SizedBox(width: 12),
                  DropdownMenu<String>(
                    initialSelection: filtros.orden,
                    label: const Text('Ordenar'),
                    onSelected: (v) => ref
                        .read(filtrosCausasProvider.notifier)
                        .ordenarPor(v ?? 'relevancia'),
                    dropdownMenuEntries: const [
                      DropdownMenuEntry(value: 'relevancia', label: 'Relevancia'),
                      DropdownMenuEntry(value: 'confianza', label: 'Confianza'),
                      DropdownMenuEntry(value: 'avance', label: 'Avance'),
                      DropdownMenuEntry(value: 'recientes', label: 'Recientes'),
                    ],
                  ),
                ],
              ),
            ),
          ),
        ),
        Expanded(
          child: causas.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => TarjetaError(
              mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar las causas.',
              onReintentar: () => ref.invalidate(causasProvider),
            ),
            data: (datos) {
              final resultados =
                  (datos['resultados'] as List<dynamic>).cast<Map<String, dynamic>>();

              if (resultados.isEmpty) {
                return EstadoVacio(
                  icono: Icons.search_off,
                  titulo: 'No encontramos causas con ese criterio',
                  descripcion: filtros.texto.isEmpty
                      ? 'Todavía no hay campañas activas de organizaciones verificadas.'
                      : 'Pruebe con otras palabras o quite el filtro de búsqueda.',
                  accion: filtros.texto.isEmpty
                      ? null
                      : OutlinedButton(
                          onPressed: () =>
                              ref.read(filtrosCausasProvider.notifier).limpiar(),
                          child: const Text('Ver todas'),
                        ),
                );
              }

              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(causasProvider),
                child: Contenido(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        '${datos['total']} causa(s) de organizaciones verificadas',
                        style: Theme.of(context).textTheme.bodySmall,
                      ),
                      const SizedBox(height: 12),
                      Expanded(
                        child: ListView.separated(
                          itemCount: resultados.length,
                          separatorBuilder: (_, _) => const SizedBox(height: 12),
                          itemBuilder: (context, i) => _TarjetaCausa(causa: resultados[i]),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ],
    );
  }
}

class _TarjetaCausa extends StatelessWidget {
  const _TarjetaCausa({required this.causa});

  final Map<String, dynamic> causa;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final ong = causa['ong'] as Map<String, dynamic>;
    final avance = (causa['avance'] as num?) ?? 0;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute(
            builder: (_) => PantallaCampana(slug: causa['slug'] as String),
          ),
        ),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      causa['titulo'] as String,
                      style: tema.textTheme.titleMedium,
                    ),
                  ),
                  SelloVerificada(verificada: ong['verificada'] as bool),
                ],
              ),
              const SizedBox(height: 4),
              Text(
                '${ong['nombre']} · ${causa['causa']}'
                '${causa['departamento'] != null ? ' · ${causa['departamento']}' : ''}',
                style: tema.textTheme.bodySmall?.copyWith(
                  color: tema.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 12),
              Text(
                causa['descripcion'] as String,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: tema.textTheme.bodyMedium,
              ),
              const SizedBox(height: 16),
              BarraAvance(avance: avance),
              const SizedBox(height: 8),
              Row(
                children: [
                  Text(
                    '${Formato.soles(causa['recaudado'] as String?)} de '
                    '${Formato.soles(causa['meta'] as String?)}',
                    style: tema.textTheme.labelLarge,
                  ),
                  const Spacer(),
                  Text(
                    '${causa['fondos']} fondo(s) · confianza ${ong['puntajeConfianza']}',
                    style: tema.textTheme.bodySmall?.copyWith(
                      color: tema.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}
