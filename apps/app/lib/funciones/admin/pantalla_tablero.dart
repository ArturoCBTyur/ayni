import 'package:fl_chart/fl_chart.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/descarga.dart';
import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/sesion.dart';
import '../../nucleo/tema.dart';

final tableroProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return ref.read(clienteApiProvider).obtener('/analitica/tablero');
});

final conciliacionProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return ref.read(clienteApiProvider).obtener('/analitica/conciliacion');
});

/// CU20 · Tablero de indicadores para el administrador.
///
/// El orden de la pantalla es el orden de las preguntas: primero si el libro
/// cuadra, porque si no cuadra ningun otro numero merece confianza; despues el
/// movimiento del dinero; al final los indicadores de la Tabla 3 por
/// disciplina.
class PantallaTablero extends ConsumerWidget {
  const PantallaTablero({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tablero = ref.watch(tableroProvider);

    return RefreshIndicator(
      onRefresh: () async {
        ref.invalidate(tableroProvider);
        ref.invalidate(conciliacionProvider);
        await ref.read(tableroProvider.future);
      },
      child: tablero.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar el tablero.',
          onReintentar: () => ref.invalidate(tableroProvider),
        ),
        data: (datos) {
          final resumen = datos['resumen'] as Map<String, dynamic>;
          final indicadores =
              (datos['indicadores'] as List<dynamic>).cast<Map<String, dynamic>>();

          return ListView(
            children: [
              Contenido(
                ancho: 1000,
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const _Conciliacion(),
                    const SizedBox(height: 28),
                    _Resumen(resumen: resumen),
                    const SizedBox(height: 28),
                    const _FlujoDelDinero(),
                    const SizedBox(height: 28),
                    _Indicadores(indicadores: indicadores, datos: datos),
                  ],
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

/// Estado de la conciliacion, arriba y sin rodeos.
///
/// Es lo primero porque es lo unico que puede invalidar todo lo demas: un
/// tablero de indicadores calculado sobre un libro descuadrado es una
/// presentacion, no una medicion.
class _Conciliacion extends ConsumerWidget {
  const _Conciliacion();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final conciliacion = ref.watch(conciliacionProvider);
    final esAdmin = ref.watch(sesionProvider).usuario?.tieneRol('ADMIN') ?? false;

    return conciliacion.when(
      loading: () => const Card(
        child: ListTile(
          leading: SizedBox(
            width: 24,
            height: 24,
            child: CircularProgressIndicator(strokeWidth: 2),
          ),
          title: Text('Conciliando el libro contable…'),
        ),
      ),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos conciliar el libro.',
        onReintentar: () => ref.invalidate(conciliacionProvider),
      ),
      data: (r) {
        final cuadra = r['cuadra'] == true;
        final descuadres =
            (r['descuadres'] as List<dynamic>).cast<Map<String, dynamic>>();
        final cadenas = r['cadenas'] as Map<String, dynamic>;
        final rotas = (cadenas['rotas'] as num).toInt();
        final fondos = (cadenas['fondos'] as num).toInt();

        final color = cuadra ? TemaApp.nivelAlto : TemaApp.nivelBajo;

        return Card(
          color: color.withValues(alpha: 0.08),
          child: Padding(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    Icon(
                      cuadra ? Icons.verified_outlined : Icons.report_problem_outlined,
                      color: color,
                      size: 32,
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            cuadra
                                ? 'El libro contable cuadra'
                                : 'El libro contable no cuadra',
                            style: tema.textTheme.titleLarge?.copyWith(
                              color: color,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          Text(
                            cuadra
                                ? 'Cada sol recaudado está respaldado por su asiento, y ninguna '
                                    'cadena de hashes fue alterada.'
                                : 'Hay diferencias entre fuentes que se escriben por caminos '
                                    'distintos. El detalle está abajo.',
                            style: tema.textTheme.bodyMedium,
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Wrap(
                  spacing: 24,
                  runSpacing: 8,
                  children: [
                    _Dato(
                      etiqueta: 'Cadenas de hashes íntegras',
                      valor: '${fondos - rotas} de $fondos',
                      alerta: rotas > 0,
                    ),
                    _Dato(
                      etiqueta: 'Diferencias encontradas',
                      valor: '${descuadres.length}',
                      alerta: descuadres.isNotEmpty,
                    ),
                    _Dato(
                      etiqueta: 'Verificado',
                      valor: Formato.fechaHora(Formato.aFecha(r['fecha'])),
                    ),
                  ],
                ),
                if (descuadres.isNotEmpty) ...[
                  const Divider(height: 28),
                  for (final d in descuadres) _FilaDescuadre(descuadre: d),
                ],
                if (esAdmin) ...[
                  const SizedBox(height: 12),
                  Wrap(
                    alignment: WrapAlignment.end,
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      TextButton.icon(
                        onPressed: () => descargarCsv(
                          context,
                          ref,
                          ruta: '/analitica/exportar/conciliacion',
                          nombre: 'conciliacion.csv',
                        ),
                        icon: const Icon(Icons.download_outlined),
                        label: const Text('Exportar CSV'),
                      ),
                      TextButton.icon(
                        onPressed: () => _muestreo(context, ref),
                        icon: const Icon(Icons.casino_outlined),
                        label: const Text('Seleccionar muestreo'),
                      ),
                      TextButton.icon(
                        onPressed: () => ref.invalidate(conciliacionProvider),
                        icon: const Icon(Icons.refresh),
                        label: const Text('Conciliar de nuevo'),
                      ),
                    ],
                  ),
                ],
              ],
            ),
          ),
        );
      },
    );
  }
}

/// RN-08 · Elige al azar casos aprobados automaticamente con nivel ALTO
/// para que un auditor los revise: es lo que mide los falsos aprobados.
Future<void> _muestreo(BuildContext context, WidgetRef ref) async {
  final mensajero = ScaffoldMessenger.of(context);
  try {
    final r = await ref.read(clienteApiProvider).enviar('/auditoria/muestreo');
    final n = (r['seleccionados'] as num?)?.toInt() ?? 0;
    mensajero.showSnackBar(
      SnackBar(
        content: Text(n == 0
            ? 'Esta vez el sorteo no eligió ningún caso.'
            : '$n caso(s) aprobados pasan a la bandeja de auditoría por muestreo.'),
      ),
    );
  } on ErrorApi catch (e) {
    mensajero.showSnackBar(SnackBar(content: Text(e.mensaje)));
  }
}

class _FilaDescuadre extends StatelessWidget {
  const _FilaDescuadre({required this.descuadre});

  final Map<String, dynamic> descuadre;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final critico = descuadre['severidad'] == 'CRITICO';
    final diferencia = descuadre['diferencia'] as String?;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 8),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(
            critico ? Icons.error_outline : Icons.warning_amber_outlined,
            size: 20,
            color: critico ? TemaApp.nivelBajo : TemaApp.nivelMedio,
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(descuadre['descripcion'] as String, style: tema.textTheme.bodyMedium),
                if (diferencia != null)
                  Text(
                    'Diferencia: ${Formato.soles(diferencia)}',
                    style: tema.textTheme.labelMedium?.copyWith(
                      color: critico ? TemaApp.nivelBajo : TemaApp.nivelMedio,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

/// Cifras generales de la plataforma.
class _Resumen extends StatelessWidget {
  const _Resumen({required this.resumen});

  final Map<String, dynamic> resumen;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final donaciones = resumen['donaciones'] as Map<String, dynamic>;
    final gastos = (resumen['gastos'] as Map<String, dynamic>);

    final tarjetas = <({String etiqueta, String valor, IconData icono})>[
      (
        etiqueta: 'Recaudado',
        valor: Formato.soles(donaciones['total'] as String?),
        icono: Icons.volunteer_activism_outlined,
      ),
      (
        etiqueta: 'Donaciones',
        valor: '${donaciones['cantidad']}',
        icono: Icons.favorite_outline,
      ),
      (
        etiqueta: 'Donantes',
        valor: '${resumen['donantes']}',
        icono: Icons.people_outline,
      ),
      (
        etiqueta: 'ONG verificadas',
        valor: '${resumen['ongsVerificadas']}',
        icono: Icons.verified_user_outlined,
      ),
      (
        etiqueta: 'Campañas activas',
        valor: '${resumen['campanasActivas']}',
        icono: Icons.campaign_outlined,
      ),
      (
        etiqueta: 'Narrativas enviadas',
        valor: '${resumen['narrativasEnviadas']}',
        icono: Icons.mark_email_read_outlined,
      ),
    ];

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Resumen', style: tema.textTheme.titleLarge),
        const SizedBox(height: 12),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            for (final t in tarjetas)
              SizedBox(
                width: 170,
                child: Card(
                  margin: EdgeInsets.zero,
                  child: Padding(
                    padding: const EdgeInsets.all(14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(t.icono, size: 20, color: tema.colorScheme.primary),
                        const SizedBox(height: 8),
                        Text(
                          t.valor,
                          style: tema.textTheme.headlineSmall?.copyWith(
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        Text(
                          t.etiqueta,
                          style: tema.textTheme.bodySmall?.copyWith(
                            color: tema.colorScheme.onSurfaceVariant,
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
          ],
        ),
        if (gastos.isNotEmpty) ...[
          const SizedBox(height: 14),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final e in gastos.entries)
                Chip(
                  avatar: Icon(_iconoEstadoGasto(e.key), size: 18),
                  label: Text('${_estadoGasto(e.key)}: ${e.value}'),
                ),
            ],
          ),
        ],
      ],
    );
  }
}

String _estadoGasto(String codigo) => switch (codigo) {
      'BORRADOR' => 'Borradores',
      'EN_ANALISIS' => 'En análisis',
      'EN_REVISION' => 'En revisión',
      'OBSERVADO' => 'Observados',
      'APROBADO' => 'Aprobados',
      'RECHAZADO' => 'Rechazados',
      _ => codigo,
    };

IconData _iconoEstadoGasto(String codigo) => switch (codigo) {
      'EN_ANALISIS' => Icons.hourglass_empty,
      'EN_REVISION' => Icons.gavel_outlined,
      'OBSERVADO' => Icons.flag_outlined,
      'APROBADO' => Icons.check_circle_outline,
      'RECHAZADO' => Icons.cancel_outlined,
      _ => Icons.edit_outlined,
    };

/// Movimiento del dinero: lo que entro, lo que espera evidencia y lo ejecutado.
///
/// Es el grafico que justifica el proyecto. "Retenido" es dinero que ya se
/// dono y que todavia no se puede gastar porque nadie demostro en que; verlo
/// al lado de lo ejecutado dice, de un vistazo, cuanta plata esta esperando
/// que alguien rinda cuentas.
class _FlujoDelDinero extends ConsumerWidget {
  const _FlujoDelDinero();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final conciliacion = ref.watch(conciliacionProvider);

    return conciliacion.maybeWhen(
      data: (r) {
        final totales = r['totales'] as Map<String, dynamic>;

        final barras = <({String etiqueta, double monto, Color color})>[
          (
            etiqueta: 'Ingresos',
            monto: _aNumero(totales['ingresosLibro']),
            color: tema.colorScheme.primary,
          ),
          (
            etiqueta: 'Comisiones',
            monto: _aNumero(totales['comisiones']),
            color: tema.colorScheme.outline,
          ),
          (
            etiqueta: 'Retenido',
            monto: _aNumero(totales['retenido']),
            color: TemaApp.nivelMedio,
          ),
          (
            etiqueta: 'Ejecutado',
            monto: _aNumero(totales['ejecutado']),
            color: TemaApp.nivelAlto,
          ),
        ];

        final maximo = barras.map((b) => b.monto).fold<double>(0, (a, b) => a > b ? a : b);

        return Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('Movimiento del dinero', style: tema.textTheme.titleLarge),
            Text(
              'Retenido es lo donado que todavía espera evidencia del gasto.',
              style: tema.textTheme.bodySmall?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
            const SizedBox(height: 16),
            if (maximo == 0)
              Text(
                'Todavía no hay movimientos en el libro.',
                style: tema.textTheme.bodyMedium,
              )
            else ...[
              // RNF-15 · El lienzo de Flutter Web no expone el grafico al
              // lector de pantalla (ver ADR-0001), asi que el grafico se
              // etiqueta completo y ademas las mismas cifras se repiten en
              // texto abajo. El grafico ayuda a quien ve; la tabla es la que
              // informa a todos.
              Semantics(
                label: barras
                    .map((b) => '${b.etiqueta}: ${Formato.soles(b.monto.toStringAsFixed(2))}')
                    .join('. '),
                child: ExcludeSemantics(
                  child: SizedBox(
                    height: 200,
                    child: BarChart(
                      BarChartData(
                        maxY: maximo * 1.15,
                        barGroups: [
                          for (var i = 0; i < barras.length; i++)
                            BarChartGroupData(
                              x: i,
                              barRods: [
                                BarChartRodData(
                                  toY: barras[i].monto,
                                  color: barras[i].color,
                                  width: 36,
                                  borderRadius: const BorderRadius.vertical(
                                    top: Radius.circular(6),
                                  ),
                                ),
                              ],
                            ),
                        ],
                        gridData: const FlGridData(show: false),
                        borderData: FlBorderData(show: false),
                        barTouchData: BarTouchData(
                          touchTooltipData: BarTouchTooltipData(
                            getTooltipItem: (grupo, _, rod, _) => BarTooltipItem(
                              '${barras[grupo.x].etiqueta}\n'
                              '${Formato.soles(rod.toY.toStringAsFixed(2))}',
                              tema.textTheme.bodySmall ?? const TextStyle(),
                            ),
                          ),
                        ),
                        titlesData: FlTitlesData(
                          leftTitles: const AxisTitles(),
                          rightTitles: const AxisTitles(),
                          topTitles: const AxisTitles(),
                          bottomTitles: AxisTitles(
                            sideTitles: SideTitles(
                              showTitles: true,
                              reservedSize: 28,
                              getTitlesWidget: (valor, meta) {
                                final i = valor.toInt();
                                if (i < 0 || i >= barras.length) {
                                  return const SizedBox.shrink();
                                }
                                return Padding(
                                  padding: const EdgeInsets.only(top: 6),
                                  child: Text(
                                    barras[i].etiqueta,
                                    style: tema.textTheme.labelSmall,
                                  ),
                                );
                              },
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(height: 12),
              for (final b in barras)
                FilaDato(
                  etiqueta: b.etiqueta,
                  valor: Formato.soles(b.monto.toStringAsFixed(2)),
                ),
            ],
          ],
        );
      },
      orElse: () => const SizedBox.shrink(),
    );
  }
}

/// Indicadores de la Tabla 3, agrupados por disciplina.
class _Indicadores extends StatelessWidget {
  const _Indicadores({required this.indicadores, required this.datos});

  final List<Map<String, dynamic>> indicadores;
  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    final porDisciplina = <String, List<Map<String, dynamic>>>{};
    for (final i in indicadores) {
      porDisciplina.putIfAbsent(i['disciplina'] as String, () => []).add(i);
    }

    final medidos = (datos['medidos'] as num).toInt();
    final total = (datos['total'] as num).toInt();

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text('Indicadores del proyecto', style: tema.textTheme.titleLarge),
        Text(
          '$medidos de $total se pueden medir con lo que el sistema registra hoy. '
          'Los demás se muestran igual, con el motivo.',
          style: tema.textTheme.bodySmall?.copyWith(
            color: tema.colorScheme.onSurfaceVariant,
          ),
        ),
        const SizedBox(height: 12),
        for (final entrada in porDisciplina.entries)
          Card(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    entrada.key,
                    style: tema.textTheme.titleSmall?.copyWith(
                      color: tema.colorScheme.primary,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  for (final i in entrada.value) _FilaIndicador(indicador: i),
                ],
              ),
            ),
          ),
      ],
    );
  }
}

class _FilaIndicador extends StatelessWidget {
  const _FilaIndicador({required this.indicador});

  final Map<String, dynamic> indicador;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final valor = indicador['valor'];
    final noMedible = indicador['noMedible'] as String?;
    final cumple = indicador['cumple'] as bool?;
    final unidad = indicador['unidad'] as String;

    final Color color;
    final IconData icono;
    if (valor == null) {
      color = tema.colorScheme.onSurfaceVariant;
      icono = Icons.remove_circle_outline;
    } else if (cumple == true) {
      color = TemaApp.nivelAlto;
      icono = Icons.check_circle_outline;
    } else if (cumple == false) {
      color = TemaApp.nivelBajo;
      icono = Icons.cancel_outlined;
    } else {
      color = tema.colorScheme.onSurfaceVariant;
      icono = Icons.circle_outlined;
    }

    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Padding(
            padding: const EdgeInsets.only(top: 2),
            child: Icon(icono, size: 20, color: color),
          ),
          const SizedBox(width: 10),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(indicador['nombre'] as String, style: tema.textTheme.bodyMedium),
                Text(
                  'Meta: ${indicador['meta']}  ·  ${indicador['codigo']}',
                  style: tema.textTheme.labelSmall?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
                // El motivo se muestra con el mismo peso que un valor. Un
                // indicador sin medicion no es un hueco del tablero: es
                // informacion sobre el alcance de esta version.
                if (noMedible != null)
                  Padding(
                    padding: const EdgeInsets.only(top: 4),
                    child: Text(
                      noMedible,
                      style: tema.textTheme.bodySmall?.copyWith(
                        color: tema.colorScheme.onSurfaceVariant,
                        fontStyle: FontStyle.italic,
                      ),
                    ),
                  ),
              ],
            ),
          ),
          const SizedBox(width: 12),
          Text(
            valor == null ? 'Sin medir' : '$valor $unidad',
            style: tema.textTheme.titleMedium?.copyWith(
              color: color,
              fontWeight: valor == null ? FontWeight.w400 : FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

class _Dato extends StatelessWidget {
  const _Dato({required this.etiqueta, required this.valor, this.alerta = false});

  final String etiqueta;
  final String valor;
  final bool alerta;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          etiqueta,
          style: tema.textTheme.labelSmall?.copyWith(
            color: tema.colorScheme.onSurfaceVariant,
          ),
        ),
        Text(
          valor,
          style: tema.textTheme.titleMedium?.copyWith(
            fontWeight: FontWeight.w700,
            color: alerta ? TemaApp.nivelBajo : null,
          ),
        ),
      ],
    );
  }
}

/// Los importes llegan como cadena con dos decimales para no perder precision
/// en el transporte; el grafico necesita un double y solo para dibujar.
double _aNumero(dynamic valor) => double.tryParse('$valor') ?? 0;
