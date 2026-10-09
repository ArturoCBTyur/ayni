import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../nucleo/api/cliente_api.dart';
import '../nucleo/formato.dart';
import '../nucleo/tema.dart';
import 'descarga.dart';
import 'widgets.dart';

const _mimeXlsx = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

final periodosFondoProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, fondoId) async {
  return ref.read(clienteApiProvider).obtener('/analitica/estados/fondos/$fondoId/periodos');
});

final estadoMensualProvider = FutureProvider.autoDispose
    .family<Map<String, dynamic>, ({String fondoId, String periodo})>((ref, clave) async {
  return ref.read(clienteApiProvider).obtener(
    '/analitica/estados/fondos/${clave.fondoId}',
    consulta: {'periodo': clave.periodo},
  );
});

/// RF-CF-08 · Estados mensuales de un fondo, para la ONG y para la auditoria.
///
/// `conDiario` agrega el libro diario en cuentas del PCGE, que exporta la
/// auditoria; la ONG ve sus estados pero no ese extracto.
Future<void> mostrarEstadosMensuales(
  BuildContext context, {
  required String fondoId,
  required String nombreFondo,
  bool conDiario = false,
}) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => FractionallySizedBox(
      heightFactor: 0.85,
      child: HojaEstadosMensuales(
        fondoId: fondoId,
        nombreFondo: nombreFondo,
        conDiario: conDiario,
      ),
    ),
  );
}

class HojaEstadosMensuales extends ConsumerWidget {
  const HojaEstadosMensuales({
    super.key,
    required this.fondoId,
    required this.nombreFondo,
    this.conDiario = false,
  });

  final String fondoId;
  final String nombreFondo;
  final bool conDiario;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final periodos = ref.watch(periodosFondoProvider(fondoId));

    return periodos.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar los meses del fondo.',
        onReintentar: () => ref.invalidate(periodosFondoProvider(fondoId)),
      ),
      data: (datos) {
        final lista = (datos['periodos'] as List<dynamic>).cast<Map<String, dynamic>>();
        final ongId = (datos['fondo'] as Map<String, dynamic>?)?['ongId'] as String?;

        return ListView(
          padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
          children: [
            Text('Estados mensuales', style: tema.textTheme.titleLarge),
            Text(nombreFondo, style: tema.textTheme.bodyMedium),
            const SizedBox(height: 8),
            Text(
              'Cada mes se cierra el día 1 del siguiente. Desde entonces sus cifras ya no '
              'cambian y llevan un hash que cualquiera puede recalcular.',
              style: tema.textTheme.bodySmall?.copyWith(color: tema.colorScheme.onSurfaceVariant),
            ),
            if (conDiario) ...[
              const SizedBox(height: 12),
              Align(
                alignment: Alignment.centerLeft,
                child: OutlinedButton.icon(
                  icon: const Icon(Icons.table_chart_outlined),
                  label: const Text('Libro diario en cuentas PCGE (CSV)'),
                  onPressed: () => descargarCsv(
                    context,
                    ref,
                    ruta: '/analitica/exportar/diario/$fondoId',
                    nombre: 'diario-pcge-$fondoId.csv',
                  ),
                ),
              ),
            ],
            const SizedBox(height: 12),
            for (final p in lista) _FilaPeriodo(fondoId: fondoId, ongId: ongId, periodo: p),
          ],
        );
      },
    );
  }
}

String _mayuscula(String texto) =>
    texto.isEmpty ? texto : '${texto[0].toUpperCase()}${texto.substring(1)}';

class _FilaPeriodo extends ConsumerWidget {
  const _FilaPeriodo({required this.fondoId, required this.ongId, required this.periodo});

  final String fondoId;
  final String? ongId;
  final Map<String, dynamic> periodo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final codigo = periodo['codigo'] as String;
    final cerrado = periodo['cerrado'] == true;
    final enCurso = periodo['enCurso'] == true;
    final hash = periodo['hash'] as String?;

    final (icono, color, estado) = cerrado
        ? (
            Icons.lock_outline,
            TemaApp.nivelAlto,
            'Cerrado el ${Formato.fecha(Formato.aFecha(periodo['cerradoEn']))}'
                '${hash != null ? ' · hash ${hash.substring(0, 12)}…' : ''}',
          )
        : enCurso
            ? (Icons.pending_outlined, TemaApp.nivelMedio, 'En curso: las cifras pueden cambiar')
            : (Icons.lock_open_outlined, TemaApp.nivelMedio, 'Terminado, todavía sin cierre');

