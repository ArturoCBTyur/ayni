import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Pestaña elegida, por su etiqueta.
///
/// Vive fuera del Shell para que otras pantallas puedan llevar a una
/// pestaña: el Inicio dice "tiene 3 casos vencidos" y el boton lleva a la
/// bandeja. Se guarda la etiqueta y no el indice porque el indice depende de
/// los roles; si la etiqueta no existe para quien esta en sesion, el Shell
/// cae en la primera pestaña.
class NavegacionNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void ir(String etiqueta) => state = etiqueta;
}

final navegacionProvider = NotifierProvider<NavegacionNotifier, String?>(NavegacionNotifier.new);
