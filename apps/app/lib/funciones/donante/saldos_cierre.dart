import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/descarga.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';

/// Saldos del donante en causas cerradas (RF-CF-11): los que esperan su
/// eleccion y los que ya tienen destino.
final saldosCierreProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  return ref.read(clienteApiProvider).obtenerLista('/remanentes');
});

final destinosSaldoProvider =
    FutureProvider.autoDispose.family<List<Map<String, dynamic>>, String>((ref, id) async {
  return ref.read(clienteApiProvider).obtenerLista('/remanentes/$id/destinos');
});

/// El informe de cierre de una causa, en PDF. Es publico: lo abre el QR.
Future<void> descargarInformeCierre(BuildContext context, WidgetRef ref, String informeId) =>
    descargarArchivo(
      context,
      ref,
      ruta: '/publico/informes/$informeId/pdf',
      nombre: 'informe-cierre-$informeId.pdf',
      tipo: 'application/pdf',
    );

/// En el inicio del donante: lo que tiene que decidir, primero.
class SaldosDeCausasCerradas extends ConsumerWidget {
  const SaldosDeCausasCerradas({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return ref.watch(saldosCierreProvider).maybeWhen(
          data: (saldos) {
            if (saldos.isEmpty) return const SizedBox.shrink();
            return Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [for (final s in saldos) _TarjetaSaldo(saldo: s)],
            );
          },
          orElse: () => const SizedBox.shrink(),
        );
  }
}

class _TarjetaSaldo extends ConsumerWidget {
  const _TarjetaSaldo({required this.saldo});

  final Map<String, dynamic> saldo;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final puedeElegir = saldo['puedeElegir'] == true;
    final destino = saldo['destino'] as String?;
    final fondoDestino = saldo['fondoDestino'] as Map<String, dynamic>?;
    final resuelto = saldo['resueltoEn'] != null;
    final informeId = saldo['informeId'] as String?;
    final monto = Formato.soles(saldo['monto'] as String?);

    final String estado;
    if (resuelto) {
      estado = destino == 'REASIGNACION'
          ? 'Pasó a ${fondoDestino?['nombre']}.'
          : saldo['elegidoPor'] == 'DONANTE'
              ? 'Se le devolvió, como eligió.'
              : 'Se le devolvió: no eligió a tiempo o el destino ya no recibía aportes.';
    } else if (destino == null) {
      estado = 'Elija qué hacer antes del '
          '${Formato.fecha(Formato.aFecha(saldo['venceEleccionEn']))}. '
          'Si no elige, se le devuelve.';
    } else {
      estado = destino == 'REASIGNACION'
          ? 'Eligió pasarlo a ${fondoDestino?['nombre']}. Puede cambiarlo hasta el '
              '${Formato.fecha(Formato.aFecha(saldo['venceEleccionEn']))}.'
          : 'Eligió que se le devuelva. Puede cambiarlo hasta el '
              '${Formato.fecha(Formato.aFecha(saldo['venceEleccionEn']))}.';
    }

