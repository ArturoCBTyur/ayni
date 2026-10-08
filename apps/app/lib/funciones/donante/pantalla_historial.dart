import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';
import 'pantalla_detalle_aporte.dart';

final historialProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return ref.read(clienteApiProvider).obtener('/donaciones/historial');
});

final suscripcionesProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  return ref.read(clienteApiProvider).obtenerLista('/suscripciones');
});

/// RF-13 y RF-PS-01 · Historial con la linea de tiempo de cada aporte.
///
/// El estado se muestra en el lenguaje del donante, no en el del modelo de
/// datos: lo que reduce la incertidumbre posterior a la donacion es entender
/// en que punto esta su dinero, no conocer el nombre de un enum.
class PantallaHistorial extends ConsumerWidget {
  const PantallaHistorial({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final historial = ref.watch(historialProvider);
    final suscripciones = ref.watch(suscripcionesProvider).value ?? const [];

    return historial.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar su historial.',
        onReintentar: () => ref.invalidate(historialProvider),
      ),
      data: (datos) {
        final donaciones = (datos['donaciones'] as List<dynamic>).cast<Map<String, dynamic>>();

        if (donaciones.isEmpty && suscripciones.isEmpty) {
          return const EstadoVacio(
            icono: Icons.volunteer_activism_outlined,
            titulo: 'Todavía no ha donado',
            descripcion:
                'Cuando aporte a un fondo, aquí verá en qué punto está su dinero: retenido, '
                'en verificación o ya ejecutado con evidencia.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(historialProvider);
            ref.invalidate(suscripcionesProvider);
          },
          child: Contenido(
            child: ListView(
              children: [
                if (suscripciones.isNotEmpty) ...[
                  _Suscripciones(suscripciones: suscripciones),
                  const SizedBox(height: 20),
                ],
                for (final donacion in donaciones) ...[
                  _TarjetaDonacion(donacion: donacion),
                  const SizedBox(height: 12),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

class _TarjetaDonacion extends StatelessWidget {
  const _TarjetaDonacion({required this.donacion});

  final Map<String, dynamic> donacion;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final estado = donacion['estado'] as Map<String, dynamic>;
    final campana = donacion['campana'] as Map<String, dynamic>;
    final fondo = donacion['fondo'] as Map<String, dynamic>;
    final financiados = donacion['gastosFinanciados'] as int? ?? 0;

    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        // El detalle dice en que gastos se uso, con su foto: la tarjeta solo
        // dice cuanto.
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => PantallaDetalleAporte(donacionId: donacion['id'] as String),
          ),
        ),
        child: Padding(
        padding: const EdgeInsets.all(16),
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
                      Text(fondo['nombre'] as String, style: tema.textTheme.titleSmall),
                      Text(
                        '${campana['titulo']} · ${donacion['ong']}',
                        style: tema.textTheme.bodySmall?.copyWith(
                          color: tema.colorScheme.onSurfaceVariant,
                        ),
                      ),
                    ],
                  ),
                ),
                Text(
                  Formato.soles(donacion['monto'] as String?),
                  style: tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700),
                ),
              ],
            ),

            const SizedBox(height: 16),
            _LineaDeTiempo(codigo: estado['codigo'] as String),
            const SizedBox(height: 12),

            Container(
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: _color(estado['codigo'] as String).withValues(alpha: 0.08),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    estado['etiqueta'] as String,
                    style: tema.textTheme.labelLarge?.copyWith(
                      color: _color(estado['codigo'] as String),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(estado['descripcion'] as String, style: tema.textTheme.bodySmall),
                ],
              ),
            ),

            const SizedBox(height: 12),
            Wrap(
              spacing: 24,
              runSpacing: 6,
              children: [
                _Dato(
                  etiqueta: 'Comisión',
                  valor: Formato.soles(donacion['comision'] as String?),
                ),
                _Dato(
                  etiqueta: 'Llegó al fondo',
                  valor: Formato.soles(donacion['montoNeto'] as String?),
                ),
                if (donacion['montoAplicado'] != '0.00')
                  _Dato(
                    etiqueta: 'Ya ejecutado',
                    valor: Formato.soles(donacion['montoAplicado'] as String?),
                  ),
                _Dato(
                  etiqueta: 'Fecha',
                  valor: Formato.fecha(Formato.aFecha(donacion['fecha'])),
                ),
              ],
            ),
            const SizedBox(height: 8),
            Align(
              alignment: Alignment.centerRight,
              child: Text(
                financiados == 0
                    ? 'Ver detalle'
                    : financiados == 1
                        ? 'Ver en qué gasto se usó'
                        : 'Ver en qué $financiados gastos se usó',
                style: tema.textTheme.labelLarge?.copyWith(color: tema.colorScheme.primary),
              ),
            ),
          ],
        ),
      ),
      ),
    );
  }

  Color _color(String codigo) => switch (codigo) {
        'VERIFICADO' => TemaApp.nivelAlto,
        'PARCIAL' => TemaApp.nivelAlto,
        'RETENIDO' => TemaApp.nivelMedio,
        'FALLIDA' || 'REVERSADA' => TemaApp.nivelBajo,
        _ => TemaApp.semilla,
      };
}