    Future<void> descargar(String formato, String tipo, String extension) => descargarArchivo(
          context,
          ref,
          ruta: '/analitica/estados/fondos/$fondoId',
          consulta: {'periodo': codigo, 'formato': formato},
          nombre: 'estado-$codigo.$extension',
          tipo: tipo,
        );

    Future<void> ple(String libro) => descargarArchivo(
          context,
          ref,
          ruta: '/analitica/ple/ongs/$ongId',
          consulta: {'periodo': codigo, 'libro': libro},
          nombre: 'BORRADOR-ple-$libro-$codigo.txt',
          tipo: 'text/plain;charset=utf-8',
        );

    return Card(
      child: ExpansionTile(
        leading: Icon(icono, color: color),
        title: Text(_mayuscula(periodo['nombre'] as String)),
        subtitle: Text(estado),
        childrenPadding: const EdgeInsets.fromLTRB(16, 0, 16, 16),
        children: [
          _ResumenDelMes(fondoId: fondoId, periodo: codigo),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              FilledButton.tonalIcon(
                icon: const Icon(Icons.grid_on_outlined),
                label: const Text('Excel'),
                onPressed: () => descargar('xlsx', _mimeXlsx, 'xlsx'),
              ),
              FilledButton.tonalIcon(
                icon: const Icon(Icons.picture_as_pdf_outlined),
                label: const Text('PDF'),
                onPressed: () => descargar('pdf', 'application/pdf', 'pdf'),
              ),
              // El PLE es de la ONG y no del fondo, y todavia no lo valido un
              // contador: el nombre lo dice para que nadie lo presente asi.
              if (ongId != null) ...[
                OutlinedButton(
                  onPressed: () => ple('diario'),
                  child: const Text('PLE diario (borrador)'),
                ),
                OutlinedButton(
                  onPressed: () => ple('mayor'),
                  child: const Text('PLE mayor (borrador)'),
                ),
              ],
            ],
          ),
        ],
      ),
    );
  }
}

/// Las cifras del mes, que se piden solo al abrirlo.
class _ResumenDelMes extends ConsumerWidget {
  const _ResumenDelMes({required this.fondoId, required this.periodo});

  final String fondoId;
  final String periodo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final clave = (fondoId: fondoId, periodo: periodo);

    return ref.watch(estadoMensualProvider(clave)).when(
          loading: () => const Padding(
            padding: EdgeInsets.all(12),
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (e, _) => TarjetaError(
            mensaje: e is ErrorApi ? e.mensaje : 'No pudimos armar el estado de este mes.',
            onReintentar: () => ref.invalidate(estadoMensualProvider(clave)),
          ),
          data: (datos) {
            final estado = datos['estado'] as Map<String, dynamic>;
            final actividades = estado['actividades'] as Map<String, dynamic>;
            final retenido = estado['retenido'] as Map<String, dynamic>;
            final cierre = datos['cierre'] as Map<String, dynamic>?;
            final cadena = datos['cadena'] as Map<String, dynamic>?;

            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Lo primero que hay que saber de un mes cerrado: si el libro
                // todavia dice lo mismo que el cierre.
                if (cierre != null && cierre['vigente'] == false)
                  _Aviso(
                    'El libro ya no da estas cifras: se asentó en este mes después de cerrarlo. '
                    'El cierre conserva lo que había; la diferencia es lo que hay que revisar.',
                  ),
                if (cadena != null && cadena['integra'] == false)
                  _Aviso('La cadena de hashes del fondo está rota: el libro fue alterado.'),
                FilaDato(
                  etiqueta: 'Donaciones brutas',
                  valor: Formato.soles(actividades['donacionesBrutas'] as String?),
                ),
                FilaDato(
                  etiqueta: 'Comisiones',
                  valor: Formato.soles(actividades['comisiones'] as String?),
                ),
                FilaDato(
                  etiqueta: 'Liberado neto',
                  valor: Formato.soles(actividades['liberadoNeto'] as String?),
                ),
                FilaDato(
                  etiqueta: 'Por justificar al cierre',
                  valor: Formato.soles(retenido['final'] as String?),
                  destacado: true,
                ),
                Text(
                  'Presentado según la propuesta contable del ADR-0007, todavía sin firma de '
                  'Contabilidad.',
                  style: tema.textTheme.labelSmall?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            );
          },
        );
  }
}

class _Aviso extends StatelessWidget {
  const _Aviso(this.texto);

  final String texto;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(10),
      decoration: BoxDecoration(
        color: TemaApp.nivelBajo.withValues(alpha: 0.1),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Text(
        texto,
        style: Theme.of(context).textTheme.bodySmall?.copyWith(color: TemaApp.nivelBajo),
      ),
    );
  }
}
