import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import 'pantalla_campana.dart';

final fichaOngProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, ongId) async {
  return ref.read(clienteApiProvider).obtener('/ongs/$ongId');
});

/// RF-SO-01 · Ficha publica de la organizacion.
///
/// Antes de donar a una causa, el donante puede mirar a quien esta detras:
/// si esta verificada y desde cuando, como se compone su puntaje y que otras
/// causas sostiene.
class PantallaOng extends ConsumerWidget {
  const PantallaOng({super.key, required this.ongId});

  final String ongId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ficha = ref.watch(fichaOngProvider(ongId));

    return Scaffold(
      appBar: AppBar(title: const Text('Organización')),
      body: ficha.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (e, _) => TarjetaError(
          mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar la organización.',
          onReintentar: () => ref.invalidate(fichaOngProvider(ongId)),
        ),
        data: (ong) => _Ficha(ong: ong),
      ),
    );
  }
}

class _Ficha extends StatelessWidget {
  const _Ficha({required this.ong});

  final Map<String, dynamic> ong;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final confianza = ong['confianza'] as Map<String, dynamic>?;
    final campanas = (ong['campanas'] as List<dynamic>).cast<Map<String, dynamic>>();
    final verificada = ong['verificada'] as bool;

    return SingleChildScrollView(
      child: Contenido(
        ancho: 760,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              (ong['nombreComercial'] ?? ong['razonSocial']) as String,
              style: tema.textTheme.headlineSmall,
            ),
            const SizedBox(height: 8),
            Wrap(
              spacing: 12,
              runSpacing: 4,
              crossAxisAlignment: WrapCrossAlignment.center,
              children: [
                SelloVerificada(verificada: verificada),
                if (verificada && ong['verificadaEn'] != null)
                  Text(
                    'desde ${Formato.fecha(Formato.aFecha(ong['verificadaEn']))}',
                    style: tema.textTheme.bodySmall,
                  ),
                Text('RUC ${ong['ruc']}', style: tema.textTheme.bodySmall),
                Text(ong['departamento'] as String, style: tema.textTheme.bodySmall),
              ],
            ),
            if (ong['descripcion'] != null) ...[
              const SizedBox(height: 16),
              Text(ong['descripcion'] as String, style: tema.textTheme.bodyLarge),
            ],
            if (ong['sitioWeb'] != null) ...[
              const SizedBox(height: 8),
              SelectableText(ong['sitioWeb'] as String, style: tema.textTheme.bodySmall),
            ],
            if (confianza != null) ...[
              const SizedBox(height: 24),
              TarjetaConfianza(
                puntaje: (confianza['puntaje'] as num?)?.toDouble() ?? 0,
                desglose: confianza,
              ),
            ],
            const SizedBox(height: 24),
            Text('Causas activas', style: tema.textTheme.titleMedium),
            const SizedBox(height: 8),
            if (campanas.isEmpty)
              Text(
                'No tiene campañas recibiendo aportes en este momento.',
                style: tema.textTheme.bodyMedium,
              ),
            for (final c in campanas)
              Card(
                child: ListTile(
                  title: Text(c['titulo'] as String),
                  subtitle: Text(
                    '${c['causa']} · ${(c['fondos'] as List<dynamic>).length} fondo(s)',
                  ),
                  trailing: const Icon(Icons.chevron_right),
                  onTap: () => Navigator.of(context).push(
                    MaterialPageRoute<void>(
                      builder: (_) => PantallaCampana(slug: c['slug'] as String),
                    ),
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
