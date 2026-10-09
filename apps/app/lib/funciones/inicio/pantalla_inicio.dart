import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/navegacion.dart';
import '../../nucleo/sesion.dart';
import '../../nucleo/tema.dart';
import '../donante/pantalla_campana.dart';
import '../encuestas/pantalla_encuesta.dart';
import '../ong/pantalla_equipo.dart';
import '../ong/pantalla_fondos.dart';
import '../ong/pantalla_gastos.dart';
import '../ong/pantalla_registrar_gasto.dart';
import '../salud/pantalla_salud.dart';

final panelProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  return ref.read(clienteApiProvider).obtener('/analitica/panel');
});

/// RF-IA-10 · Fondos afines a lo que el donante ya apoya, con el motivo.
final recomendacionesProvider =
    FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  return ref.read(clienteApiProvider).obtenerLista('/recomendaciones');
});

/// Inicio de cada rol: lo que tiene pendiente y como va lo suyo.
///
/// Antes todos entraban al catalogo de causas, que es la vitrina del donante.
/// Un operador abria la aplicacion para registrar un gasto y un auditor para
/// atender su cola; ninguno de los dos venia a donar. Cada seccion aparece
/// solo si la API la devuelve, y la del rol principal va primero.
class PantallaInicio extends ConsumerWidget {
  const PantallaInicio({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final panel = ref.watch(panelProvider);
    final usuario = ref.watch(sesionProvider).usuario;

    return panel.when(
      loading: () => const Center(child: CircularProgressIndicator()),
      error: (e, _) => TarjetaError(
        mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar su resumen.',
        onReintentar: () => ref.invalidate(panelProvider),
      ),
      data: (datos) {
        final ongs = (datos['ongs'] as List<dynamic>?)?.cast<Map<String, dynamic>>();
        final donante = datos['donante'] as Map<String, dynamic>?;
        final auditor = datos['auditor'] as Map<String, dynamic>?;
        final admin = datos['administrador'] as Map<String, dynamic>?;

        final secciones = <(String, Widget)>[
          if (admin != null) ('ADMIN', _SeccionAdmin(datos: admin)),
          if (auditor != null) ('AUDITOR', _SeccionAuditor(datos: auditor)),
          for (final ong in ongs ?? const <Map<String, dynamic>>[])
            ('ONG', _SeccionOng(ong: ong)),
          if (donante != null) ('DONANTE', _SeccionDonante(datos: donante)),
        ];
        final principal = switch (usuario?.rolPrincipal) {
          'ONG_ADMIN' || 'ONG_OPERADOR' => 'ONG',
          final rol => rol,
        };
        // La seccion del rol principal primero; el resto, en el orden de arriba.
        secciones.sort((a, b) => (a.$1 == principal ? 0 : 1).compareTo(b.$1 == principal ? 0 : 1));

        return RefreshIndicator(
          onRefresh: () async {
            ref.invalidate(panelProvider);
            ref.invalidate(encuestasPendientesProvider);
          },
          child: Contenido(
            child: ListView(
              children: [
                if (usuario != null && usuario.nombres.isNotEmpty)
                  Text(
                    'Hola, ${usuario.nombres.split(' ').first}',
                    style: Theme.of(context).textTheme.headlineSmall,
                  ),
                const SizedBox(height: 16),
                // RF-SO-05: solo aparece si a esta persona le toca responder hoy.
                const InvitacionEncuesta(),
                if (secciones.isEmpty)
                  const EstadoVacio(
                    icono: Icons.inbox_outlined,
                    titulo: 'Nada pendiente',
                    descripcion: 'Su cuenta todavía no tiene un rol con tareas en la plataforma.',
                  ),
                for (final (_, seccion) in secciones) ...[seccion, const SizedBox(height: 20)],
              ],
            ),
          ),
        );
      },
    );
  }
}

// ----------------------------------------------------------------- piezas

/// Encabezado de una seccion del inicio.
class _Titulo extends StatelessWidget {
  const _Titulo({required this.icono, required this.texto, this.detalle});

