import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/sesion.dart';

/// CU08 · Registrar una organizacion y pedir su verificacion.
///
/// Cualquier cuenta puede hacerlo: quien la registra queda como su
/// administrador, sin perder lo que ya era. La ONG nace pendiente: puede
/// preparar campañas en borrador, pero no recibe un sol hasta que un auditor
/// la verifique (CU14).
///
/// El rol de administrador de ONG exige segundo factor. Por eso, al terminar,
/// se refresca la sesion: si la cuenta no lo tenia, la aplicacion la lleva a
/// configurarlo antes de darle acceso a la organizacion.
class PantallaRegistrarOng extends ConsumerStatefulWidget {
  const PantallaRegistrarOng({super.key});

  @override
  ConsumerState<PantallaRegistrarOng> createState() => _PantallaRegistrarOngState();
}

class _PantallaRegistrarOngState extends ConsumerState<PantallaRegistrarOng> {
  final _formulario = GlobalKey<FormState>();
  final _c = {
    for (final campo in [
      'ruc',
      'razonSocial',
      'nombreComercial',
      'representanteLegal',
      'documentoRepresentante',
      'direccion',
      'departamento',
      'provincia',
      'distrito',
      'correoContacto',
      'telefono',
      'sitioWeb',
      'descripcion',
    ])
      campo: TextEditingController(),
  };

  bool _aceptaTerminos = false;
  bool _enviando = false;
  String? _error;

  /// Errores por campo que devolvio la API, para mostrarlos donde corresponden.
  Map<String, String> _erroresServidor = const {};

  @override
  void dispose() {
    for (final c in _c.values) {
      c.dispose();
    }
    super.dispose();
  }

  String _v(String campo) => _c[campo]!.text.trim();

  String? _errorDe(String campo) => _erroresServidor[campo];

