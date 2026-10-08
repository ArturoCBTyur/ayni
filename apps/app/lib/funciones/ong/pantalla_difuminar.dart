import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/visor_archivo.dart';
import '../../nucleo/api/cliente_api.dart';

/// Maximo de zonas que acepta la API por evidencia.
const _maximoRegiones = 20;

/// RF-DE-04 · Difuminar a mano los rostros de una evidencia.
///
/// Sustituye a la deteccion automatica (RF-IA-01, diferida a AIni): quien
/// tomo la foto marca cada rostro arrastrando un recuadro, y el servidor
/// difumina esas zonas. Hasta que esto ocurre, la foto no llega al donante:
/// la base rechaza asociar a una notificacion una evidencia sin anonimizar.
///
/// Las zonas se guardan relativas (0 a 1) mientras se dibujan, y se pasan a
/// pixeles de la imagen real al enviar: la foto se ve achicada en pantalla y
/// el servidor la difumina en su tamaño original.
class PantallaDifuminar extends ConsumerStatefulWidget {
  const PantallaDifuminar({super.key, required this.evidenciaId, required this.url});

  final String evidenciaId;

  /// URL del original: la API la entrega solo mientras falta difuminar.
  final String url;

  @override
  ConsumerState<PantallaDifuminar> createState() => _PantallaDifuminarState();
}

class _PantallaDifuminarState extends ConsumerState<PantallaDifuminar> {
  late final NetworkImage _imagen = NetworkImage(urlDeArchivo(widget.url));
  ImageStream? _flujo;
  late final ImageStreamListener _oyente = ImageStreamListener(
    (info, _) {
      if (mounted) {
        setState(() => _tamano = Size(info.image.width.toDouble(), info.image.height.toDouble()));
      }
    },
    onError: (_, _) {
      if (mounted) setState(() => _errorCarga = true);
    },
  );

  /// Tamaño real de la imagen, en pixeles.
  Size? _tamano;
  bool _errorCarga = false;

  final _regiones = <Rect>[];
  Offset? _inicio;
  Rect? _enCurso;

  bool _enviando = false;
  String? _error;

  @override
  void didChangeDependencies() {
    super.didChangeDependencies();
    _flujo?.removeListener(_oyente);
    _flujo = _imagen.resolve(createLocalImageConfiguration(context))..addListener(_oyente);
  }

  @override
  void dispose() {
    _flujo?.removeListener(_oyente);
    super.dispose();
  }

  Offset _relativo(Offset local, Size caja) => Offset(
        (local.dx / caja.width).clamp(0.0, 1.0),
        (local.dy / caja.height).clamp(0.0, 1.0),
      );

  void _empezar(Offset local, Size caja) {
    if (_regiones.length >= _maximoRegiones) return;
    setState(() {
      _inicio = _relativo(local, caja);
      _enCurso = Rect.fromPoints(_inicio!, _inicio!);
    });
  }

  void _arrastrar(Offset local, Size caja) {
    if (_inicio == null) return;
    setState(() => _enCurso = Rect.fromPoints(_inicio!, _relativo(local, caja)));
  }

  void _soltar() {
    final zona = _enCurso;
    setState(() {
      // Un toque sin arrastre no es una zona: se descarta en vez de mandar
      // un recuadro de un pixel que no difumina nada.
      if (zona != null && zona.width > 0.01 && zona.height > 0.01) {
        _regiones.add(zona);
      }
      _inicio = null;
      _enCurso = null;
    });
  }

