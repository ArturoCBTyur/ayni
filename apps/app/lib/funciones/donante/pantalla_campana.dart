import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/visor_archivo.dart';
import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/sesion.dart';
import '../../nucleo/tema.dart';
import '../ong/pantalla_fondos.dart';
import 'hoja_donar.dart';
import 'pantalla_ong.dart';

final campanaProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, slug) async {
  return ref.read(clienteApiProvider).obtener('/causas/$slug');
});

/// Por que la sesion actual no puede donar a esta causa, o null si puede.
///
/// Solo el donante aporta, y nunca a una organizacion de la que es miembro:
/// la API lo exige igual, esto es para no mostrar un boton que termina en
/// error. Mientras no se sabe si es miembro, no se ofrece donar.
String? motivoSinDonar(WidgetRef ref, String ongId) {
  final usuario = ref.watch(sesionProvider).usuario;
  if (usuario == null || !usuario.tieneRol('DONANTE')) {
    return 'Está viendo esta causa en modo consulta. Las donaciones se hacen desde una '
        'cuenta de donante.';
  }

  if (!usuario.tieneRol('ONG_ADMIN') && !usuario.tieneRol('ONG_OPERADOR')) return null;

  final misOngs = ref.watch(misOngsProvider);
  if (misOngs.isLoading) return 'Comprobando si puede donar a esta organización...';
  final esMiembro = misOngs.value?.any((o) => o['id'] == ongId) ?? false;
  return esMiembro
      ? 'Usted es miembro de esta organización, así que no puede donar a sus causas. '
          'Puede aportar a las de otras organizaciones.'
      : null;
}

/// Ficha de la campaña con sus fondos (CU02, CU03).
///
/// Cada fondo muestra los tres saldos: recaudado, retenido y ejecutado. Es
/// el corazon del modelo y conviene que el donante lo vea antes de aportar,
/// no despues: "retenido" significa que ese dinero todavia no se ha gastado
/// y no podra gastarse sin comprobante y evidencia.
class PantallaCampana extends ConsumerWidget {
  const PantallaCampana({super.key, required this.slug});

  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final campana = ref.watch(campanaProvider(slug));

    return Scaffold(
      appBar: AppBar(title: const Text('Causa')),
      body: campana.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar la causa.',
          onReintentar: () => ref.invalidate(campanaProvider(slug)),
        ),
        data: (datos) => _Detalle(datos: datos, slug: slug),
      ),
    );
  }
}

class _Detalle extends ConsumerWidget {
  const _Detalle({required this.datos, required this.slug});

  final Map<String, dynamic> datos;
  final String slug;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final ong = datos['ong'] as Map<String, dynamic>;
    final fondos = (datos['fondos'] as List<dynamic>).cast<Map<String, dynamic>>();
    final sinDonar = motivoSinDonar(ref, ong['id'] as String);

    return SingleChildScrollView(
      child: Contenido(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(datos['titulo'] as String, style: tema.textTheme.headlineSmall),
            const SizedBox(height: 8),
            Row(
              children: [
                SelloVerificada(verificada: ong['verificada'] as bool),
                const SizedBox(width: 12),
                // Quien esta detras de la causa, a un toque: su ficha publica.
                Flexible(
                  child: TextButton.icon(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(
                        builder: (_) => PantallaOng(ongId: ong['id'] as String),
                      ),
                    ),
                    icon: const Icon(Icons.domain_outlined, size: 18),
                    label: Text(ong['nombre'] as String, overflow: TextOverflow.ellipsis),
                  ),
                ),
              ],
            ),
            const SizedBox(height: 16),
            Text(datos['descripcion'] as String, style: tema.textTheme.bodyLarge),

            const SizedBox(height: 24),
            TarjetaConfianza(
              puntaje: double.tryParse(ong['puntajeConfianza'] as String? ?? '') ?? 0,
              desglose: ong['desglosePuntaje'] as Map<String, dynamic>?,
            ),

            const SizedBox(height: 32),
            Text(
              sinDonar == null ? '¿A qué destino quiere aportar?' : 'Fondos de esta causa',
              style: tema.textTheme.titleMedium,
            ),
            const SizedBox(height: 4),
            Text(
              sinDonar == null
                  ? 'Cada fondo tiene un destino concreto. Su aporte queda retenido en el que '
                      'elija hasta que la organización demuestre el gasto.'
                  : 'Cada fondo tiene un destino concreto. Lo donado queda retenido hasta '
                      'que la organización demuestre el gasto.',
              style: tema.textTheme.bodySmall?.copyWith(
                color: tema.colorScheme.onSurfaceVariant,
              ),
            ),
            if (sinDonar != null) ...[
              const SizedBox(height: 12),
              AvisoSinDonar(mensaje: sinDonar),
            ],
            const SizedBox(height: 16),

            for (final fondo in fondos) ...[
              _TarjetaFondo(
                fondo: fondo,
                onDonar: sinDonar == null ? () => _abrirDonacion(context, ref, fondo) : null,
              ),
              const SizedBox(height: 12),
            ],
          ],
        ),
      ),
    );
  }

  Future<void> _abrirDonacion(
    BuildContext context,
    WidgetRef ref,
    Map<String, dynamic> fondo,
  ) async {
    final dono = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => HojaDonar(
        fondoId: fondo['id'] as String,
        nombreFondo: fondo['nombre'] as String,
      ),
    );

    if (dono == true) ref.invalidate(campanaProvider(slug));
  }
}

