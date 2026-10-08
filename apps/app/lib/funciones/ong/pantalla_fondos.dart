import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';

/// ONG a las que pertenece el usuario en sesion.
final misOngsProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  return ref.read(clienteApiProvider).obtenerLista('/ongs/mias/listado');
});

/// ONG seleccionada; quien pertenece a varias elige con cual trabaja.
class OngActivaNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void seleccionar(String? ongId) => state = ongId;
}

final ongActivaProvider = NotifierProvider<OngActivaNotifier, String?>(OngActivaNotifier.new);

final estadoFondosProvider =
    FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, ongId) async {
  return ref.read(clienteApiProvider).obtenerLista('/ongs/$ongId/fondos');
});

final alertasOngProvider =
    FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, ongId) async {
  return ref.read(clienteApiProvider).obtenerLista('/ongs/$ongId/alertas');
});

/// CU12 · Estado de fondos: recaudado, retenido y ejecutado.
class PantallaFondos extends ConsumerWidget {
  const PantallaFondos({super.key});

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
            descripcion:
                'Si su ONG ya está registrada, pida a su administrador que lo agregue como '
                'miembro para poder registrar gastos.',
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
                  initialSelection: seleccionada,
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
            Expanded(child: _PanelOng(ong: ong)),
          ],
        );
      },
    );
  }
}

class _PanelOng extends ConsumerWidget {
  const _PanelOng({required this.ong});

  final Map<String, dynamic> ong;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ongId = ong['id'] as String;
    final campanas = ref.watch(estadoFondosProvider(ongId));
    final alertas = ref.watch(alertasOngProvider(ongId));
    final tema = Theme.of(context);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(estadoFondosProvider(ongId));
        ref.invalidate(alertasOngProvider(ongId));
      },
      child: Contenido(
        child: ListView(
          children: [
            _CabeceraOng(ong: ong),
            const SizedBox(height: 20),

            alertas.maybeWhen(
              data: (lista) {
                final abiertas =
                    lista.where((a) => a['estado'] != 'RESUELTA' && a['estado'] != 'DESCARTADA');
                if (abiertas.isEmpty) return const SizedBox.shrink();

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text('Observaciones por resolver', style: tema.textTheme.titleSmall),
                    const SizedBox(height: 8),
                    for (final alerta in abiertas) _TarjetaAlerta(alerta: alerta, ongId: ongId),
                    const SizedBox(height: 20),
                  ],
                );
              },
              orElse: () => const SizedBox.shrink(),
            ),

            campanas.when(
              loading: () => const Center(child: Padding(
                padding: EdgeInsets.all(32),
                child: CircularProgressIndicator(),
              )),
              error: (e, _) => TarjetaError(
                mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar los fondos.',
                onReintentar: () => ref.invalidate(estadoFondosProvider(ongId)),
              ),
              data: (lista) {
                if (lista.isEmpty) {
                  return const EstadoVacio(
                    icono: Icons.campaign_outlined,
                    titulo: 'Sin campañas todavía',
                    descripcion: 'Cree una campaña y sus fondos para empezar a recibir aportes.',
                  );
                }

                return Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    for (final campana in lista) ...[
                      Row(
                        children: [
                          Expanded(
                            child: Text(
                              campana['titulo'] as String,
                              style: tema.textTheme.titleSmall,
                            ),
                          ),
                          Chip(
                            label: Text(campana['estado'] as String),
                            visualDensity: VisualDensity.compact,
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      for (final fondo
                          in (campana['fondos'] as List<dynamic>).cast<Map<String, dynamic>>())
                        _FilaFondo(fondo: fondo),
                      const SizedBox(height: 20),
                    ],
                  ],
                );
              },
            ),
          ],
        ),
      ),
    );
  }
}

class _CabeceraOng extends StatelessWidget {
  const _CabeceraOng({required this.ong});