    return Card(
      color: (puedeElegir && destino == null ? TemaApp.nivelMedio : TemaApp.semilla)
          .withValues(alpha: 0.06),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              '${saldo['fondo']} cerró: le quedan $monto sin usar',
              style: tema.textTheme.titleSmall,
            ),
            Text('${saldo['ong']} · ${saldo['campana']}', style: tema.textTheme.bodySmall),
            const SizedBox(height: 6),
            Text(estado),
            const SizedBox(height: 8),
            Wrap(
              spacing: 8,
              children: [
                if (puedeElegir)
                  FilledButton(
                    onPressed: () => Navigator.of(context).push(
                      MaterialPageRoute<void>(builder: (_) => PantallaElegirDestino(saldo: saldo)),
                    ),
                    child: Text(destino == null ? 'Elegir' : 'Cambiar'),
                  ),
                if (informeId != null)
                  OutlinedButton.icon(
                    icon: const Icon(Icons.picture_as_pdf_outlined),
                    label: const Text('Informe de cierre'),
                    onPressed: () => descargarInformeCierre(context, ref, informeId),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}

/// RF-CF-11 · Devolucion o traslado a otra causa, con la consecuencia de
/// cada opcion dicha antes de elegirla.
class PantallaElegirDestino extends ConsumerStatefulWidget {
  const PantallaElegirDestino({super.key, required this.saldo});

  final Map<String, dynamic> saldo;

  @override
  ConsumerState<PantallaElegirDestino> createState() => _PantallaElegirDestinoState();
}

class _PantallaElegirDestinoState extends ConsumerState<PantallaElegirDestino> {
  late String? _destino = widget.saldo['destino'] as String?;
  late String? _fondo = (widget.saldo['fondoDestino'] as Map<String, dynamic>?)?['id'] as String?;
  var _enviando = false;

  bool get _completo => _destino == 'DEVOLUCION' || (_destino == 'REASIGNACION' && _fondo != null);

  Future<void> _confirmar() async {
    setState(() => _enviando = true);
    final mensajero = ScaffoldMessenger.of(context);
    final navegador = Navigator.of(context);
    try {
      await ref.read(clienteApiProvider).enviar(
        '/remanentes/${widget.saldo['id']}/eleccion',
        cuerpo: {
          'destino': _destino,
          if (_destino == 'REASIGNACION') 'fondoDestinoId': _fondo,
        },
      );
      ref.invalidate(saldosCierreProvider);
      mensajero.showSnackBar(
        const SnackBar(content: Text('Listo. Se aplica cuando venza el plazo para elegir.')),
      );
      navegador.pop();
    } on ErrorApi catch (e) {
      mensajero.showSnackBar(SnackBar(content: Text(e.mensaje)));
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final id = widget.saldo['id'] as String;
    final monto = Formato.soles(widget.saldo['monto'] as String?);

    return Scaffold(
      appBar: AppBar(title: const Text('Qué hacer con su saldo')),
      body: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Text('$monto de su aporte a ${widget.saldo['fondo']}', style: tema.textTheme.titleMedium),
          const SizedBox(height: 4),
          const Text(
            'La causa cerró sin usar esta parte. La comisión de la pasarela no se devuelve: se '
            'cobró al procesar su aporte.',
          ),
          const SizedBox(height: 16),
          RadioGroup<String>(
            groupValue: _destino,
            onChanged: (v) => setState(() => _destino = v),
            child: const Column(
              children: [
                RadioListTile<String>(
                  value: 'DEVOLUCION',
                  title: Text('Que me lo devuelvan'),
                  subtitle: Text('Vuelve al mismo medio de pago con que donó.'),
                ),
                RadioListTile<String>(
                  value: 'REASIGNACION',
                  title: Text('Pasarlo a otra causa'),
                  subtitle: Text(
                    'Queda retenido en el fondo que elija hasta que se demuestre en qué se gasta.',
                  ),
                ),
              ],
            ),
          ),
          if (_destino == 'REASIGNACION')
            ref.watch(destinosSaldoProvider(id)).when(
                  loading: () => const Padding(
                    padding: EdgeInsets.all(16),
                    child: Center(child: CircularProgressIndicator()),
                  ),
                  error: (e, _) =>
                      Text(e is ErrorApi ? e.mensaje : 'No pudimos cargar las causas.'),
                  data: (fondos) => RadioGroup<String>(
                    groupValue: _fondo,
                    onChanged: (v) => setState(() => _fondo = v),
                    child: Column(
                      children: [
                        if (fondos.isEmpty)
                          const Padding(
                            padding: EdgeInsets.all(16),
                            child: Text('No hay otra causa que pueda recibirlo ahora.'),
                          ),
                        for (final f in fondos)
                          RadioListTile<String>(
                            value: f['id'] as String,
                            title: Text(f['nombre'] as String),
                            subtitle: Text(
                              '${f['ong']} · ${f['campana']}'
                              '${f['mismaCategoria'] == true ? ' · misma categoría' : ''}',
                            ),
                          ),
                      ],
                    ),
                  ),
                ),
          const SizedBox(height: 16),
          FilledButton(
            onPressed: _completo && !_enviando ? _confirmar : null,
            child: const Text('Confirmar'),
          ),
        ],
      ),
    );
  }
}