/// RF-SO-01 · Puntaje de confianza con sus componentes explicados.
class TarjetaConfianza extends StatelessWidget {
  const TarjetaConfianza({super.key, required this.puntaje, required this.desglose});

  final double puntaje;

  /// Componentes del puntaje e `historialInsuficiente`, tal como los guarda la API.
  final Map<String, dynamic>? desglose;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final componentes =
        (desglose?['componentes'] as List<dynamic>?)?.cast<Map<String, dynamic>>() ?? [];

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Icon(Icons.shield_outlined, color: TemaApp.semilla),
                const SizedBox(width: 8),
                Text('Confianza de la organización', style: tema.textTheme.titleSmall),
                const Spacer(),
                Text(
                  puntaje.toStringAsFixed(0),
                  style: tema.textTheme.headlineSmall?.copyWith(
                    color: TemaApp.semilla,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                Text(' / 100', style: tema.textTheme.bodySmall),
              ],
            ),
            if (desglose?['historialInsuficiente'] == true) ...[
              const SizedBox(height: 8),
              Text(
                'Esta organización todavía tiene poco historial verificado, así que su '
                'puntaje parte de un valor neutro.',
                style: tema.textTheme.bodySmall?.copyWith(
                  color: tema.colorScheme.onSurfaceVariant,
                ),
              ),
            ],
            const SizedBox(height: 12),
            // El desglose es lo que convierte un numero en una señal
            // comprensible: sin el, el puntaje seria otra caja negra.
            for (final c in componentes)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Icon(
                      c['valor'] == null ? Icons.remove_circle_outline : Icons.check_circle_outline,
                      size: 18,
                      color: c['valor'] == null
                          ? tema.colorScheme.outline
                          : TemaApp.nivelAlto,
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(c['etiqueta'] as String, style: tema.textTheme.labelLarge),
                          Text(
                            c['detalle'] as String,
                            style: tema.textTheme.bodySmall?.copyWith(
                              color: tema.colorScheme.onSurfaceVariant,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
      ),
    );
  }
}

/// Aviso de por que no aparece el boton de donar.
class AvisoSinDonar extends StatelessWidget {
  const AvisoSinDonar({super.key, required this.mensaje});

  final String mensaje;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Container(
      width: double.infinity,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: tema.colorScheme.surfaceContainerHighest,
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 18, color: tema.colorScheme.onSurfaceVariant),
          const SizedBox(width: 10),
          Expanded(child: Text(mensaje, style: tema.textTheme.bodySmall)),
        ],
      ),
    );
  }
}

class _TarjetaFondo extends StatelessWidget {
  const _TarjetaFondo({required this.fondo, required this.onDonar});

  final Map<String, dynamic> fondo;

