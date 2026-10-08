import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../comun/widgets.dart';
import '../../nucleo/api/cliente_api.dart';
import '../../nucleo/formato.dart';
import '../../nucleo/sesion.dart';
import '../../nucleo/tema.dart';

/// Filtros de la busqueda de cuentas (RF-16).
class FiltrosUsuarios {
  const FiltrosUsuarios({this.texto = '', this.rol, this.estado, this.pagina = 1});

  final String texto;
  final String? rol;
  final String? estado;
  final int pagina;

  static const porPagina = 20;

  Map<String, dynamic> get consulta => {
        if (texto.trim().isNotEmpty) 'q': texto.trim(),
        if (rol != null) 'rol': rol,
        if (estado != null) 'estado': estado,
        'pagina': pagina,
        'porPagina': porPagina,
      };
}

class FiltrosUsuariosNotifier extends Notifier<FiltrosUsuarios> {
  @override
  FiltrosUsuarios build() => const FiltrosUsuarios();

  // Cambiar un filtro vuelve a la primera pagina: quedarse en la tercera de
  // un resultado que ahora tiene una sola mostraria una lista vacia.
  void buscar(String texto) =>
      state = FiltrosUsuarios(texto: texto, rol: state.rol, estado: state.estado);
  void filtrarRol(String? rol) =>
      state = FiltrosUsuarios(texto: state.texto, rol: rol, estado: state.estado);
  void filtrarEstado(String? estado) =>
      state = FiltrosUsuarios(texto: state.texto, rol: state.rol, estado: estado);
  void irAPagina(int pagina) => state = FiltrosUsuarios(
        texto: state.texto,
        rol: state.rol,
        estado: state.estado,
        pagina: pagina,
      );
}

final filtrosUsuariosProvider =
    NotifierProvider<FiltrosUsuariosNotifier, FiltrosUsuarios>(FiltrosUsuariosNotifier.new);

final usuariosProvider = FutureProvider.autoDispose<Map<String, dynamic>>((ref) async {
  final filtros = ref.watch(filtrosUsuariosProvider);
  return ref.read(clienteApiProvider).obtener('/identidad/usuarios', consulta: filtros.consulta);
});

final catalogoRolesProvider = FutureProvider.autoDispose<List<Map<String, dynamic>>>((ref) async {
  return ref.read(clienteApiProvider).obtenerLista('/identidad/usuarios/roles');
});

final fichaUsuarioProvider =
    FutureProvider.autoDispose.family<Map<String, dynamic>, String>((ref, id) async {
  return ref.read(clienteApiProvider).obtener('/identidad/usuarios/$id');
});

const _rolesEnOrden = ['DONANTE', 'ONG_OPERADOR', 'ONG_ADMIN', 'AUDITOR', 'ADMIN'];

String etiquetaEstadoCuenta(String estado) => switch (estado) {
      'ACTIVO' => 'Activa',
      'BLOQUEADO' => 'Bloqueada',
      'PENDIENTE_VERIFICACION' => 'Pendiente de verificar',
      _ => estado,
    };

String etiquetaAccionBitacora(String accion) => switch (accion) {
      'REGISTRO_USUARIO' => 'Creó su cuenta',
      'MFA_ACTIVADO' => 'Configuró la verificación en dos pasos',
      'ROLES_ACTUALIZADOS' => 'Cambio de roles',
      'USUARIO_BLOQUEADO' => 'Cuenta bloqueada',
      'USUARIO_ACTIVADO' => 'Cuenta reactivada',
      'MFA_RESTABLECIDO' => 'Verificación en dos pasos restablecida',
      _ => accion,
    };

