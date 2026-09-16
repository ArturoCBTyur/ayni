import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/tema.dart';

/// Consulta el estado del backend y de PostgreSQL.
final saludProvider = FutureProvider<Map<String, dynamic>>((ref) async {
  return ref.read(clienteApiProvider).obtener('/salud');
});

/// Pantalla de diagnostico de la Fase 0.
///
/// Es lo primero que se construye a proposito: verifica de punta a punta que
/// Flutter Web, el API y PostgreSQL se hablan, antes de invertir trabajo en
/// pantallas de dominio.
class PantallaSalud extends ConsumerWidget {
  const PantallaSalud({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final salud = ref.watch(saludProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('Estado del sistema'),
        actions: [
          IconButton(
            tooltip: 'Volver a consultar',
            icon: const Icon(Icons.refresh),
            onPressed: () => ref.invalidate(saludProvider),
          ),
        ],
      ),
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 560),
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: salud.when(
              loading: () => const Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  CircularProgressIndicator(),
                  SizedBox(height: 16),
                  Text('Consultando el servicio...'),
                ],
              ),
              error: (e, _) => _TarjetaError(
                mensaje: e is ErrorApi ? e.mensaje : e.toString(),
                onReintentar: () => ref.invalidate(saludProvider),
              ),
              data: (datos) => _TarjetaEstado(datos: datos),
            ),
          ),
        ),
      ),
    );
  }
}

class _TarjetaEstado extends StatelessWidget {
  const _TarjetaEstado({required this.datos});

  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context) {
    final bd = (datos['baseDatos'] as Map?)?.cast<String, dynamic>() ?? {};

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.check_circle, color: TemaApp.nivelAlto, size: 32),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    datos['servicio']?.toString() ?? 'Servicio',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 20),
            _Fila(etiqueta: 'Version', valor: datos['version']?.toString() ?? '-'),
            _Fila(
              etiqueta: 'Motor de verificacion',
              valor: datos['motorVerificacion']?.toString() ?? '-',
            ),
            const Divider(height: 28),
            _Fila(etiqueta: 'Base de datos', valor: bd['version']?.toString() ?? '-'),
            _Fila(etiqueta: 'Tablas', valor: bd['tablas']?.toString() ?? '-'),
            _Fila(etiqueta: 'Latencia', valor: '${bd['latenciaMs'] ?? '-'} ms'),
          ],
        ),
      ),
    );
  }
}

class _Fila extends StatelessWidget {
  const _Fila({required this.etiqueta, required this.valor});

  final String etiqueta;
  final String valor;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 170,
            child: Text(
              etiqueta,
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: Theme.of(context).colorScheme.onSurfaceVariant,
                  ),
            ),
          ),
          Expanded(child: SelectableText(valor)),
        ],
      ),
    );
  }
}

class _TarjetaError extends StatelessWidget {
  const _TarjetaError({required this.mensaje, required this.onReintentar});

  final String mensaje;
  final VoidCallback onReintentar;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.error_outline, color: TemaApp.nivelBajo, size: 32),
                const SizedBox(width: 12),
                Expanded(
                  child: Text(
                    'No pudimos conectarnos',
                    style: Theme.of(context).textTheme.titleLarge,
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(mensaje),
            const SizedBox(height: 8),
            Text(
              'Verifique que el API este corriendo (npm run dev en apps/api) '
              'y que PostgreSQL acepte conexiones en el puerto 5433.',
              style: Theme.of(context).textTheme.bodySmall,
            ),
            const SizedBox(height: 20),
            FilledButton.icon(
              onPressed: onReintentar,
              icon: const Icon(Icons.refresh),
              label: const Text('Reintentar'),
            ),
          ],
        ),
      ),
    );
  }
}
