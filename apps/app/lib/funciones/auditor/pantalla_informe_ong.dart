import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/descarga.dart';
import '../../comun/estados_mensuales.dart';
import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';

final informeOngProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, ongId) async {
  return ref.read(clienteApiProvider).obtener('/analitica/informe/$ongId');
});

/// CU17 · Informe de auditoria de una organizacion.
///
/// Lo primero es la integridad del libro de cada fondo: antes de mirar una
/// cifra hay que saber si la cadena de hashes esta entera. Despues, como
/// terminaron sus gastos, sus alertas y cada decision de auditoria con su
/// fundamento. Los extractos van en CSV con los hashes, para que un tercero
/// recalcule la cadena por su cuenta (RF-15).
class PantallaInformeOng extends ConsumerWidget {
  const PantallaInformeOng({super.key, required this.ongId});

  final String ongId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final informe = ref.watch(informeOngProvider(ongId));

    return Scaffold(
      appBar: AppBar(
        title: const Text('Informe de auditoría'),
        actions: [
          IconButton(
            tooltip: 'Exportar los gastos en CSV',
            icon: const Icon(Icons.download_outlined),
            onPressed: () => descargarCsv(
              context,
              ref,
              ruta: '/analitica/exportar/gastos/$ongId',
              nombre: 'gastos-$ongId.csv',
            ),
          ),
        ],
      ),
      body: informe.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos generar el informe.',
          onReintentar: () => ref.invalidate(informeOngProvider(ongId)),
        ),
        data: (datos) => _Informe(datos: datos),
      ),
    );
  }
}

class _Informe extends ConsumerWidget {
  const _Informe({required this.datos});

  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final org = datos['organizacion'] as Map<String, dynamic>;
    final fondos = (datos['fondos'] as List<dynamic>).cast<Map<String, dynamic>>();
    final gastos = (datos['gastos'] as List<dynamic>).cast<Map<String, dynamic>>();
    final alertas = (datos['alertas'] as Map<String, dynamic>?) ?? const {};
    final decisiones =
        (datos['decisionesDeAuditoria'] as List<dynamic>).cast<Map<String, dynamic>>();
    final rotas = fondos.where((f) => f['cadenaIntegra'] != true).length;

    return SingleChildScrollView(
      child: Contenido(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(org['razonSocial'] as String, style: tema.textTheme.headlineSmall),
            const SizedBox(height: 4),
            Text(
              'RUC ${org['ruc']} · ${org['estadoVerificacion']}'
              '${org['verificadaPor'] != null ? ' por ${org['verificadaPor']}' : ''}'
              ' · confianza ${org['puntajeConfianza']}',
              style: tema.textTheme.bodySmall,
            ),
            Text(
              'Generado ${Formato.fechaHora(Formato.aFecha(datos['generadoEn']))}',
              style: tema.textTheme.bodySmall?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 20),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: (rotas == 0 ? TemaApp.nivelAlto : TemaApp.nivelBajo).withValues(alpha: 0.1),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                rotas == 0
                    ? 'La cadena de hashes de los ${fondos.length} fondo(s) está íntegra.'
                    : '$rotas fondo(s) con la cadena de hashes rota: el libro fue alterado.',
                style: tema.textTheme.titleSmall?.copyWith(
                  color: rotas == 0 ? TemaApp.nivelAlto : TemaApp.nivelBajo,
                ),
              ),
            ),
            const SizedBox(height: 20),
            Text('Fondos', style: tema.textTheme.titleMedium),
            const SizedBox(height: 8),
            for (final f in fondos)
              Card(
                child: ListTile(
                  leading: Icon(
                    f['cadenaIntegra'] == true ? Icons.link : Icons.link_off,
                    color: f['cadenaIntegra'] == true ? TemaApp.nivelAlto : TemaApp.nivelBajo,
                  ),
                  title: Text('${f['nombre']} · ${f['campana']}'),
                  subtitle: Text(
                    'Recaudado ${Formato.soles(f['recaudado'] as String?)} · retenido '
                    '${Formato.soles(f['retenido'] as String?)} · ejecutado '
                    '${Formato.soles(f['ejecutado'] as String?)} · ${f['movimientos']} '
                    'movimientos',
                  ),
                  trailing: f['id'] == null
                      ? null
                      : Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            IconButton(
                              tooltip: 'Estados mensuales del fondo',
                              icon: const Icon(Icons.calendar_month_outlined),
                              onPressed: () => mostrarEstadosMensuales(
                                context,
                                fondoId: f['id'] as String,
                                nombreFondo: f['nombre'] as String,
                                conDiario: true,
                              ),
                            ),
                            IconButton(
                              tooltip: 'Exportar el libro del fondo en CSV',
                              icon: const Icon(Icons.download_outlined),
                              onPressed: () => descargarCsv(
                                context,
                                ref,
                                ruta: '/analitica/exportar/libro/${f['id']}',
                                nombre: 'libro-${f['id']}.csv',
                              ),
                            ),
                          ],
                        ),
                ),
              ),
            const SizedBox(height: 20),
            Text('Gastos', style: tema.textTheme.titleMedium),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                for (final g in gastos)
                  Chip(
                    label: Text(
                      g['estado'] == 'APROBADO'
                          ? 'APROBADO: ${g['cantidad']} · ${Formato.soles(g['monto'] as String?)}'
                          : '${g['estado']}: ${g['cantidad']}',
                    ),
                  ),
                for (final a in alertas.entries)
                  Chip(label: Text('Alertas ${a.key}: ${a.value}')),
              ],
            ),
            const SizedBox(height: 20),
            Text('Decisiones de auditoría', style: tema.textTheme.titleMedium),
            const SizedBox(height: 8),
            if (decisiones.isEmpty)
              Text('Ninguna todavía.', style: tema.textTheme.bodyMedium),
            for (final d in decisiones)
              Card(
                child: ListTile(
                  title: Text(
                    '${d['decision']} · ${d['gasto']} · ${Formato.soles(d['monto'] as String?)}'
                    '${d['esMuestreo'] == true ? ' · muestreo' : ''}',
                  ),
                  subtitle: Text(
                    '${d['comentario']}\n${d['auditor']} · '
                    '${Formato.fecha(Formato.aFecha(d['fecha']))}',
                  ),
                  isThreeLine: true,
                ),
              ),
          ],
        ),
      ),
    );
  }
}