/// RF-16 · Gestion de usuarios.
///
/// Antes de esta pantalla, un rol o un bloqueo solo se podian cambiar con SQL
/// directo contra la base, que es justo el camino que no deja rastro en la
/// bitacora. Cada accion de aqui pide un motivo y lo deja escrito.
class PantallaUsuarios extends ConsumerWidget {
  const PantallaUsuarios({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final usuarios = ref.watch(usuariosProvider);
    final filtros = ref.watch(filtrosUsuariosProvider);

    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(16, 16, 16, 0),
          child: Center(
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 900),
              child: Wrap(
                spacing: 12,
                runSpacing: 12,
                crossAxisAlignment: WrapCrossAlignment.center,
                children: [
                  SizedBox(
                    width: 360,
                    child: TextField(
                      decoration: const InputDecoration(
                        hintText: 'Buscar por nombre o correo',
                        prefixIcon: Icon(Icons.search),
                      ),
                      textInputAction: TextInputAction.search,
                      onSubmitted: (v) => ref.read(filtrosUsuariosProvider.notifier).buscar(v),
                    ),
                  ),
                  DropdownMenu<String?>(
                    initialSelection: filtros.rol,
                    label: const Text('Rol'),
                    onSelected: (v) => ref.read(filtrosUsuariosProvider.notifier).filtrarRol(v),
                    dropdownMenuEntries: [
                      const DropdownMenuEntry(value: null, label: 'Todos'),
                      for (final r in _rolesEnOrden)
                        DropdownMenuEntry(value: r, label: Formato.rol(r)),
                    ],
                  ),
                  DropdownMenu<String?>(
                    initialSelection: filtros.estado,
                    label: const Text('Estado'),
                    onSelected: (v) =>
                        ref.read(filtrosUsuariosProvider.notifier).filtrarEstado(v),
                    dropdownMenuEntries: [
                      const DropdownMenuEntry(value: null, label: 'Todos'),
                      for (final e in ['ACTIVO', 'BLOQUEADO', 'PENDIENTE_VERIFICACION'])
                        DropdownMenuEntry(value: e, label: etiquetaEstadoCuenta(e)),
                    ],
                  ),
                  IconButton(
                    tooltip: 'Actualizar',
                    onPressed: () => ref.invalidate(usuariosProvider),
                    icon: const Icon(Icons.refresh),
                  ),
                ],
              ),
            ),
          ),
        ),
        Expanded(
          child: usuarios.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (e, _) => TarjetaError(
              mensaje: e is ErrorApi ? e.mensaje : 'No pudimos cargar las cuentas.',
              onReintentar: () => ref.invalidate(usuariosProvider),
            ),
            data: (datos) {
              final filas = (datos['usuarios'] as List<dynamic>).cast<Map<String, dynamic>>();
              final total = datos['total'] as int;

              if (filas.isEmpty) {
                return const EstadoVacio(
                  icono: Icons.person_search,
                  titulo: 'Ninguna cuenta coincide',
                  descripcion: 'Pruebe con otra parte del nombre o del correo, o quite los filtros.',
                );
              }

              final paginas = (total / FiltrosUsuarios.porPagina).ceil();

              return ListView(
                children: [
                  Contenido(
                    ancho: 900,
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        Text(
                          total == 1 ? '1 cuenta' : '$total cuentas',
                          style: Theme.of(context).textTheme.bodySmall,
                        ),
                        const SizedBox(height: 8),
                        for (final u in filas) _TarjetaUsuario(usuario: u),
                        if (paginas > 1)
                          _Paginacion(pagina: filtros.pagina, paginas: paginas),
                      ],
                    ),
                  ),
                ],
              );
            },
          ),
        ),
      ],
    );
  }
}

class _Paginacion extends ConsumerWidget {
  const _Paginacion({required this.pagina, required this.paginas});

  final int pagina;
  final int paginas;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final notifier = ref.read(filtrosUsuariosProvider.notifier);
    return Padding(
      padding: const EdgeInsets.only(top: 12),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          IconButton(
            tooltip: 'Página anterior',
            onPressed: pagina > 1 ? () => notifier.irAPagina(pagina - 1) : null,
            icon: const Icon(Icons.chevron_left),
          ),
          Text('Página $pagina de $paginas'),
          IconButton(
            tooltip: 'Página siguiente',
            onPressed: pagina < paginas ? () => notifier.irAPagina(pagina + 1) : null,
            icon: const Icon(Icons.chevron_right),
          ),
        ],
      ),
    );
  }
}

class _TarjetaUsuario extends ConsumerWidget {
  const _TarjetaUsuario({required this.usuario});