  Future<void> _enviar() async {
    setState(() => _erroresServidor = const {});
    if (!_formulario.currentState!.validate()) return;
    if (!_aceptaTerminos) {
      setState(() => _error = 'Debe aceptar los términos de adhesión para registrar la ONG.');
      return;
    }

    setState(() {
      _enviando = true;
      _error = null;
    });

    final cuerpo = <String, dynamic>{
      for (final campo in _c.keys)
        if (_v(campo).isNotEmpty) campo: _v(campo),
      'aceptaTerminos': true,
    };

    try {
      await ref.read(clienteApiProvider).enviar('/ongs', cuerpo: cuerpo);
      if (!mounted) return;

      await showDialog<void>(
        context: context,
        builder: (context) => AlertDialog(
          title: const Text('Solicitud enviada'),
          content: const Text(
            'Un auditor revisará la documentación. Mientras tanto puede preparar campañas en '
            'borrador, pero la organización no recibirá donaciones hasta estar verificada.\n\n'
            'Administrar una organización exige verificación en dos pasos: si todavía no la '
            'tiene, se la pediremos ahora.',
          ),
          actions: [
            FilledButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Entendido'),
            ),
          ],
        ),
      );
      if (!mounted) return;

      // Se vuelve a la raiz antes de refrescar: si la sesion queda pendiente
      // de segundo factor, la raiz muestra el enrolamiento y esta ruta no
      // debe quedar encima.
      Navigator.of(context).popUntil((ruta) => ruta.isFirst);
      await ref.read(sesionProvider.notifier).restaurar();
    } on ErrorApi catch (e) {
      setState(() {
        _error = e.mensaje;
        _erroresServidor = {for (final x in e.errores ?? const []) x.campo: x.mensaje};
      });
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  Widget _campo(
    String campo,
    String etiqueta, {
    String? ayuda,
    bool obligatorio = false,
    int minimo = 0,
    int lineas = 1,
    TextInputType? teclado,
    List<TextInputFormatter>? formato,
    String? Function(String)? validar,
  }) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 14),
      child: TextFormField(
        controller: _c[campo],
        decoration: InputDecoration(
          labelText: obligatorio ? etiqueta : '$etiqueta (opcional)',
          helperText: ayuda,
          helperMaxLines: 2,
          errorText: _errorDe(campo),
          alignLabelWithHint: lineas > 1,
        ),
        maxLines: lineas,
        keyboardType: teclado,
        inputFormatters: formato,
        validator: (valor) {
          final v = valor?.trim() ?? '';
          if (obligatorio && v.length < (minimo == 0 ? 1 : minimo)) {
            return minimo > 1 ? '$etiqueta: al menos $minimo caracteres.' : 'Complete $etiqueta.';
          }
          if (v.isNotEmpty && validar != null) return validar(v);
          return null;
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final soloDigitos = [FilteringTextInputFormatter.digitsOnly];

    return Scaffold(
      appBar: AppBar(title: const Text('Registrar una organización')),
      body: Form(
        key: _formulario,
        child: SingleChildScrollView(
          child: Contenido(
            ancho: 720,
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(
                  'Registre su ONG para publicar causas. Un auditor verificará los datos antes '
                  'de que pueda recibir donaciones.',
                  style: tema.textTheme.bodyMedium,
                ),
                const SizedBox(height: 20),
                Text('Datos legales', style: tema.textTheme.titleSmall),
                const SizedBox(height: 10),
                _campo(
                  'ruc',
                  'RUC',
                  obligatorio: true,
                  teclado: TextInputType.number,
                  formato: [...soloDigitos, LengthLimitingTextInputFormatter(11)],
                  validar: (v) => v.length == 11 ? null : 'El RUC tiene 11 dígitos.',
                ),
                _campo('razonSocial', 'Razón social', obligatorio: true, minimo: 3),
                _campo(
                  'nombreComercial',
                  'Nombre comercial',
                  ayuda: 'Es el nombre que verán los donantes, si es distinto de la razón social.',
                ),
                _campo('representanteLegal', 'Representante legal', obligatorio: true, minimo: 3),
                _campo(
                  'documentoRepresentante',
                  'DNI o carné de extranjería del representante',
                  obligatorio: true,
                  teclado: TextInputType.number,
                  formato: [...soloDigitos, LengthLimitingTextInputFormatter(12)],
                  validar: (v) => v.length == 8 || v.length >= 9
                      ? null
                      : 'El DNI tiene 8 dígitos; el carné, entre 9 y 12.',
                ),
                const SizedBox(height: 8),
                Text('Ubicación y contacto', style: tema.textTheme.titleSmall),
                const SizedBox(height: 10),
                _campo('direccion', 'Dirección fiscal', obligatorio: true, minimo: 5),
                _campo('departamento', 'Departamento', obligatorio: true, minimo: 3),
                _campo('provincia', 'Provincia'),
                _campo('distrito', 'Distrito'),
                _campo(
                  'correoContacto',
                  'Correo de contacto',
                  obligatorio: true,
                  teclado: TextInputType.emailAddress,
                  validar: (v) => v.contains('@') ? null : 'Ingrese un correo válido.',
                ),
                _campo(
                  'telefono',
                  'Teléfono',
                  teclado: TextInputType.phone,
                  formato: [...soloDigitos, LengthLimitingTextInputFormatter(9)],
                ),
                _campo(
                  'sitioWeb',
                  'Sitio web',
                  teclado: TextInputType.url,
                  validar: (v) => v.startsWith('http://') || v.startsWith('https://')
                      ? null
                      : 'Escriba la dirección completa, con https://',
                ),
                _campo(
                  'descripcion',
                  'Labor de la organización',
                  obligatorio: true,
                  minimo: 30,
                  lineas: 4,
                  ayuda: 'Qué hace, desde cuándo y a quién atiende.',
                ),
                CheckboxListTile(
                  value: _aceptaTerminos,
                  onChanged: (v) => setState(() => _aceptaTerminos = v ?? false),
                  controlAffinity: ListTileControlAffinity.leading,
                  contentPadding: EdgeInsets.zero,
                  title: const Text('Acepto los términos de adhesión'),
                  subtitle: const Text(
                    'La organización se compromete a justificar cada sol recibido con su '
                    'comprobante y una evidencia, antes de que el dinero se libere.',
                  ),
                ),
                if (_error != null) ...[
                  const SizedBox(height: 8),
                  Text(_error!, style: TextStyle(color: tema.colorScheme.error)),
                ],
                const SizedBox(height: 16),
                FilledButton(
                  onPressed: _enviando ? null : _enviar,
                  child: Text(_enviando ? 'Enviando...' : 'Enviar solicitud de verificación'),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
