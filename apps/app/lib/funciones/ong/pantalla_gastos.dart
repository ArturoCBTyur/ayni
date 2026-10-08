import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';
import 'pantalla_detalle_gasto.dart';
import 'pantalla_fondos.dart';
import 'pantalla_registrar_gasto.dart';

final gastosOngProvider =
    FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, ongId) async {
  final gastos = await ref.read(clienteApiProvider).obtenerLista('/ongs/$ongId/gastos');

  // El analisis corre en segundo plano y termina en segundos. Sin volver a
  // consultar, la tarjeta se quedaria en "En análisis" hasta que alguien
  // recargue, y en la demo eso se lee como que el motor se colgo. Se vuelve
  // a pedir solo mientras quede algo pendiente, y se deja de hacer al salir.
  if (gastos.any((g) => g['estado'] == 'EN_ANALISIS')) {
    final temporizador = Timer(_intervaloAnalisis, ref.invalidateSelf);
    ref.onDispose(temporizador.cancel);
  }
  return gastos;
});

/// El trabajador de la cola revisa cada 5 s; con 4 s el resultado se ve en la
/// vuelta siguiente sin consultar a la API mas de lo que sirve.
const _intervaloAnalisis = Duration(seconds: 4);

/// Gastos registrados por la ONG, con el resultado de su verificacion.
class PantallaGastos extends ConsumerWidget {
  const PantallaGastos({super.key});

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
            descripcion: 'Solo los miembros de una ONG pueden registrar gastos.',
          );
        }

        final ongId = ref.watch(ongActivaProvider) ?? lista.first['id'] as String;
        final gastos = ref.watch(gastosOngProvider(ongId));

        return Scaffold(
          body: gastos.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => TarjetaError(
              mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar los gastos.',
              onReintentar: () => ref.invalidate(gastosOngProvider(ongId)),
            ),
            data: (gastosLista) {
              if (gastosLista.isEmpty) {
                return EstadoVacio(
                  icono: Icons.receipt_long_outlined,
                  titulo: 'Sin gastos registrados',
                  descripcion:
                      'Registre un gasto con su comprobante y una foto. El dinero retenido '
                      'no se libera hasta que ambos se verifiquen.',
                  accion: FilledButton.icon(
                    onPressed: () => _registrar(context, ref, ongId),
                    icon: const Icon(Icons.add_a_photo_outlined),
                    label: const Text('Registrar gasto'),
                  ),
                );
              }

              return RefreshIndicator(
                onRefresh: () async => ref.invalidate(gastosOngProvider(ongId)),
                child: Contenido(
                  child: ListView.separated(
                    itemCount: gastosLista.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 10),
                    itemBuilder: (context, i) => _TarjetaGasto(
                      gasto: gastosLista[i],
                      onAbrir: () => _abrir(context, ref, ongId, gastosLista[i]['id'] as String),
                    ),
                  ),
                ),
              );
            },
          ),
          floatingActionButton: gastos.hasValue && gastos.value!.isNotEmpty
              ? FloatingActionButton.extended(
                  onPressed: () => _registrar(context, ref, ongId),
                  icon: const Icon(Icons.add_a_photo_outlined),
                  label: const Text('Registrar gasto'),
                )
              : null,
        );
      },
    );
  }

  Future<void> _abrir(BuildContext context, WidgetRef ref, String ongId, String gastoId) async {
    await Navigator.of(context).push<void>(
      MaterialPageRoute(builder: (_) => PantallaDetalleGasto(gastoId: gastoId)),
    );
    // En el detalle se pudo difuminar una foto: la lista lo refleja al volver.
    ref.invalidate(gastosOngProvider(ongId));
  }

  Future<void> _registrar(BuildContext context, WidgetRef ref, String ongId) async {
    final registrado = await Navigator.of(context).push<bool>(
      MaterialPageRoute(builder: (_) => PantallaRegistrarGasto(ongId: ongId)),
    );

    if (registrado == true) {
      ref.invalidate(gastosOngProvider(ongId));
      ref.invalidate(estadoFondosProvider(ongId));
    }
  }
}

