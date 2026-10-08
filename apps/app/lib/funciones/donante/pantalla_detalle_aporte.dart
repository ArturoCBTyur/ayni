import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/visor_archivo.dart';
import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';
import 'pantalla_campana.dart';

final detalleAporteProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, donacionId) async {
  return ref.read(clienteApiProvider).obtener('/donaciones/$donacionId');
});

/// RF-13 · Un aporte por dentro: en que gastos se uso y con que evidencia.
///
/// El historial dice "ya ejecutado S/ 78"; aqui se ve que fue: el concepto,
/// el proveedor, el comprobante y la foto, gasto por gasto, con la parte de
/// este aporte que financio cada uno.
class PantallaDetalleAporte extends ConsumerWidget {
  const PantallaDetalleAporte({super.key, required this.donacionId});

  final String donacionId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final aporte = ref.watch(detalleAporteProvider(donacionId));

    return Scaffold(
      appBar: AppBar(title: const Text('Su aporte')),
      body: aporte.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar el aporte.',
          onReintentar: () => ref.invalidate(detalleAporteProvider(donacionId)),
        ),
        data: (datos) => _Contenido(datos: datos),
      ),
    );
  }
}

class _Contenido extends StatelessWidget {
  const _Contenido({required this.datos});

  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final estado = datos['estado'] as Map<String, dynamic>;
    final campana = datos['campana'] as Map<String, dynamic>;
    final aplicaciones =
        (datos['aplicaciones'] as List<dynamic>).cast<Map<String, dynamic>>();

    return SingleChildScrollView(
      child: Contenido(
        ancho: 760,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              (datos['fondo'] as Map<String, dynamic>)['nombre'] as String,
              style: tema.textTheme.titleLarge,
            ),
            TextButton(
              style: TextButton.styleFrom(padding: EdgeInsets.zero),
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(
                  builder: (_) => PantallaCampana(slug: campana['slug'] as String),
                ),
              ),
              child: Text('${campana['titulo']} · ${datos['ong']}'),
            ),
            const SizedBox(height: 12),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(16),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(estado['etiqueta'] as String, style: tema.textTheme.titleSmall),
                    const SizedBox(height: 4),
                    Text(estado['descripcion'] as String, style: tema.textTheme.bodySmall),
                    const Divider(height: 24),
                    FilaDato(
                      etiqueta: 'Su aporte',
                      valor: Formato.soles(datos['monto'] as String?),
                    ),
                    FilaDato(
                      etiqueta: 'Comisión de la pasarela',
                      valor: Formato.soles(datos['comision'] as String?),
                    ),
                    FilaDato(
                      etiqueta: 'Llegó al fondo',
                      valor: Formato.soles(datos['montoNeto'] as String?),
                    ),
                    FilaDato(
                      etiqueta: 'Ya gastado y verificado',
                      valor: Formato.soles(datos['montoAplicado'] as String?),
                      destacado: true,
                    ),
                    FilaDato(
                      etiqueta: 'Esperando evidencia',
                      valor: Formato.soles(datos['montoEsperandoEvidencia'] as String?),
                    ),
                    FilaDato(
                      etiqueta: 'Fecha',
                      valor: Formato.fecha(Formato.aFecha(datos['fecha'])),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text('En qué se usó', style: tema.textTheme.titleMedium),
            const SizedBox(height: 8),
            if (aplicaciones.isEmpty)
              Text(
                'Todavía en ningún gasto: su aporte sigue retenido en el fondo hasta que la '
                'organización demuestre un gasto con comprobante y foto.',
                style: tema.textTheme.bodyMedium,
              ),
            for (final a in aplicaciones) _Aplicacion(aplicacion: a),
          ],
        ),
      ),
    );
  }
}

class _Aplicacion extends StatelessWidget {
  const _Aplicacion({required this.aplicacion});

  final Map<String, dynamic> aplicacion;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final gasto = aplicacion['gasto'] as Map<String, dynamic>;
    final fotos = (gasto['evidencias'] as List<dynamic>).cast<String>();
    final aprobado = gasto['estado'] == 'APROBADO';

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
                  child: Text(gasto['concepto'] as String, style: tema.textTheme.titleSmall),
                ),
                Text(
                  'De su aporte: ${Formato.soles(aplicacion['monto'] as String?)}',
                  style: tema.textTheme.labelLarge?.copyWith(color: TemaApp.nivelAlto),
                ),
              ],
            ),
            const SizedBox(height: 4),
            Text(
              [
                gasto['proveedor'] as String,
                Formato.fecha(Formato.aFecha(gasto['fechaGasto'])),
                'total del gasto ${Formato.soles(gasto['total'] as String?)}',
                if (gasto['comprobante'] != null) gasto['comprobante'] as String,
              ].join(' · '),
              style: tema.textTheme.bodySmall?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
            if (!aprobado) ...[
              const SizedBox(height: 8),
              Text(
                // Un reporte del donante devuelve el gasto a revision (RF-SO-02).
                'Este gasto volvió a revisión de auditoría.',
                style: tema.textTheme.bodySmall?.copyWith(color: TemaApp.nivelMedio),
              ),
            ],
            if (fotos.isNotEmpty) ...[
              const SizedBox(height: 12),
              Wrap(
                spacing: 10,
                runSpacing: 10,
                children: [
                  for (final url in fotos)
                    MiniaturaArchivo(
                      url: url,
                      etiqueta: 'Evidencia del gasto',
                      ancho: 160,
                      alto: 120,
                    ),
                ],
              ),
            ],
          ],
        ),
      ),
    );
  }
}