  final Map<String, dynamic> ong;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final verificada = ong['estadoVerificacion'] == 'VERIFICADA';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    (ong['nombreComercial'] ?? ong['razonSocial']) as String,
                    style: tema.textTheme.titleMedium,
                  ),
                  const SizedBox(height: 4),
                  Row(
                    children: [
                      SelloVerificada(verificada: verificada),
                      if (!verificada)
                        Text(
                          'Verificación ${ong['estadoVerificacion']}',
                          style: tema.textTheme.bodySmall?.copyWith(
                            color: TemaApp.nivelMedio,
                          ),
                        ),
                      const SizedBox(width: 12),
                      Text('RUC ${ong['ruc']}', style: tema.textTheme.bodySmall),
                    ],
                  ),
                  if (ong['motivoRechazo'] != null && !verificada) ...[
                    const SizedBox(height: 6),
                    Text(
                      'Motivo: ${ong['motivoRechazo']}',
                      style: tema.textTheme.bodySmall?.copyWith(color: TemaApp.nivelBajo),
                    ),
                  ],
                  if (ong['cargo'] != null) ...[
                    const SizedBox(height: 4),
                    // El administrador crea campañas y fondos; el operador
                    // registra gastos. Decirlo evita buscar opciones que su
                    // cargo no tiene.
                    Text(
                      ong['cargo'] == 'ADMINISTRADOR'
                          ? 'Su cargo: administrador de la organización'
                          : 'Su cargo: operador de campo',
                      style: tema.textTheme.labelSmall?.copyWith(
                        color: tema.colorScheme.onSurfaceVariant,
                      ),
                    ),
                  ],
                ],
              ),
            ),
            Column(
              children: [
                Text(
                  ong['puntajeConfianza'] as String,
                  style: tema.textTheme.headlineSmall?.copyWith(color: TemaApp.semilla),
                ),
                Text('confianza', style: tema.textTheme.labelSmall),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _FilaFondo extends StatelessWidget {
  const _FilaFondo({required this.fondo});

  final Map<String, dynamic> fondo;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(child: Text(fondo['nombre'] as String)),
                Text(
                  Formato.categoria(fondo['categoriaGasto'] as String?),
                  style: tema.textTheme.labelSmall,
                ),
              ],
            ),
            const SizedBox(height: 10),
            BarraAvance(avance: (fondo['avance'] as num?) ?? 0, alto: 6),
            const SizedBox(height: 10),
            Wrap(
              spacing: 20,
              runSpacing: 6,
              children: [
                _Saldo('Recaudado', fondo['recaudado'] as String?),
                _Saldo('Por justificar', fondo['retenido'] as String?, TemaApp.nivelMedio),
                _Saldo('Ejecutado', fondo['ejecutado'] as String?, TemaApp.nivelAlto),
                _Saldo('Meta', fondo['meta'] as String?),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

class _Saldo extends StatelessWidget {
  const _Saldo(this.etiqueta, this.valor, [this.color]);

  final String etiqueta;
  final String? valor;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      mainAxisSize: MainAxisSize.min,
      children: [
        Text(
          etiqueta,
          style: tema.textTheme.labelSmall?.copyWith(
            color: tema.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(
          Formato.soles(valor),
          style: tema.textTheme.titleSmall?.copyWith(color: color),
        ),
      ],
    );
  }
}

/// CU11 · Subsanar una observacion.
class _TarjetaAlerta extends ConsumerWidget {
  const _TarjetaAlerta({required this.alerta, required this.ongId});

  final Map<String, dynamic> alerta;
  final String ongId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final dias = alerta['diasRestantes'] as int?;
    final afecta = alerta['afectaReputacion'] as bool;

    return Card(
      color: TemaApp.nivelMedio.withValues(alpha: 0.06),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.warning_amber_outlined, size: 18, color: TemaApp.nivelMedio),
                const SizedBox(width: 8),
                Expanded(child: Text(alerta['titulo'] as String, style: tema.textTheme.titleSmall)),
              ],
            ),
            const SizedBox(height: 8),
            Text(alerta['descripcion'] as String, style: tema.textTheme.bodySmall),
            const SizedBox(height: 10),
            Row(
              children: [
                if (dias != null)
                  Text(
                    dias >= 0
                        ? 'Quedan $dias día(s) para subsanar'
                        : 'El plazo venció hace ${-dias} día(s)',
                    style: tema.textTheme.labelSmall?.copyWith(
                      color: dias >= 0 ? tema.colorScheme.onSurfaceVariant : TemaApp.nivelBajo,
                    ),
                  ),
                const SizedBox(width: 12),
                // Transparencia con la ONG: sabe si esto ya cuenta en su
                // puntaje publico o si todavia esta a tiempo (RF-SO-04).
                Text(
                  afecta ? 'Afecta su puntaje' : 'Aún no afecta su puntaje',
                  style: tema.textTheme.labelSmall?.copyWith(
                    color: afecta ? TemaApp.nivelBajo : TemaApp.nivelAlto,
                  ),
                ),
                const Spacer(),
                TextButton(
                  onPressed: () => _subsanar(context, ref),
                  child: const Text('Subsanar'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _subsanar(BuildContext context, WidgetRef ref) async {
    final controlador = TextEditingController();

    final confirmado = await showDialog<bool>(
      context: context,
      builder: (contexto) => AlertDialog(
        title: const Text('Responder la observación'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              'Al responder, el gasto vuelve a análisis con la evidencia corregida. '
              'Responder no equivale a que se apruebe.',
            ),
            const SizedBox(height: 16),
            TextField(
              controller: controlador,
              maxLines: 4,
              decoration: const InputDecoration(labelText: '¿Qué corrigió?'),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.of(contexto).pop(false),
            child: const Text('Cancelar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(contexto).pop(true),
            child: const Text('Enviar'),
          ),
        ],
      ),
    );

    if (confirmado != true) return;

    try {
      await ref.read(clienteApiProvider).enviar(
        '/alertas/${alerta['id']}/subsanar',
        cuerpo: {'respuesta': controlador.text.trim()},
      );
      ref.invalidate(alertasOngProvider(ongId));
      ref.invalidate(estadoFondosProvider(ongId));
    } on ErrorApi catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(e.mensaje)));
      }
    }
  }
}
