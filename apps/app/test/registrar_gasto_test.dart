// Registrar gasto: el comprobante se adjunta como foto o como el PDF que
// llego por correo. La evidencia sigue siendo una foto de lo comprado.
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:trazabilidad_radical/funciones/ong/pantalla_registrar_gasto.dart';

void main() {
  testWidgets('el comprobante admite PDF y la evidencia no', (tester) async {
    await tester.pumpWidget(
      const ProviderScope(
        child: MaterialApp(home: PantallaRegistrarGasto(ongId: 'ong-1')),
      ),
    );

    final tarjetaComprobante = find.ancestor(
      of: find.text('Comprobante de pago'),
      matching: find.byType(Card),
    );
    expect(
      find.descendant(of: tarjetaComprobante, matching: find.text('Adjuntar PDF')),
      findsOneWidget,
    );
    // Uno solo en la pantalla: el de la evidencia no existe.
    expect(find.text('Adjuntar PDF'), findsOneWidget);
    expect(find.text('Tomar foto'), findsNWidgets(2));
  });
}