  final Map<String, dynamic> usuario;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final tema = Theme.of(context);
    final estado = usuario['estado'] as String;
    final bloqueada = estado == 'BLOQUEADO';
    final roles = (usuario['roles'] as List<dynamic>).cast<String>();
    final ultimoAcceso = Formato.aFecha(usuario['ultimoAccesoEn']);

    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: () => _abrirFicha(context, ref),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      '${usuario['nombres']} ${usuario['apellidos']}',
                      style: tema.textTheme.titleSmall,
                    ),
                  ),
                  Text(
                    etiquetaEstadoCuenta(estado),
                    style: tema.textTheme.labelMedium?.copyWith(
                      color: bloqueada ? TemaApp.nivelBajo : tema.colorScheme.onSurfaceVariant,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ],
              ),
              Text(
                usuario['correo'] as String,
                style: tema.textTheme.labelMedium?.copyWith(
                  color: tema.colorScheme.onSurfaceVariant,
                ),
              ),
              const SizedBox(height: 10),
              Wrap(
                spacing: 6,
                runSpacing: 6,
                children: [for (final r in roles) Chip(label: Text(Formato.rol(r)))],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  _IndicadorMfa(usuario: usuario),
                  const Spacer(),
                  Text(
                    ultimoAcceso == null
                        ? 'Nunca ingresó'
                        : 'Último ingreso ${Formato.hace(ultimoAcceso)}',
                    style: tema.textTheme.labelSmall?.copyWith(
                      color: tema.colorScheme.onSurfaceVariant,
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _abrirFicha(BuildContext context, WidgetRef ref) async {
    final cambio = await showDialog<bool>(
      context: context,
      builder: (_) => DialogoUsuario(id: usuario['id'] as String),
    );
    if (cambio == true) ref.invalidate(usuariosProvider);
  }
}

/// Estado del segundo factor, solo para los roles que lo exigen.
class _IndicadorMfa extends StatelessWidget {
  const _IndicadorMfa({required this.usuario});

  final Map<String, dynamic> usuario;

  @override
  Widget build(BuildContext context) {
    if (usuario['exigeMfa'] != true) return const SizedBox.shrink();

    final pendiente = usuario['mfaPendiente'] == true;
    final color = pendiente ? TemaApp.nivelMedio : TemaApp.nivelAlto;

    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Icon(pendiente ? Icons.gpp_maybe_outlined : Icons.verified_user_outlined,
            size: 16, color: color),
        const SizedBox(width: 4),
        Text(
          pendiente ? 'Dos pasos sin configurar' : 'Dos pasos activa',
          style: Theme.of(context).textTheme.labelSmall?.copyWith(color: color),
        ),
      ],
    );
  }
}

/// Ficha de una cuenta: roles, estado, segundo factor e historial.
///
/// Devuelve `true` al cerrar si cambio algo, para que la lista se recargue.
class DialogoUsuario extends ConsumerStatefulWidget {
  const DialogoUsuario({super.key, required this.id});

  final String id;

  @override
  ConsumerState<DialogoUsuario> createState() => _DialogoUsuarioState();
}

class _DialogoUsuarioState extends ConsumerState<DialogoUsuario> {
  Set<String>? _roles;
  bool _cambio = false;
  bool _enviando = false;
  String? _error;
  List<String> _avisos = const [];

