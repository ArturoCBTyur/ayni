import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../nucleo/api/cliente_api.dart';
import 'descarga_otras.dart' if (dart.library.js_interop) 'descarga_web.dart' as plataforma;

/// Pide un CSV a la API y se lo entrega a quien lo pidio.
///
/// Las exportaciones exigen sesion, asi que no basta con abrir la URL: se
/// pide con el token y se entrega el texto. En la web se descarga como
/// archivo; en Android o iOS se muestra para copiarlo, sin pedir permisos de
/// almacenamiento para un archivo que casi siempre termina en una planilla.
Future<void> descargarCsv(
  BuildContext context,
  WidgetRef ref, {
  required String ruta,
  required String nombre,
}) async {
  final mensajero = ScaffoldMessenger.of(context);
  try {
    final csv = await ref.read(clienteApiProvider).obtenerTexto(ruta);
    if (plataforma.guardarArchivo(nombre, csv, 'text/csv;charset=utf-8')) {
      mensajero.showSnackBar(SnackBar(content: Text('Descargado: $nombre')));
      return;
    }
    if (!context.mounted) return;
    await showDialog<void>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(nombre),
        content: SizedBox(
          width: 560,
          height: 360,
          child: SingleChildScrollView(
            child: SelectableText(csv, style: const TextStyle(fontFamily: 'monospace')),
          ),
        ),
        actions: [
          TextButton(
            onPressed: () => Clipboard.setData(ClipboardData(text: csv)),
            child: const Text('Copiar'),
          ),
          FilledButton(
            onPressed: () => Navigator.of(context).pop(),
            child: const Text('Cerrar'),
          ),
        ],
      ),
    );
  } on ErrorApi catch (e) {
    mensajero.showSnackBar(SnackBar(content: Text(e.mensaje)));
  }
}
