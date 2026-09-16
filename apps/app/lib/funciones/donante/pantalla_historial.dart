import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';

final historialProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.read(clienteApiProvider).obtener('/donaciones/historial');
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

    return historial.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar su historial.',
        onReintentar: () => ref.invalidate(historialProvider),
      ),
      data: (datos) {
        final donaciones = (datos['donaciones'] as List<dynamic>).cast<Map<String, dynamic>>();

        if (donaciones.isEmpty) {
          return const EstadoVacio(
            icono: Icons.volunteer_activism_outlined,
            titulo: 'Todavía no ha donado',
            descripcion:
                'Cuando aporte a un fondo, aquí verá en qué punto está su dinero: retenido, '
                'en verificación o ya ejecutado con evidencia.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(historialProvider),
          child: Contenido(
            child: ListView.separated(
              itemCount: donaciones.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, i) => _TarjetaDonacion(donacion: donaciones[i]),
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

    return Card(
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
          ],
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
