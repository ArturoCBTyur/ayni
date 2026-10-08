import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/tema.dart';

/// CU03 · Donar a un fondo especifico.
///
/// La pasarela de esta version es simulada (ADR de pagos), y el formulario lo
/// dice con todas sus letras en lugar de pedir un numero de tarjeta que no
/// se usaria. Pedir datos de tarjeta reales en un piloto sin integracion
/// seria, ademas de inutil, una mala practica de privacidad.
class HojaDonar extends ConsumerStatefulWidget {
  const HojaDonar({super.key, required this.fondoId, required this.nombreFondo});

  final String fondoId;
  final String nombreFondo;

  @override
  ConsumerState<HojaDonar> createState() => _HojaDonarState();
}

class _HojaDonarState extends ConsumerState<HojaDonar> {
  final _formulario = GlobalKey<FormState>();
  final _monto = TextEditingController(text: '50');

  /// Tokens de prueba de la pasarela simulada.
  String _token = 'tok_ok_4242';
  bool _anonima = false;

  /// CU04 · Donar cada mes en vez de una sola vez.
  bool _mensual = false;
  int _diaCobro = DateTime.now().day.clamp(1, 28);
  bool _enviando = false;
  String? _error;
  Map<String, dynamic>? _resultado;

  @override
  void dispose() {
    _monto.dispose();
    super.dispose();
  }

  Future<void> _donar() async {
    if (!_formulario.currentState!.validate()) return;

    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      final r = await ref.read(clienteApiProvider).enviar(
        _mensual ? '/suscripciones' : '/donaciones',
        cuerpo: {
          'fondoId': widget.fondoId,
          'monto': double.parse(_monto.text.replaceAll(',', '.')),
          'tokenTarjeta': _token,
          'anonima': _anonima,
          if (_mensual) 'diaCobro': _diaCobro,
        },
      );
      setState(() => _resultado = {...r, 'mensual': _mensual});
    } on ErrorApi catch (e) {
      setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Padding(
      padding: EdgeInsets.only(
        left: 24,
        right: 24,
        top: 24,
        bottom: MediaQuery.viewInsetsOf(context).bottom + 24,
      ),
      child: SingleChildScrollView(
        child: _resultado != null
            ? (_resultado!['mensual'] == true
                ? _ConfirmacionMensual(resultado: _resultado!, fondo: widget.nombreFondo)
                : _Confirmacion(resultado: _resultado!, fondo: widget.nombreFondo))
            : Form(
                key: _formulario,
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Text('Donar a ${widget.nombreFondo}', style: tema.textTheme.titleLarge),
                    const SizedBox(height: 4),
                    Text(
                      'Su aporte quedará retenido en este fondo hasta que la organización '
                      'presente comprobante y evidencia del gasto.',
                      style: tema.textTheme.bodySmall?.copyWith(
                        color: tema.colorScheme.onSurfaceVariant,
                      ),
                    ),
                    const SizedBox(height: 20),
                    SegmentedButton<bool>(
                      selected: {_mensual},
                      onSelectionChanged: (s) => setState(() => _mensual = s.first),
                      segments: const [
                        ButtonSegment(value: false, label: Text('Una vez')),
                        ButtonSegment(value: true, label: Text('Cada mes')),
                      ],
                    ),
                    const SizedBox(height: 20),

                    TextFormField(
                      controller: _monto,
                      keyboardType: const TextInputType.numberWithOptions(decimal: true),
                      inputFormatters: [
                        FilteringTextInputFormatter.allow(RegExp(r'[0-9.,]')),
                      ],
                      decoration: const InputDecoration(
                        labelText: 'Monto',
                        prefixText: 'S/ ',
                      ),
                      validator: (v) {
                        final valor = double.tryParse((v ?? '').replaceAll(',', '.'));
                        if (valor == null || valor <= 0) return 'Ingrese un monto mayor que cero.';
                        if (valor > 999999) return 'El monto excede el máximo por transacción.';
                        return null;
                      },
                    ),
                    const SizedBox(height: 8),
                    Wrap(
                      spacing: 8,
                      children: [
                        for (final sugerido in [20, 50, 100, 200])
                          ActionChip(
                            label: Text('S/ $sugerido'),
                            onPressed: () => _monto.text = '$sugerido',
                          ),
                      ],
                    ),

                    if (_mensual) ...[
                      const SizedBox(height: 20),
                      DropdownMenu<int>(
                        initialSelection: _diaCobro,
                        expandedInsets: EdgeInsets.zero,
                        label: const Text('Día del cobro'),
                        helperText: 'Del 1 al 28, para que exista en todos los meses. Puede '
                            'pausar o cancelar cuando quiera desde Mis aportes.',
                        onSelected: (v) => setState(() => _diaCobro = v ?? _diaCobro),
                        dropdownMenuEntries: [
                          for (var d = 1; d <= 28; d++)
                            DropdownMenuEntry(value: d, label: 'Día $d de cada mes'),
                        ],
                      ),
                    ],
                    const SizedBox(height: 20),
                    DropdownMenu<String>(
                      initialSelection: _token,
                      expandedInsets: EdgeInsets.zero,
                      label: const Text('Tarjeta de prueba'),
                      helperText: 'La pasarela es simulada en esta versión del piloto.',
                      onSelected: (v) => setState(() => _token = v ?? 'tok_ok_4242'),
                      dropdownMenuEntries: const [
                        DropdownMenuEntry(value: 'tok_ok_4242', label: 'Visa •••• 4242 (aprueba)'),
                        DropdownMenuEntry(
                          value: 'tok_rechazo_0000',
                          label: 'Visa •••• 0000 (fondos insuficientes)',
                        ),
                        DropdownMenuEntry(
                          value: 'tok_robada_1111',
                          label: 'Visa •••• 1111 (tarjeta reportada)',
                        ),
                      ],
                    ),

                    const SizedBox(height: 12),
                    SwitchListTile(
                      value: _anonima,
                      onChanged: (v) => setState(() => _anonima = v),
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Donar de forma anónima'),
                      subtitle: const Text(
                        'La organización no verá su nombre. Usted sigue recibiendo la '
                        'evidencia de su aporte.',
                      ),
                    ),

                    if (_error != null) ...[
                      const SizedBox(height: 12),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(
                          color: TemaApp.nivelBajo.withValues(alpha: 0.08),
                          borderRadius: BorderRadius.circular(8),
                        ),
                        child: Text(
                          _error!,
                          style: tema.textTheme.bodySmall?.copyWith(color: TemaApp.nivelBajo),
                        ),
                      ),
                    ],

                    const SizedBox(height: 20),
                    FilledButton(
                      onPressed: _enviando ? null : _donar,
                      child: _enviando
                          ? const SizedBox(
                              height: 20,
                              width: 20,
                              child: CircularProgressIndicator(strokeWidth: 2),
                            )
                          : Text(_mensual ? 'Donar cada mes' : 'Confirmar donación'),
                    ),
                    TextButton(
                      onPressed: _enviando ? null : () => Navigator.of(context).pop(false),
                      child: const Text('Cancelar'),
                    ),
                  ],
                ),
              ),
      ),
    );
  }
}