  Future<void> _ejecutar({
    required String titulo,
    required String consecuencia,
    required String textoAccion,
    required Future<Map<String, dynamic>> Function(String motivo) llamada,
  }) async {
    final motivo = await showDialog<String>(
      context: context,
      builder: (_) => DialogoMotivo(
        titulo: titulo,
        consecuencia: consecuencia,
        textoAccion: textoAccion,
      ),
    );
    if (motivo == null) return;

    setState(() {
      _enviando = true;
      _error = null;
    });
    try {
      final r = await llamada(motivo);
      ref.invalidate(fichaUsuarioProvider(widget.id));
      if (!mounted) return;
      setState(() {
        _cambio = true;
        _roles = null;
        _avisos = ((r['advertencias'] as List<dynamic>?) ?? const []).cast<String>();
      });
    } on ErrorApi catch (e) {
      if (mounted) setState(() => _error = e.mensaje);
    } finally {
      if (mounted) setState(() => _enviando = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final ficha = ref.watch(fichaUsuarioProvider(widget.id));
    final catalogo = ref.watch(catalogoRolesProvider);
    final miId = ref.watch(sesionProvider).usuario?.id;

    return AlertDialog(
      title: ficha.maybeWhen(
        data: (u) => Text('${u['nombres']} ${u['apellidos']}'),
        orElse: () => const Text('Cuenta'),
      ),
      content: SizedBox(
        width: 560,
        child: ficha.when(
          loading: () => const SizedBox(
            height: 160,
            child: Center(child: CircularProgressIndicator()),
          ),
          error: (e, _) => Text(e is ErrorApi ? e.mensaje : 'No pudimos cargar la cuenta.'),
          data: (u) => _contenido(context, u, catalogo.value ?? const [], u['id'] == miId),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(_cambio),
          child: const Text('Cerrar'),
        ),
      ],
    );
  }

  Widget _contenido(
    BuildContext context,
    Map<String, dynamic> u,
    List<Map<String, dynamic>> catalogo,
    bool esPropia,
  ) {
    final tema = Theme.of(context);
    final api = ref.read(clienteApiProvider);
    final actuales = (u['roles'] as List<dynamic>).cast<String>().toSet();
    final seleccion = _roles ?? actuales;
    final estado = u['estado'] as String;
    final bloqueada = estado == 'BLOQUEADO';
    final rolesCambiaron =
        seleccion.length != actuales.length || !seleccion.containsAll(actuales);
    final historial = (u['historial'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>();
    final codigos = catalogo.isEmpty
        ? _rolesEnOrden
        : catalogo.map((r) => r['codigo'] as String).toList();

    return SingleChildScrollView(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(u['correo'] as String, style: tema.textTheme.bodyMedium),
          const SizedBox(height: 4),
          Text(
            '${etiquetaEstadoCuenta(estado)} · cuenta creada el '
            '${Formato.fecha(Formato.aFecha(u['creadoEn']))}',
            style: tema.textTheme.labelMedium?.copyWith(
              color: bloqueada ? TemaApp.nivelBajo : tema.colorScheme.onSurfaceVariant,
            ),
          ),
          for (final ong in (u['ongs'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
            Text(
              '${ong['nombre']} · ${ong['cargo']}',
              style: tema.textTheme.labelMedium,
            ),
          const Divider(height: 32),
          Text('Roles', style: tema.textTheme.titleSmall),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              for (final codigo in codigos)
                FilterChip(
                  label: Text(Formato.rol(codigo)),
                  selected: seleccion.contains(codigo),
                  // Quitarse el propio rol de administrador lo pide a otra
                  // persona: se muestra deshabilitado en vez de fallar al guardar.
                  onSelected: (_enviando || (esPropia && codigo == 'ADMIN'))
                      ? null
                      : (marcado) => setState(() {
                            final nuevo = {...(_roles ?? actuales)};
                            marcado ? nuevo.add(codigo) : nuevo.remove(codigo);
                            _roles = nuevo;
                          }),
                ),
            ],
          ),
          if (esPropia)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Text(
                'Su propio rol de administrador solo puede quitarlo otra persona administradora.',
                style: tema.textTheme.labelSmall?.copyWith(
                  color: tema.colorScheme.onSurfaceVariant,
                ),
              ),
            ),
          const SizedBox(height: 12),
          Align(
            alignment: Alignment.centerRight,
            child: FilledButton.tonal(
              onPressed: (!rolesCambiaron || seleccion.isEmpty || _enviando)
                  ? null
                  : () => _ejecutar(
                        titulo: 'Cambiar los roles',
                        consecuencia: 'Se cerrarán las sesiones abiertas de la cuenta para que '
                            'vuelva a entrar con los permisos nuevos.',
                        textoAccion: 'Guardar roles',
                        llamada: (motivo) => api.actualizar(
                          '/identidad/usuarios/${widget.id}/roles',
                          cuerpo: {
                            'roles': [for (final c in codigos) if (seleccion.contains(c)) c],
                            'motivo': motivo,
                          },
                        ),
                      ),
              child: const Text('Guardar roles'),
            ),
          ),
          const Divider(height: 32),
          Text('Acceso', style: tema.textTheme.titleSmall),
          const SizedBox(height: 8),
          Wrap(
            spacing: 8,
            runSpacing: 8,
            children: [
              if (!esPropia || bloqueada)
                OutlinedButton.icon(
                  onPressed: _enviando
                      ? null
                      : () => _ejecutar(
                            titulo: bloqueada ? 'Reactivar la cuenta' : 'Bloquear la cuenta',
                            consecuencia: bloqueada
                                ? 'La persona podrá volver a iniciar sesión.'
                                : 'Se cerrarán todas sus sesiones y no podrá volver a entrar '
                                    'hasta que alguien la reactive.',
                            textoAccion: bloqueada ? 'Reactivar' : 'Bloquear',
                            llamada: (motivo) => api.actualizar(
                              '/identidad/usuarios/${widget.id}/estado',
                              cuerpo: {
                                'estado': bloqueada ? 'ACTIVO' : 'BLOQUEADO',
                                'motivo': motivo,
                              },
                            ),
                          ),
                  icon: Icon(bloqueada ? Icons.lock_open : Icons.block),
                  label: Text(bloqueada ? 'Reactivar cuenta' : 'Bloquear cuenta'),
                ),
              if (!esPropia && u['totpHabilitado'] == true)
                OutlinedButton.icon(
                  onPressed: _enviando
                      ? null
                      : () => _ejecutar(
                            titulo: 'Restablecer la verificación en dos pasos',
                            consecuencia: 'Se borrará el dispositivo enrolado. En su próximo '
                                'ingreso la persona tendrá que escribir su contraseña y '
                                'configurar uno nuevo. Confirme antes su identidad por otro medio.',
                            textoAccion: 'Restablecer',
                            llamada: (motivo) => api.enviar(
                              '/identidad/usuarios/${widget.id}/mfa/restablecer',
                              cuerpo: {'motivo': motivo},
                            ),
                          ),
                  icon: const Icon(Icons.phonelink_erase),
                  label: const Text('Restablecer dos pasos'),
                ),
            ],
          ),
          if (_error != null) ...[
            const SizedBox(height: 12),
            Text(_error!, style: tema.textTheme.bodySmall?.copyWith(color: TemaApp.nivelBajo)),
          ],
          for (final aviso in _avisos)
            Padding(
              padding: const EdgeInsets.only(top: 8),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Icon(Icons.info_outline, size: 16, color: TemaApp.nivelMedio),
                  const SizedBox(width: 6),
                  Expanded(child: Text(aviso, style: tema.textTheme.bodySmall)),
                ],
              ),
            ),
          if (historial.isNotEmpty) ...[
            const Divider(height: 32),
            Text('Historial', style: tema.textTheme.titleSmall),
            for (final h in historial) _EntradaHistorial(entrada: h),
          ],
        ],
      ),
    );
  }
}

