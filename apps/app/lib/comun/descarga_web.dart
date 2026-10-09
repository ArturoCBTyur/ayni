import 'dart:js_interop';
import 'dart:typed_data';

import 'package:web/web.dart' as web;

/// En el navegador: un Blob y un enlace temporal con `download`.
bool guardarArchivo(String nombre, String contenido, String tipo) {
  // BOM: sin el, Excel abre el CSV como Latin-1 y rompe las tildes. La API lo
  // manda, pero el cliente lo quita al decodificar el texto.
  _descargar(web.Blob(['\uFEFF$contenido'.toJS].toJS, web.BlobPropertyBag(type: tipo)), nombre);
  return true;
}

/// Lo mismo con un binario: Excel, PDF o el texto del PLE tal como llego.
bool guardarBytes(String nombre, List<int> bytes, String tipo) {
  final datos = Uint8List.fromList(bytes).toJS;
  _descargar(web.Blob([datos].toJS, web.BlobPropertyBag(type: tipo)), nombre);
  return true;
}

void _descargar(web.Blob blob, String nombre) {
  final url = web.URL.createObjectURL(blob);
  final enlace = web.HTMLAnchorElement()
    ..href = url
    ..download = nombre;
  web.document.body?.append(enlace);
  enlace.click();
  enlace.remove();
  web.URL.revokeObjectURL(url);
}