/// Confirmacion con el desglose de la comision (RN-02).
class _Confirmacion extends StatelessWidget {
  const _Confirmacion({required this.resultado, required this.fondo});

  final Map<String, dynamic> resultado;
  final String fondo;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Icon(Icons.schedule, size: 48, color: TemaApp.nivelMedio),
        const SizedBox(height: 16),
        Text(
          'Estamos confirmando su pago',
          style: tema.textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          resultado['mensaje'] as String? ?? '',
          style: tema.textTheme.bodyMedium,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),

        // El donante ve cuanto se lleva la pasarela y cuanto llega al fondo:
        // es lo que RN-02 exige y lo que distingue esto de una caja negra.
        Card(
          child: Padding(
            padding: const EdgeInsets.all(16),
            child: Column(
              children: [
                _Linea(
                  etiqueta: 'Su aporte',
                  valor: Formato.soles(resultado['monto'] as String?),
                ),
                _Linea(
                  etiqueta: 'Comisión de la pasarela',
                  valor: '− ${Formato.soles(resultado['comisionEstimada'] as String?)}',
                ),
                const Divider(),
                _Linea(
                  etiqueta: 'Llega a $fondo',
                  valor: Formato.soles(resultado['montoNetoEstimado'] as String?),
                  destacado: true,
                ),
              ],
            ),
          ),
        ),

        const SizedBox(height: 24),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Entendido'),
        ),
      ],
    );
  }
}

/// La donacion mensual no cobra hoy: el primer cobro es en su dia del mes
/// siguiente, y se dice con la fecha exacta.
class _ConfirmacionMensual extends StatelessWidget {
  const _ConfirmacionMensual({required this.resultado, required this.fondo});

  final Map<String, dynamic> resultado;
  final String fondo;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Column(
      mainAxisSize: MainAxisSize.min,
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Icon(Icons.event_repeat, size: 48, color: TemaApp.nivelAlto),
        const SizedBox(height: 16),
        Text(
          'Donación mensual creada',
          style: tema.textTheme.titleLarge,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          '${Formato.soles(resultado['monto'] as String?)} a $fondo el día '
          '${resultado['diaCobro']} de cada mes. El primer cobro será el '
          '${Formato.fechaLarga(Formato.aFecha(resultado['proximoCobroEn']))}.',
          style: tema.textTheme.bodyMedium,
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 8),
        Text(
          'Cada cobro queda retenido en el fondo igual que una donación única, hasta que la '
          'organización demuestre el gasto. Puede pausarla o cancelarla desde Mis aportes.',
          style: tema.textTheme.bodySmall?.copyWith(color: tema.colorScheme.onSurfaceVariant),
          textAlign: TextAlign.center,
        ),
        const SizedBox(height: 24),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          child: const Text('Entendido'),
        ),
      ],
    );
  }
}

class _Linea extends StatelessWidget {
  const _Linea({required this.etiqueta, required this.valor, this.destacado = false});

  final String etiqueta;
  final String valor;
  final bool destacado;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final estilo = destacado
        ? tema.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.w700)
        : tema.textTheme.bodyMedium;

    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 4),
      child: Row(
        children: [
          Expanded(child: Text(etiqueta, style: estilo)),
          Text(valor, style: estilo),
        ],
      ),
    );
  }
}