class _EntradaHistorial extends StatelessWidget {
  const _EntradaHistorial({required this.entrada});

  final Map<String, dynamic> entrada;

  @override
  Widget build(BuildContext context) {
    final tema = Theme.of(context);
    final actor = entrada['actor'] as Map<String, dynamic>?;
    final nuevo = entrada['valorNuevo'];
    final motivo = nuevo is Map<String, dynamic> ? nuevo['motivo'] as String? : null;

    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            etiquetaAccionBitacora(entrada['accion'] as String),
            style: tema.textTheme.labelLarge,
          ),
          Text(
            '${Formato.fechaHora(Formato.aFecha(entrada['creadoEn']))}'
            '${actor == null ? '' : ' · ${actor['nombre']}'}',
            style: tema.textTheme.labelSmall?.copyWith(color: tema.colorScheme.onSurfaceVariant),
          ),
          if (motivo != null) Text('“$motivo”', style: tema.textTheme.bodySmall),
        ],
      ),
    );
  }
}

/// Pide el motivo de una accion administrativa y explica su consecuencia.
///
/// Devuelve el motivo, o null si se cancela. Exige 10 caracteres, lo mismo que
/// el servidor: validarlo aqui evita un viaje que se sabe que va a fallar.
class DialogoMotivo extends StatefulWidget {
  const DialogoMotivo({
    super.key,
    required this.titulo,
    required this.consecuencia,
    required this.textoAccion,
  });

  final String titulo;
  final String consecuencia;
  final String textoAccion;

  @override
  State<DialogoMotivo> createState() => _DialogoMotivoState();
}

class _DialogoMotivoState extends State<DialogoMotivo> {
  final _motivo = TextEditingController();
  final _formulario = GlobalKey<FormState>();

  @override
  void dispose() {
    _motivo.dispose();
    super.dispose();
  }

  void _confirmar() {
    if (!(_formulario.currentState?.validate() ?? false)) return;
    Navigator.of(context).pop(_motivo.text.trim());
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: Text(widget.titulo),
      content: SizedBox(
        width: 440,
        child: Form(
          key: _formulario,
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(widget.consecuencia),
              const SizedBox(height: 16),
              TextFormField(
                controller: _motivo,
                autofocus: true,
                minLines: 2,
                maxLines: 5,
                maxLength: 500,
                decoration: const InputDecoration(
                  labelText: 'Motivo',
                  helperText: 'Queda registrado en la bitácora',
                  alignLabelWithHint: true,
                ),
                validator: (v) => (v ?? '').trim().length >= 10
                    ? null
                    : 'Explique el motivo con al menos 10 caracteres.',
              ),
            ],
          ),
        ),
      ),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(),
          child: const Text('Cancelar'),
        ),
        FilledButton(onPressed: _confirmar, child: Text(widget.textoAccion)),
      ],
    );
  }
}