  final IconData icono;
  final String texto;
  final String? detalle;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(bottom: 10),
      child: Row(
        children: [
          Icon(icono, size: 20, color: tema.colorScheme.primary),
          const SizedBox(width: 8),
          Expanded(child: Text(texto, style: tema.textTheme.titleMedium)),
          if (detalle != null)
            Text(detalle!, style: tema.textTheme.labelMedium),
        ],
      ),
    );
  }
}

/// Una cifra con su etiqueta. Si tiene accion, se puede tocar.
class Cifra extends StatelessWidget {
  const Cifra({
    super.key,
    required this.etiqueta,
    required this.valor,
    this.color,
    this.onTap,
  });

  final String etiqueta;
  final String valor;
  final Color? color;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);

    return SizedBox(
      width: 170,
      child: Card(
        margin: EdgeInsets.zero,
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  valor,
                  style: tema.textTheme.headlineSmall?.copyWith(
                    color: color,
                    fontWeight: FontWeight.w700,
                  ),
                ),
                const SizedBox(height: 4),
                Text(
                  etiqueta,
                  style: tema.textTheme.bodySmall?.copyWith(
                    color: tema.colorScheme.onSurfaceVariant,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Cifras extends StatelessWidget {
  const _Cifras(this.cifras);

  final List<Widget> cifras;

  @override
  Widget build(BuildContext context) =>
      Wrap(spacing: 10, runSpacing: 10, children: cifras);
}

class _Acciones extends StatelessWidget {
  const _Acciones(this.acciones);

  final List<Widget> acciones;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: 12),
        child: Wrap(spacing: 8, runSpacing: 8, children: acciones),
      );
}

class _Aviso extends StatelessWidget {
  const _Aviso({required this.texto, required this.color});

  final String texto;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 10),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(8),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Icon(Icons.info_outline, size: 18, color: color),
          const SizedBox(width: 10),
          Expanded(child: Text(texto, style: Theme.of(context).textTheme.bodyMedium)),
        ],
      ),
    );
  }
}

int _n(Map<String, dynamic> m, String clave) => (m[clave] as num?)?.toInt() ?? 0;

// ----------------------------------------------------------------- donante

class _SeccionDonante extends ConsumerWidget {
  const _SeccionDonante({required this.datos});

  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ir = ref.read(navegacionProvider.notifier).ir;
    final sinLeer = _n(datos, 'impactosSinLeer');
    final ultimo = datos['ultimoImpacto'] as Map<String, dynamic>?;
    final aportes = _n(datos, 'aportes');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _Titulo(icono: Icons.favorite_outline, texto: 'Sus aportes'),
        if (aportes == 0)
          const _Aviso(
            texto: 'Todavía no ha donado. Cada aporte queda retenido hasta que la organización '
                'demuestre el gasto con comprobante y foto.',
            color: TemaApp.semilla,
          ),
        _Cifras([
          Cifra(etiqueta: 'Aportado', valor: Formato.soles(datos['aportado'] as String?)),
          Cifra(
            etiqueta: 'Ya gastado y verificado',
            valor: Formato.soles(datos['ejecutado'] as String?),
            color: TemaApp.nivelAlto,
          ),
          Cifra(
            etiqueta: 'Esperando evidencia',
            valor: Formato.soles(datos['esperandoEvidencia'] as String?),
            color: TemaApp.nivelMedio,
          ),
          Cifra(
            etiqueta: 'Impactos sin leer',
            valor: '$sinLeer',
            color: sinLeer > 0 ? TemaApp.semilla : null,
            onTap: () => ir('Impacto'),
          ),
        ]),
        if (ultimo != null) ...[
          const SizedBox(height: 10),
          Card(
            margin: EdgeInsets.zero,
            child: ListTile(
              leading: const Icon(Icons.volunteer_activism_outlined),
              title: Text(ultimo['asunto'] as String),
              subtitle: Text(
                [
                  if (ultimo['montoAplicado'] != null)
                    'De su aporte: ${Formato.soles(ultimo['montoAplicado'] as String?)}',
                  Formato.hace(Formato.aFecha(ultimo['creadoEn'])),
                ].join(' · '),
              ),
              trailing: const Icon(Icons.chevron_right),
              onTap: () => ir('Impacto'),
            ),
          ),
        ],
        const _Recomendaciones(),
        _Acciones([
          FilledButton.icon(
            onPressed: () => ir('Causas'),
            icon: const Icon(Icons.explore_outlined),
            label: const Text('Explorar causas'),
          ),
          OutlinedButton.icon(
            onPressed: () => ir('Mis aportes'),
            icon: const Icon(Icons.receipt_long_outlined),
            label: Text('Mis aportes ($aportes)'),
          ),
        ]),
      ],
    );
  }
}

