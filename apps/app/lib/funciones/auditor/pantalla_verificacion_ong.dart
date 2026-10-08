import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import 'pantalla_bandeja.dart';

final ongsPendientesProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  return ref.read(clienteApiProvider).obtenerLista('/verificaciones/pendientes');
});

/// La auditoria tiene dos bandejas: los gastos por revisar y las
/// organizaciones por verificar. Las dos son trabajo del mismo rol.
class PantallaAuditoria extends StatelessWidget {
  const PantallaAuditoria({super.key});

  @override
  Widget build(BuildContext context) {
    return const DefaultTabController(
      length: 2,
      child: Column(
        children: [
          TabBar(
            tabs: [
              Tab(text: 'Gastos', icon: Icon(Icons.receipt_long_outlined)),
              Tab(text: 'Organizaciones', icon: Icon(Icons.domain_verification_outlined)),
            ],
          ),
          Expanded(
            child: TabBarView(children: [PantallaBandeja(), PantallaVerificacionOng()]),
          ),
        ],
      ),
    );
  }
}

/// CU14 · Expedientes de ONG esperando verificacion.
///
/// El sello de "verificada" es la señal sobre la que descansa la confianza
/// del donante, y la pone una persona: aqui ve el expediente completo y
/// decide con un motivo, tambien al aprobar.
class PantallaVerificacionOng extends ConsumerWidget {
  const PantallaVerificacionOng({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final pendientes = ref.watch(ongsPendientesProvider);

    return pendientes.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar los expedientes.',
        onReintentar: () => ref.invalidate(ongsPendientesProvider),
      ),
      data: (lista) {
        if (lista.isEmpty) {
          return const EstadoVacio(
            icono: Icons.verified_outlined,
            titulo: 'Ninguna organización espera verificación',
            descripcion: 'Cuando una ONG se registre, su expediente aparecerá aquí.',
          );
        }

        return RefreshIndicator(
          onRefresh: () async => ref.invalidate(ongsPendientesProvider),
          child: Contenido(
            child: ListView.separated(
              itemCount: lista.length,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (context, i) => _Expediente(ong: lista[i]),
            ),
          ),
        );
      },
    );
  }
}

class _Expediente extends ConsumerWidget {
  const _Expediente({required this.ong});

  final Map<String, dynamic> ong;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final contacto = ong['contacto'] as Map<String, dynamic>?;
    final ubicacion = [ong['distrito'], ong['provincia'], ong['departamento']]
        .whereType<String>()
        .where((t) => t.isNotEmpty)
        .join(', ');

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Expanded(
                  child: Text(
                    (ong['nombreComercial'] ?? ong['razonSocial']) as String,
                    style: tema.textTheme.titleMedium,
                  ),
                ),
                Text(
                  'solicitó ${Formato.hace(Formato.aFecha(ong['solicitadoEn']))}',
                  style: tema.textTheme.bodySmall,
                ),
              ],
            ),
            const SizedBox(height: 12),
            FilaDato(etiqueta: 'RUC', valor: ong['ruc'] as String),
            FilaDato(etiqueta: 'Razón social', valor: ong['razonSocial'] as String),
            FilaDato(
              etiqueta: 'Representante',
              valor: '${ong['representanteLegal']} · doc. ${ong['documentoRepresentante']}',
            ),
            FilaDato(etiqueta: 'Dirección', valor: '${ong['direccion']} ($ubicacion)'),
            FilaDato(
              etiqueta: 'Contacto',
              valor: [
                ong['correoContacto'] as String? ?? '',
                if (ong['telefono'] != null) ong['telefono'] as String,
                if (ong['sitioWeb'] != null) ong['sitioWeb'] as String,
              ].where((t) => t.isNotEmpty).join(' · '),
            ),
            if (contacto != null)
              FilaDato(
                etiqueta: 'Solicitante',
                valor: '${contacto['nombres']} ${contacto['apellidos']} · ${contacto['correo']}',
              ),
            FilaDato(
              etiqueta: 'Términos',
              valor: ong['terminosAceptadosEn'] == null
                  ? 'Sin aceptar'
                  : 'Versión ${ong['versionTerminos'] ?? '1.0'}, aceptados el '
                      '${Formato.fecha(Formato.aFecha(ong['terminosAceptadosEn']))}',
            ),
            if (ong['descripcion'] != null) ...[
              const SizedBox(height: 8),
              Text(ong['descripcion'] as String, style: tema.textTheme.bodyMedium),
            ],
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: [
                FilledButton.icon(
                  onPressed: () => _decidir(context, ref, 'VERIFICADA'),
                  icon: const Icon(Icons.verified),
                  label: const Text('Verificar'),
                ),
                OutlinedButton.icon(
                  onPressed: () => _decidir(context, ref, 'RECHAZADA'),
                  icon: const Icon(Icons.block),
                  label: const Text('Rechazar'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _decidir(BuildContext context, WidgetRef ref, String decision) async {
    final hecho = await showDialog<bool>(
      context: context,
      builder: (_) => _DialogoDecision(ong: ong, decision: decision),
    );
    if (hecho == true) {
      ref.invalidate(ongsPendientesProvider);
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(decision == 'VERIFICADA'
                ? 'Organización verificada: ya puede publicar campañas y recibir aportes.'
                : 'Organización rechazada. Verá el motivo en su panel.'),
          ),
        );
      }
    }
  }
}

/// El motivo es obligatorio tambien al aprobar: una verificacion sin
/// fundamento registrado no es auditable.
class _DialogoDecision extends ConsumerStatefulWidget {
  const _DialogoDecision({required this.ong, required this.decision});

  final Map<String, dynamic> ong;
  final String decision;

  @override
  ConsumerState<_DialogoDecision> createState() => _DialogoDecisionState();
}

class _DialogoDecisionState extends ConsumerState<_DialogoDecision> {
  final _motivo = TextEditingController();
  bool _enviando = false;
  String? _error;

  @override
  void dispose() {
    _motivo.dispose();
    super.dispose();
  }

  Future<void> _enviar() async {
    if (_motivo.text.trim().length < 10) {
      setState(() => _error = 'Explique el motivo en al menos 10 caracteres.');
      return;
    }
    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      await ref.read(clienteApiProvider).actualizar(
        '/ongs/${widget.ong['id']}/verificacion',
        cuerpo: {'decision': widget.decision, 'motivo': _motivo.text.trim()},
      );
      if (mounted) Navigator.of(context).pop(true);
    } on ErrorApi catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final verificar = widget.decision == 'VERIFICADA';

    return AlertDialog(
      title: Text(verificar ? 'Verificar organización' : 'Rechazar solicitud'),
      content: SizedBox(
        width: 440,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              verificar
                  ? 'Indique qué comprobó: queda en la bitácora junto a su nombre.'
                  : 'La organización verá este motivo para saber qué corregir.',
            ),
            const SizedBox(height: 12),
            TextField(
              controller: _motivo,
              maxLines: 3,
              decoration: InputDecoration(
                labelText: 'Motivo',
                errorText: _error,
                hintText: verificar
                    ? 'Por ejemplo: RUC activo y habido, representante coincide con SUNARP.'
                    : 'Por ejemplo: el RUC figura como de baja en SUNAT.',
              ),
            ),
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _enviando ? null : () => Navigator.of(context).pop(false),
          child: const Text('Cancelar'),
        ),
        FilledButton(
          onPressed: _enviando ? null : _enviar,
          child: Text(verificar ? 'Verificar' : 'Rechazar'),
        ),
      ],
    );
  }
}
