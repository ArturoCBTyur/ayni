import 'package:flutter/material.dart';

import '../nucleo/config.dart';

/// URL absoluta de un archivo, a partir de la URL firmada que entrega la API.
///
/// La API devuelve rutas como `/api/v1/almacenamiento/...?token=...`, que solo
/// tienen sentido contra su propio origen: la aplicacion web se sirve desde
/// otro. Si algun dia el almacenamiento entrega URLs absolutas (S3), se
/// devuelven tal cual.
String urlDeArchivo(String url) => Uri.parse(Config.apiBaseUrl).resolve(url).toString();

/// Miniatura de un comprobante o una evidencia, que se abre a pantalla completa.
///
/// Que archivo llega aqui lo decide la API segun el rol: el auditor recibe el
/// original y los demas solo la version publicable. Este widget no elige,
/// muestra lo que le dieron; y si no le dieron nada, dice por que.
class MiniaturaArchivo extends StatelessWidget {
  const MiniaturaArchivo({
    super.key,
    required this.url,
    required this.etiqueta,
    this.mime,
    this.sinArchivo = 'Sin imagen disponible',
    this.ancho = 200,
    this.alto = 150,
  });

  /// URL firmada; null cuando el rol no puede ver el archivo.
  final String? url;

  /// Que es, para el pie y para el lector de pantalla.
  final String etiqueta;
  final String? mime;

  /// Por que no hay archivo, cuando [url] es null.
  final String sinArchivo;
  final double ancho;
  final double alto;

  bool get _esPdf => mime == 'application/pdf';

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    final Widget contenido;
    if (url == null) {
      contenido = _Marcador(icono: Icons.hide_image_outlined, texto: sinArchivo);
    } else if (_esPdf) {
      contenido = const _Marcador(
        icono: Icons.picture_as_pdf_outlined,
        texto: 'Documento PDF: sin vista previa',
      );
    } else {
      contenido = InkWell(
        onTap: () => Navigator.of(context).push(
          MaterialPageRoute<void>(
            builder: (_) => PantallaVisorImagen(url: url!, titulo: etiqueta),
          ),
        ),
        child: Image.network(
          urlDeArchivo(url!),
          fit: BoxFit.cover,
          width: ancho,
          height: alto,
          loadingBuilder: (context, hijo, progreso) => progreso == null
              ? hijo
              : const Center(child: CircularProgressIndicator(strokeWidth: 2)),
          // El enlace firmado vence a los pocos minutos. Si la pantalla quedo
          // abierta mucho tiempo, volver a entrar emite uno nuevo.
          errorBuilder: (_, _, _) => const _Marcador(
            icono: Icons.broken_image_outlined,
            texto: 'No se pudo cargar. Vuelva a abrir la pantalla.',
          ),
        ),
      );
    }

    return Semantics(
      label: etiqueta,
      image: url != null && !_esPdf,
      button: url != null && !_esPdf,
      child: SizedBox(
        width: ancho,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            ClipRRect(
              borderRadius: BorderRadius.circular(8),
              child: Container(
                width: ancho,
                height: alto,
                color: tema.colorScheme.surfaceContainerHighest,
                child: contenido,
              ),
            ),
            const SizedBox(height: 6),
            ExcludeSemantics(
              child: Text(
                etiqueta,
                style: tema.textTheme.labelSmall?.copyWith(
                  color: tema.colorScheme.onSurfaceVariant,
                ),
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _Marcador extends StatelessWidget {
  const _Marcador({required this.icono, required this.texto});

  final IconData icono;
  final String texto;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return LayoutBuilder(
      builder: (context, caja) {
        // En una miniatura chica el texto no cabe: queda el icono, y el texto
        // pasa al tooltip, que tambien es lo que lee el lector de pantalla.
        if (caja.maxHeight < 110) {
          return Tooltip(
            message: texto,
            child: Center(child: Icon(icono, color: tema.colorScheme.outline)),
          );
        }

        return Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(icono, color: tema.colorScheme.outline),
              const SizedBox(height: 8),
              // Flexible: en una miniatura mediana el texto se recorta en vez
              // de desbordar la caja.
              Flexible(
                child: Tooltip(
                  message: texto,
                  child: Text(
                    texto,
                    textAlign: TextAlign.center,
                    overflow: TextOverflow.ellipsis,
                    maxLines: 3,
                    style: tema.textTheme.bodySmall?.copyWith(
                      color: tema.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ),
              ),
            ],
          ),
        );
      },
    );
  }
}

/// Imagen a pantalla completa, con zoom: un comprobante se lee, no se mira.
class PantallaVisorImagen extends StatelessWidget {
  const PantallaVisorImagen({super.key, required this.url, required this.titulo});

  final String url;
  final String titulo;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        title: Text(titulo),
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
      ),
      body: InteractiveViewer(
        maxScale: 6,
        child: Center(
          child: Semantics(
            label: titulo,
            image: true,
            child: Image.network(
              urlDeArchivo(url),
              fit: BoxFit.contain,
              errorBuilder: (_, _, _) => const Text(
                'No se pudo cargar la imagen.',
                style: TextStyle(color: Colors.white),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