/// CU04 · Donaciones mensuales, con pausar, reanudar y cancelar en un toque
/// (RF-08): dejar de donar no debe costar mas que empezar.
class _Suscripciones extends ConsumerWidget {
  const _Suscripciones({required this.suscripciones});

  final List<Map<String, dynamic>> suscripciones;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Donaciones mensuales', style: tema.textTheme.titleMedium),
        const SizedBox(height: 8),
        for (final s in suscripciones)
          Card(
            child: Padding(
              padding: const EdgeInsets.all(12),
              child: Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                alignment: WrapAlignment.spaceBetween,
                children: [
                  ConstrainedBox(
                    constraints: const BoxConstraints(minWidth: 220, maxWidth: 420),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          '${Formato.soles(s['monto'] as String?)} al mes · '
                          '${(s['fondo'] as Map<String, dynamic>?)?['nombre'] ?? 'Fondo'}',
                          style: tema.textTheme.titleSmall,
                        ),
                        Text(
                          s['estado'] == 'ACTIVA'
                              ? 'Día ${s['diaCobro']} de cada mes · próximo cobro '
                                  '${Formato.fecha(Formato.aFecha(s['proximoCobroEn']))}'
                              : 'En pausa: no se cobra hasta que la reanude.',
                          style: tema.textTheme.bodySmall?.copyWith(
                            color: tema.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                  Wrap(
                    spacing: 4,
                    children: [
                      if (s['estado'] == 'ACTIVA')
                        TextButton(
                          onPressed: () => _cambiar(context, ref, s, 'PAUSAR'),
                          child: const Text('Pausar'),
                        )
                      else
                        TextButton(
                          onPressed: () => _cambiar(context, ref, s, 'REANUDAR'),
                          child: const Text('Reanudar'),
                        ),
                      TextButton(
                        onPressed: () => _cambiar(context, ref, s, 'CANCELAR'),
                        child: const Text('Cancelar'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
          ),
      ],
    );
  }

  Future<void> _cambiar(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> suscripcion,
    String accion,
  ) async {
    final mensajero = ScaffoldMessenger.of(context);
    try {
      await ref
          .read(clienteApiProvider)
          .actualizar('/suscripciones/${suscripcion['id']}', cuerpo: {'accion': accion});
      ref.invalidate(suscripcionesProvider);
      mensajero.showSnackBar(
        SnackBar(
          content: Text(switch (accion) {
            'PAUSAR' => 'Donación mensual en pausa.',
            'REANUDAR' => 'Donación mensual reanudada.',
            _ => 'Donación mensual cancelada. No se volverá a cobrar.',
          }),
        ),
      );
    } on ErrorApi catch (e) {
      mensajero.showSnackBar(SnackBar(content: Text(e.mensaje)));
    }
  }
}

/// RF-PS-01 · Donado → Retenido → En verificación → Ejecutado → Verificado.
class _LineaDeTiempo extends StatelessWidget {
  const _LineaDeTiempo({required this.codigo});

  final String codigo;

  static const _pasos = ['Donado', 'Retenido', 'Ejecutado', 'Verificado'];

  int get _alcanzado => switch (codigo) {
        'DONADO' => 0,
        'RETENIDO' => 1,
        'PARCIAL' => 2,
        'VERIFICADO' => 3,
        _ => -1,
      };

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    // Un pago fallido no tiene recorrido que mostrar: la linea de tiempo
    // sugeriria un progreso que no ocurrio.
    if (_alcanzado < 0) return const SizedBox.shrink();

    return Semantics(
      label: 'Estado del aporte: ${_pasos[_alcanzado]}, paso ${_alcanzado + 1} de ${_pasos.length}',
      child: Row(
        children: [
          for (var i = 0; i < _pasos.length; i++) ...[
            Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(
                  i <= _alcanzado ? Icons.check_circle : Icons.circle_outlined,
                  size: 18,
                  color: i <= _alcanzado ? TemaApp.nivelAlto : tema.colorScheme.outlineVariant,
                ),
                const SizedBox(height: 4),
                Text(
                  _pasos[i],
                  style: tema.textTheme.labelSmall?.copyWith(
                    color: i <= _alcanzado
                        ? tema.colorScheme.onSurface
                        : tema.colorScheme.outline,
                  ),
                ),
              ],
            ),
            if (i < _pasos.length - 1)
              Expanded(
                child: Container(
                  height: 2,
                  margin: const EdgeInsets.only(bottom: 18),
                  color: i < _alcanzado
                      ? TemaApp.nivelAlto
                      : tema.colorScheme.outlineVariant,
                ),
              ),
          ],
        ],
      ),
    );
  }
}

class _Dato extends StatelessWidget {
  const _Dato({required this.etiqueta, required this.valor});

  final String etiqueta;
  final String valor;

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
        Text(valor, style: tema.textTheme.bodyMedium),
      ],
    );
  }
}