class _TarjetaGasto extends StatelessWidget {
  const _TarjetaGasto({required this.gasto, required this.onAbrir});

  final Map<String, dynamic> gasto;
  final VoidCallback onAbrir;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final nivel = gasto['nivel'] as String?;
    final observaciones =
        (gasto['observaciones'] as List<dynamic>?)?.cast<String>() ?? const <String>[];
    final porDifuminar = gasto['fotosPorDifuminar'] as int? ?? 0;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onAbrir,
        child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(gasto['concepto'] as String, style: tema.textTheme.titleSmall),
                      Text(
                        '${gasto['proveedor']} · ${gasto['fondo']}',
                        style: tema.textTheme.bodySmall?.copyWith(
                          color: tema.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  Formato.soles(gasto['monto'] as String?),
                  style: tema.textTheme.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                ),
              ],
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                EstadoGasto(estado: gasto['estado'] as String),
                const SizedBox(width: 8),
                if (nivel != null)
                  InsigniaNivel(nivel: nivel, score: gasto['scoreFinal'] as num?),
                const Spacer(),
                Text(
                  Formato.fecha(Formato.aFecha(gasto['fechaGasto'])),
                  style: tema.textTheme.bodySmall,
                ),
              ],
            ),
            // Por que el motor decidio lo que decidio.
            //
            // Sin esto la tarjeta dice "OBSERVADO · BAJO 0" y nada mas, y quien
            // tiene que corregir el gasto se queda sin saber que corregir. La
            // explicacion es el centro del RNF-09: existe para que una persona
            // pueda actuar, no solo para que un auditor pueda revisar.
            if (observaciones.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Divider(height: 1),
              const SizedBox(height: 10),
              for (final observacion in observaciones)
                Padding(
                  padding: const EdgeInsets.only(bottom: 6),
                  child: Row(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Padding(
                        padding: const EdgeInsets.only(top: 3),
                        child: Icon(
                          Icons.info_outline,
                          size: 15,
                          color: TemaApp.colorNivel(nivel ?? 'MEDIO'),
                        ),
                      ),
                      const SizedBox(width: 8),
                      Expanded(
                        child: Text(observacion, style: tema.textTheme.bodySmall),
                      ),
                    ],
                  ),
                ),
            ],
            if (porDifuminar > 0) ...[
              const SizedBox(height: 10),
              Row(
                children: [
                  Icon(Icons.blur_on, size: 16, color: TemaApp.nivelMedio),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      porDifuminar == 1
                          ? 'Una foto con personas por difuminar: el donante no la verá hasta '
                              'entonces. Abra el gasto para hacerlo.'
                          : '$porDifuminar fotos con personas por difuminar. Abra el gasto para '
                              'hacerlo.',
                      style: tema.textTheme.bodySmall,
                    ),
                  ),
                ],
              ),
            ],
          ],
        ),
      ),
      ),
    );
  }
}

/// Estado del gasto en palabras de quien lo registro.
class EstadoGasto extends StatelessWidget {
  const EstadoGasto({super.key, required this.estado});

  final String estado;

  @override
  Widget build(BuildContext context) {
    final (texto, icono) = switch (estado) {
      'EN_ANALISIS' => ('En análisis', Icons.hourglass_empty),
      'EN_REVISION' => ('En revisión de auditoría', Icons.fact_check_outlined),
      'OBSERVADO' => ('Observado', Icons.warning_amber_outlined),
      'APROBADO' => ('Aprobado y ejecutado', Icons.check_circle_outline),
      'RECHAZADO' => ('Rechazado', Icons.cancel_outlined),
      _ => (estado, Icons.circle_outlined),
    };

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(icono, size: 16, color: Theme.of(context).colorScheme.onSurfaceVariant),
        const SizedBox(width: 6),
        Text(texto, style: Theme.of(context).textTheme.labelMedium),
      ],
    );
  }
}