  /// Null cuando la sesion no puede donar: la tarjeta queda de consulta.
  final VoidCallback? onDonar;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final avance = (fondo['avance'] as num?) ?? 0;
    final verificados =
        (fondo['gastosVerificados'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(fondo['nombre'] as String, style: tema.textTheme.titleSmall),
                ),
                Chip(
                  label: Text(Formato.categoria(fondo['categoriaGasto'] as String?)),
                  visualDensity: VisualDensity.compact,
                ),
              ],
            ),
            if (fondo['descripcion'] != null) ...[
              const SizedBox(height: 6),
              Text(fondo['descripcion'] as String, style: tema.textTheme.bodySmall),
            ],
            const SizedBox(height: 14),
            BarraAvance(avance: avance),
            const SizedBox(height: 12),

            // Los tres saldos: es la transparencia que el proyecto promete.
            Wrap(
              spacing: 20,
              runSpacing: 8,
              children: [
                _Saldo(
                  etiqueta: 'Recaudado',
                  valor: Formato.soles(fondo['recaudado'] as String?),
                ),
                _Saldo(
                  etiqueta: 'Esperando evidencia',
                  valor: Formato.soles(fondo['retenido'] as String?),
                  color: TemaApp.nivelMedio,
                ),
                _Saldo(
                  etiqueta: 'Ejecutado y verificado',
                  valor: Formato.soles(fondo['ejecutado'] as String?),
                  color: TemaApp.nivelAlto,
                ),
              ],
            ),

            if (verificados.isNotEmpty) ...[
              const SizedBox(height: 8),
              _GastosVerificados(gastos: verificados),
            ],

            if (onDonar != null) ...[
              const SizedBox(height: 16),
              Align(
                alignment: Alignment.centerRight,
                child: FilledButton.icon(
                  onPressed: onDonar,
                  icon: const Icon(Icons.favorite_outline),
                  label: Text('Donar a ${fondo['nombre']}'),
                ),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

/// En que se gasto lo ejecutado del fondo, con su evidencia publicable.
///
/// "Ejecutado y verificado" es una cifra; esto es lo que la respalda, y se ve
/// antes de donar. Las fotos son siempre la version publicable: la API no
/// entrega aqui un original con rostros.
class _GastosVerificados extends StatelessWidget {
  const _GastosVerificados({required this.gastos});

  final List<Map<String, dynamic>> gastos;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return ExpansionTile(
      tilePadding: EdgeInsets.zero,
      childrenPadding: const EdgeInsets.only(bottom: 8),
      leading: Icon(Icons.verified_outlined, color: TemaApp.nivelAlto),
      title: Text(
        gastos.length == 1
            ? 'En qué se usó: 1 gasto verificado'
            : 'En qué se usó: ${gastos.length} gastos verificados',
        style: tema.textTheme.labelLarge,
      ),
      children: [
        for (final gasto in gastos)
          Padding(
            padding: const EdgeInsets.symmetric(vertical: 8),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Expanded(
                      child: Text(gasto['concepto'] as String, style: tema.textTheme.bodyMedium),
                    ),
                    Text(
                      Formato.soles(gasto['monto'] as String?),
                      style: tema.textTheme.labelLarge,
                    ),
                  ],
                ),
                Text(
                  [
                    gasto['proveedor'] as String,
                    Formato.fecha(Formato.aFecha(gasto['fechaGasto'])),
                    if (gasto['comprobante'] != null) gasto['comprobante'] as String,
                  ].join(' · '),
                  style: tema.textTheme.bodySmall?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
                if ((gasto['evidencias'] as List<dynamic>).isNotEmpty) ...[
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 8,
                    runSpacing: 8,
                    children: [
                      for (final url in (gasto['evidencias'] as List<dynamic>).cast<String>())
                        MiniaturaArchivo(
                          url: url,
                          etiqueta: 'Evidencia: ${gasto['concepto']}',
                          ancho: 120,
                          alto: 90,
                        ),
                    ],
                  ),
                ],
              ],
            ),
          ),
      ],
    );
  }
}

class _Saldo extends StatelessWidget {
  const _Saldo({required this.etiqueta, required this.valor, this.color});

  final String etiqueta;
  final String valor;
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
          valor,
          style: tema.textTheme.titleSmall?.copyWith(
            color: color,
            fontWeight: FontWeight.w600,
          ),
        ),
      ],
    );
  }
}