/// Se dice por que se recomienda cada fondo: una sugerencia sin motivo se
/// parece demasiado a publicidad. Sin historial no hay nada que sugerir, y
/// la seccion no aparece.
class _Recomendaciones extends ConsumerWidget {
  const _Recomendaciones();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final lista = ref.watch(recomendacionesProvider).value ?? const [];
    if (lista.isEmpty) return const SizedBox.shrink();
    final tema = Theme.of(context);

    return Padding(
      padding: const EdgeInsets.only(top: 14),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text('Le puede interesar', style: tema.textTheme.titleSmall),
          const SizedBox(height: 6),
          for (final r in lista)
            Card(
              margin: const EdgeInsets.only(bottom: 8),
              child: ListTile(
                leading: const Icon(Icons.lightbulb_outline),
                title: Text('${r['nombre']} · ${(r['campana'] as Map)['titulo']}'),
                subtitle: Text(
                  '${r['ong']} · ${r['motivo']}\n'
                  '${Formato.soles(r['recaudado'] as String?)} de '
                  '${Formato.soles(r['meta'] as String?)}',
                ),
                isThreeLine: true,
                trailing: const Icon(Icons.chevron_right),
                onTap: () => Navigator.of(context).push(
                  MaterialPageRoute<void>(
                    builder: (_) =>
                        PantallaCampana(slug: (r['campana'] as Map)['slug'] as String),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

// ----------------------------------------------------------------- ONG

class _SeccionOng extends ConsumerWidget {
  const _SeccionOng({required this.ong});

  final Map<String, dynamic> ong;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ongId = ong['id'] as String;
    final esAdmin = ong['cargo'] == 'ADMINISTRADOR';
    final gastos = (ong['gastos'] as Map<String, dynamic>?) ?? const {};
    final campanas = (ong['campanas'] as Map<String, dynamic>?) ?? const {};
    final observaciones = _n(ong, 'observacionesAbiertas');
    final porDifuminar = _n(ong, 'fotosPorDifuminar');
    final estado = ong['estadoVerificacion'] as String;

    // Llevar a una pestaña de la ONG con esta ONG ya elegida.
    void ir(String pestana) {
      ref.read(ongActivaProvider.notifier).seleccionar(ongId);
      ref.read(navegacionProvider.notifier).ir(pestana);
    }

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        _Titulo(
          icono: Icons.domain_outlined,
          texto: ong['nombre'] as String,
          detalle: esAdmin ? 'Administrador' : 'Operador',
        ),
        if (estado != 'VERIFICADA')
          _Aviso(
            color: TemaApp.nivelMedio,
            texto: switch (estado) {
              'RECHAZADA' =>
                'La verificación fue rechazada. Motivo: ${ong['motivoRechazo'] ?? '—'}',
              'SUSPENDIDA' =>
                'La organización está suspendida. Motivo: ${ong['motivoRechazo'] ?? '—'}',
              _ => 'Un auditor está revisando la documentación. Mientras tanto puede preparar '
                  'campañas en borrador, pero no recibir donaciones.',
            },
          ),
        if (observaciones > 0)
          _Aviso(
            color: TemaApp.nivelBajo,
            texto: observaciones == 1
                ? 'Hay una observación del auditor por responder.'
                : 'Hay $observaciones observaciones del auditor por responder.',
          ),
        if (porDifuminar > 0)
          _Aviso(
            color: TemaApp.nivelMedio,
            texto: porDifuminar == 1
                ? 'Una foto con personas espera que difumine los rostros: el donante no la '
                    'verá hasta entonces.'
                : '$porDifuminar fotos con personas esperan que difumine los rostros.',
          ),
        _Cifras([
          Cifra(etiqueta: 'Recaudado', valor: Formato.soles(ong['recaudado'] as String?)),
          Cifra(
            etiqueta: 'Por justificar con gastos',
            valor: Formato.soles(ong['retenido'] as String?),
            color: TemaApp.nivelMedio,
            onTap: () => ir('Fondos'),
          ),
          Cifra(
            etiqueta: 'Ejecutado y verificado',
            valor: Formato.soles(ong['ejecutado'] as String?),
            color: TemaApp.nivelAlto,
          ),
          Cifra(
            etiqueta: 'Gastos en análisis o revisión',
            valor: '${_n(gastos, 'EN_ANALISIS') + _n(gastos, 'EN_REVISION')}',
            onTap: () => ir('Gastos'),
          ),
          Cifra(
            etiqueta: 'Gastos observados',
            valor: '${_n(gastos, 'OBSERVADO')}',
            color: _n(gastos, 'OBSERVADO') > 0 ? TemaApp.nivelBajo : null,
            onTap: () => ir('Gastos'),
          ),
          if (esAdmin)
            Cifra(
              etiqueta: 'Campañas publicadas · en borrador',
              valor: '${_n(campanas, 'ACTIVA')} · ${_n(campanas, 'BORRADOR')}',
              onTap: () => ir('Campañas'),
            ),
          Cifra(
            etiqueta: 'Puntaje de confianza',
            valor: Formato.soles(ong['puntajeConfianza'] as String?).replaceFirst('S/ ', ''),
            color: TemaApp.semilla,
          ),
        ]),
        _Acciones([
          FilledButton.icon(
            onPressed: estado == 'VERIFICADA'
                ? () async {
                    final registrado = await Navigator.of(context).push<bool>(
                      MaterialPageRoute(builder: (_) => PantallaRegistrarGasto(ongId: ongId)),
                    );
                    if (registrado == true) {
                      ref.invalidate(panelProvider);
                      ref.invalidate(gastosOngProvider(ongId));
                    }
                  }
                : null,
            icon: const Icon(Icons.add_a_photo_outlined),
            label: const Text('Registrar gasto'),
          ),
          if (observaciones > 0)
            OutlinedButton.icon(
              onPressed: () => ir('Fondos'),
              icon: const Icon(Icons.reply_outlined),
              label: const Text('Responder observaciones'),
            ),
          if (porDifuminar > 0)
            OutlinedButton.icon(
              onPressed: () => ir('Gastos'),
              icon: const Icon(Icons.blur_on),
              label: const Text('Difuminar fotos'),
            ),
          if (esAdmin) ...[
            OutlinedButton.icon(
              onPressed: () => ir('Campañas'),
              icon: const Icon(Icons.campaign_outlined),
              label: const Text('Campañas'),
            ),
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute<void>(builder: (_) => const PantallaEquipo()),
              ),
              icon: const Icon(Icons.group_outlined),
              label: Text('Equipo (${_n(ong, 'equipoActivo')})'),
            ),
          ],
        ]),
      ],
    );
  }
}

// ----------------------------------------------------------------- auditor

class _SeccionAuditor extends ConsumerWidget {
  const _SeccionAuditor({required this.datos});

  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ir = ref.read(navegacionProvider.notifier).ir;
    final niveles = (datos['porNivel'] as Map<String, dynamic>?) ?? const {};
    final vencidos = _n(datos, 'casosVencidos');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _Titulo(icono: Icons.fact_check_outlined, texto: 'Auditoría'),
        if (vencidos > 0)
          _Aviso(
            color: TemaApp.nivelBajo,
            texto: vencidos == 1
                ? 'Un caso superó las 48 horas hábiles del plazo de resolución (RN-07).'
                : '$vencidos casos superaron las 48 horas hábiles del plazo de resolución '
                    '(RN-07).',
          ),
        _Cifras([
          Cifra(
            etiqueta: 'Casos por revisar',
            valor: '${_n(datos, 'casosEnRevision')}',
            onTap: () => ir('Auditoría'),
          ),
          Cifra(
            etiqueta: 'Fuera de plazo',
            valor: '$vencidos',
            color: vencidos > 0 ? TemaApp.nivelBajo : null,
            onTap: () => ir('Auditoría'),
          ),
          Cifra(
            etiqueta: 'Nivel bajo · medio',
            valor: '${_n(niveles, 'BAJO')} · ${_n(niveles, 'MEDIO')}',
            onTap: () => ir('Auditoría'),
          ),
          Cifra(
            etiqueta: 'ONG por verificar',
            valor: '${_n(datos, 'ongsPorVerificar')}',
            onTap: () => ir('Auditoría'),
          ),
          Cifra(etiqueta: 'Alertas abiertas', valor: '${_n(datos, 'alertasAbiertas')}'),
        ]),
        _Acciones([
          FilledButton.icon(
            onPressed: () => ir('Auditoría'),
            icon: const Icon(Icons.fact_check_outlined),
            label: const Text('Ir a la bandeja'),
          ),
        ]),
      ],
    );
  }
}