  Future<void> _guardar() async {
    final tamano = _tamano!;
    setState(() {
      _enviando = true;
      _error = null;
    });

    try {
      await ref.read(clienteApiProvider).enviar(
        '/evidencias/${widget.evidenciaId}/anonimizar',
        cuerpo: {
          'regiones': [
            for (final r in _regiones)
              {
                'x': (r.left * tamano.width).round(),
                'y': (r.top * tamano.height).round(),
                'ancho': (r.width * tamano.width).round().clamp(1, tamano.width.round()),
                'alto': (r.height * tamano.height).round().clamp(1, tamano.height.round()),
              },
          ],
        },
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
    final tema = Theme.of(context);

    return Scaffold(
      appBar: AppBar(title: const Text('Difuminar rostros')),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Text(
                'Arrastre un recuadro sobre cada rostro. El donante verá la foto con esas '
                'zonas difuminadas; el original lo conserva la plataforma y solo lo ve un '
                'auditor.',
                style: tema.textTheme.bodyMedium,
              ),
              const SizedBox(height: 12),
              Expanded(child: _lienzo()),
              const SizedBox(height: 12),
              if (_error != null) ...[
                Text(_error!, style: TextStyle(color: tema.colorScheme.error)),
                const SizedBox(height: 8),
              ],
              Wrap(
                spacing: 8,
                runSpacing: 8,
                crossAxisAlignment: WrapCrossAlignment.center,
                alignment: WrapAlignment.end,
                children: [
                  Text(
                    _regiones.isEmpty
                        ? 'Ninguna zona marcada'
                        : '${_regiones.length} zona(s) marcada(s)'
                            '${_regiones.length >= _maximoRegiones ? ' · máximo alcanzado' : ''}',
                    style: tema.textTheme.labelLarge,
                  ),
                  TextButton.icon(
                    onPressed: _regiones.isEmpty || _enviando
                        ? null
                        : () => setState(() => _regiones.removeLast()),
                    icon: const Icon(Icons.undo),
                    label: const Text('Deshacer'),
                  ),
                  FilledButton.icon(
                    onPressed: _regiones.isEmpty || _enviando || _tamano == null ? null : _guardar,
                    icon: _enviando
                        ? const SizedBox(
                            width: 16,
                            height: 16,
                            child: CircularProgressIndicator(strokeWidth: 2),
                          )
                        : const Icon(Icons.blur_on),
                    label: const Text('Difuminar y guardar'),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Widget _lienzo() {
    if (_errorCarga) {
      return const Center(
        child: Text('No se pudo cargar la foto. Vuelva atrás y abra el gasto de nuevo.'),
      );
    }
    final tamano = _tamano;
    if (tamano == null) return const Center(child: CircularProgressIndicator());

    return Center(
      child: AspectRatio(
        aspectRatio: tamano.width / tamano.height,
        child: LayoutBuilder(
          builder: (context, caja) {
            final area = caja.biggest;
            Rect enPantalla(Rect r) => Rect.fromLTRB(
                  r.left * area.width,
                  r.top * area.height,
                  r.right * area.width,
                  r.bottom * area.height,
                );

            return Semantics(
              label: 'Foto de la evidencia. Arrastre sobre cada rostro para marcarlo.',
              child: GestureDetector(
                onPanStart: (d) => _empezar(d.localPosition, area),
                onPanUpdate: (d) => _arrastrar(d.localPosition, area),
                onPanEnd: (_) => _soltar(),
                child: Stack(
                  fit: StackFit.expand,
                  children: [
                    Image(image: _imagen, fit: BoxFit.fill),
                    for (final r in _regiones)
                      Positioned.fromRect(rect: enPantalla(r), child: const _Zona()),
                    if (_enCurso != null)
                      Positioned.fromRect(
                        rect: enPantalla(_enCurso!),
                        child: const _Zona(enCurso: true),
                      ),
                  ],
                ),
              ),
            );
          },
        ),
      ),
    );
  }
}

class _Zona extends StatelessWidget {
  const _Zona({this.enCurso = false});

  final bool enCurso;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        // Oscurecer la zona ya da una idea del resultado: lo marcado deja de
        // reconocerse, que es lo que se busca.
        color: Colors.black.withValues(alpha: enCurso ? 0.25 : 0.55),
        border: Border.all(color: Colors.white, width: 2),
      ),
    );
  }
}
