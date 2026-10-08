import 'dart:js_interop';

import 'package:web/web.dart' as web;

/// En el navegador: un Blob y un enlace temporal con `download`.
bool guardarArchivo(String nombre, String contenido, String tipo) {
  final blob = web.Blob(
    // BOM: sin el, Excel abre el CSV como Latin-1 y rompe las tildes.
    ['﻿$contenido'.toJS].toJS,
    web.BlobPropertyBag(type: tipo),
  );
  final url = web.URL.createObjectURL(blob);
  final enlace = web.HTMLAnchorElement()
    ..href = url
    ..download = nombre;
  web.document.body?.append(enlace);
  enlace.click();
  enlace.remove();
  web.URL.revokeObjectURL(url);
  return true;
}