// ----------------------------------------------------------------- administrador

class _SeccionAdmin extends ConsumerWidget {
  const _SeccionAdmin({required this.datos});

  final Map<String, dynamic> datos;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final ir = ref.read(navegacionProvider.notifier).ir;
    final arcoVencidas = _n(datos, 'arcoVencidas');
    final colaFallida = _n(datos, 'colaFallida');

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        const _Titulo(icono: Icons.admin_panel_settings_outlined, texto: 'Plataforma'),
        if (arcoVencidas > 0)
          _Aviso(
            color: TemaApp.nivelBajo,
            texto: 'Hay $arcoVencidas solicitud(es) de derechos ARCO fuera del plazo legal '
                '(Ley 29733).',
          ),
        _Cifras([
          Cifra(
            etiqueta: 'Solicitudes ARCO pendientes',
            valor: '${_n(datos, 'arcoPendientes')}',
            onTap: () => ir('Solicitudes'),
          ),
          Cifra(
            etiqueta: 'Análisis en cola',
            valor: '${_n(datos, 'colaPendiente')}',
          ),
          Cifra(
            etiqueta: 'Análisis fallidos',
            valor: '$colaFallida',
            color: colaFallida > 0 ? TemaApp.nivelBajo : null,
          ),
          Cifra(
            etiqueta: 'Cuentas bloqueadas',
            valor: '${_n(datos, 'usuariosBloqueados')}',
            onTap: () => ir('Usuarios'),
          ),
        ]),
        _Acciones([
          FilledButton.icon(
            onPressed: () => ir('Tablero'),
            icon: const Icon(Icons.insights_outlined),
            label: const Text('Conciliación e indicadores'),
          ),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute<void>(builder: (_) => const PantallaSalud()),
            ),
            icon: const Icon(Icons.monitor_heart_outlined),
            label: const Text('Estado del sistema'),
          ),
        ]),
      ],
    );
  }
}
