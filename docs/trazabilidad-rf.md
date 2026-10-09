# Matriz de trazabilidad: requerimientos → implementación → prueba

Este documento se actualiza al cerrar cada fase. Solo se marca como **Implementado** lo que tiene una prueba que lo demuestra; el resto queda como **Pendiente** o **Diferido** con su motivo.

La honestidad de esta tabla es el punto: un requerimiento marcado como cumplido sin prueba que lo respalde vale menos que uno marcado como pendiente.

## Leyenda

| Estado | Significado |
|---|---|
| ✅ Implementado | Tiene código y al menos una prueba que falla si se rompe |
| 🟡 Parcial | Implementado en parte; se indica qué falta |
| ⬜ Pendiente | Planificado en una fase posterior |
| ⏸️ Diferido | Requiere IA o credenciales externas; ver ADR |

---

## Requerimientos no funcionales

| ID | Requerimiento | Estado | Dónde | Prueba |
|---|---|---|---|---|
| RNF-01 | Cifrado en tránsito y reposo | 🟡 | **Reposo:** AES-256-GCM en `comun/cifrado` para evidencias (`AlmacenamientoDisco`) y secretos TOTP, cada sobre atado a su objeto o a su cuenta; clave obligatoria en producción, rotación con `npm run cifrado:migrar`. **Tránsito:** TLS del proveedor, pendiente del despliegue | `cifrado.spec.ts` · 27 casos; la suite completa corre con el cifrado activo en CI |
| RNF-02 | Autenticación robusta y RBAC | ✅ | `modules/identidad`: Argon2id, JWT corto + refresh rotativo en cookie httpOnly, TOTP obligatorio, guard global que niega por defecto | `identidad.spec.ts` · 15 casos |
| RNF-03 | OWASP ASVS nivel 2 | 🟡 | Revisión por capítulo en [revision-asvs-l2.md](revision-asvs-l2.md), con cuatro hallazgos corregidos: límite de 5/min en las rutas que prueban credenciales (antes 7 200 intentos/hora), Swagger fuera de producción, comodín de CORS rechazado al arrancar y `sharp` actualizado | `gastos.http.spec.ts` (19 casos) e `identidad.http.spec.ts` (5). Falta prueba de penetración independiente |
| RNF-04 | No almacenar datos de tarjeta | ✅ | Solo token y últimos 4; la tokenización ocurre en la pasarela | `donaciones.spec.ts` |
| RNF-05 | Privacidad desde el diseño | ✅ | Consentimiento por finalidad con revocación que conserva la historia, ARCO con plazos en días hábiles y exportación de datos sin credenciales | `cumplimiento.spec.ts` · 15 casos |
| RNF-06 | Anonimización de beneficiarios | 🟡 | Difuminado manual en el servidor + trigger de la base. La ONG marca los rostros en `pantalla_difuminar.dart`; hasta entonces la API no entrega a nadie más que al auditor una URL de esa foto (`evidencia-publica.ts`) | `imagen.spec.ts`, `gastos.spec.ts`, `integridad.spec.ts`, `retorno.spec.ts`, `evidencias_test.dart`. Automático diferido a AIni |
| RNF-07 | Libro de movimientos inalterable | ✅ | `fn_libro_solo_insercion`, `fn_movimiento_encadenar`, `fn_verificar_cadena`, más la verificación diaria de todas las cadenas en `ConciliacionService` | `integridad.spec.ts` · 7 casos; `analitica.spec.ts` altera un movimiento y comprueba que la conciliación lo detecta; `npm run demo:romper` lo demuestra en vivo |
| RNF-08 | Bitácora de acciones sensibles | ✅ | `BitacoraService` como punto único de escritura, con comparación antes/después; registro atómico dentro de transacción donde hace falta | `identidad.spec.ts`, `cumplimiento.spec.ts` |
| RNF-09 | Explicabilidad de las decisiones | ✅ | Cada motivo dice qué regla evaluó, cómo salió y con qué valor; el análisis queda atado al motor y a la regla vigente | `reglas-v0.motor.spec.ts`, `verificacion.spec.ts` |
| RNF-10 | p95 de API bajo 500 ms lectura | 🟡 | `npm run medir:latencia`, que distingue un rechazo del limitador de una latencia alta | Línea base local: p95 entre 2.8 y 4.3 ms en las cuatro rutas públicas de lectura. **Falta la medición contra el despliegue**, que es la única que responde el requisito: la local no incluye red, arranque en frío ni distancia a la base |
| RNF-11 | Análisis en tiempo razonable | ✅ | El motor de reglas resuelve en milisegundos; `duracionMs` se persiste en cada análisis | `verificacion.spec.ts` |
| RNF-12 | Disponibilidad 99,5 % | ⬜ Fase 11 | — | — |
| RNF-13 | Respaldo y recuperación | ✅ | `scripts/respaldo/`: `pg_dump` + archivos + las cabezas de la cadena de cada fondo. Restaurar verifica la integridad del respaldo, los triggers de inmutabilidad, cada cadena y que cada cabeza registrada esté con el mismo hash ([respaldo.md](respaldo.md)) | Simulacro en CI (job `docker`): respalda, restaura en una base vacía y falla si algo no coincide |
| RNF-14 | Experiencia de baja fricción | 🟡 | Registro de gasto en 3 pantallas; toque de 48 dp; el SUS se responde en la app | Falta la sesión con usuarios reales ([protocolo-sus.md](protocolo-sus.md)) |
| RNF-15 | Accesibilidad WCAG 2.1 AA | 🟡 | Contraste, toque de 48 dp y `Semantics` en los widgets compartidos. El gráfico del tablero repite sus cifras en texto y el QR de MFA ofrece la clave escrita, porque ni un lienzo ni un código QR dicen nada a un lector de pantalla | **Riesgo confirmado**: el canvas de Flutter Web no expone elementos al DOM. Ver la evidencia en [ADR-0001](adr/0001-frontend-flutter-web.md) |
| RNF-16 | Operación con conectividad limitada | 🟡 | El backend conserva la hora original de captura al sincronizar | `gastos.spec.ts`. Falta la cola offline en Flutter |
| RNF-17 | Multiplataforma real | 🟡 | Flutter web + Android + iOS habilitados | `flutter build web` en CI |
| RNF-18 | Escalabilidad sin rediseño | 🟡 | Servicios sin estado; cola desacoplada; las transacciones contables reintentan ante conflicto de serialización, que es lo que exige SERIALIZABLE bajo concurrencia real | `donaciones.spec.ts` · tres donaciones confirmadas a la vez sobre un mismo fondo, y el mismo webhook entregado dos veces en paralelo |
| RNF-19 | Cobertura ≥ 70 % en contable y gastos | ✅ | Umbral activo en `jest.config.js` y cumplido: `contable` 97.6 % de sentencias y 87.5 % de ramas; `gastos` 91.5 % y 62.2 % | `npm run test:cov`. Medirla encontró un defecto real: el controlador de gastos estaba en 0 % y su ruta de subida nunca había funcionado |
| RNF-20 | Español peruano y soles | ✅ | `Formato.soles` entrega "S/ 1,234.50", el formato real del país; fechas en español | `formato_test.dart` · 8 casos |
| RNF-21 | Narrativas veraces | ✅ | Un Proxy hace fallar cualquier plantilla que referencie un dato no verificado; el filtro de lenguaje corre sobre toda la biblioteca en las pruebas | `retorno.spec.ts` · 5 casos |

## Reglas de negocio del Entregable 2

| ID | Regla | Estado | Prueba |
|---|---|---|---|
| RN-01 | Toda donación pertenece a un único fondo | ✅ | `integridad.spec.ts` · "pertenece a otro fondo" |
| RN-02 | La comisión se registra como movimiento separado | ✅ | `donaciones.spec.ts`. Un mismo cobro no se asienta dos veces ni aunque el webhook llegue dos veces en paralelo: la guarda de idempotencia se evalúa **dentro** de la transacción, porque una leída antes queda vieja si hay reintento |
| RN-03 | Los movimientos no se editan ni eliminan | ✅ | `integridad.spec.ts` · 3 casos |
| RN-04 | La suma aplicada iguala el monto aprobado | ✅ | `integridad.spec.ts` · "no iguala el monto aprobado" |
| RN-05 | Toda evidencia con rostros se anonimiza | ✅ | `integridad.spec.ts` · 2 casos de privacidad |
| RN-06 | El nivel se calcula con la regla vigente y queda registrado | ✅ | `verificacion.spec.ts` · cambiar umbrales no reescribe análisis anteriores |
| RN-07 | Resolución de auditoría en 48 h hábiles | ✅ | `auditoria.spec.ts` · el SLA cuenta horas hábiles saltando fines de semana |
| RN-08 | Muestreo de casos ALTO | ✅ | 10 % de los aprobados automáticamente; alimenta el indicador de falsos aprobados |

## Requerimientos funcionales de AIni

Tres están implementados con modelos en `apps/aini` —el lector de comprobantes, la coherencia semántica y el detector de anomalías—; el resto se resuelve de forma determinista, en algunos casos a propósito. El criterio de la sustitución está en [ADR-0005](adr/0005-motor-reglas-v0.md).

| ID | Requerimiento | Estado en v1 |
|---|---|---|
| RF-IA-01 | Difuminado automático de rostros | ⏸️ Se sustituye por difuminado **manual** con declaración obligatoria. La restricción de BD que protege al beneficiario sigue activa e igual de estricta |
| RF-IA-02 | Extracción OCR de campos | ✅ `aini/ocr.py` (rapidocr-onnxruntime) + `aini/cotejo.py`; `datos_extraidos.fuente = "ocr"`. El auditor lo ve campo por campo contra lo declarado en `pantalla_revision.dart` (`cotejo_test.dart` · 6 casos). Probado solo sobre boletas sintéticas, no sobre papel térmico real |
| RF-IA-03 | Comparar extraído contra declarado | 🟡 Se compara declarado contra categoría del fondo y saldo; sin fuente OCR que contrastar |
| RF-IA-04 | Coherencia visual por visión computacional | ⏸️ Se sustituye por señales deterministas de calidad, EXIF y novedad |
| RF-IA-05 | Detectar evidencias reutilizadas | ✅ **Implementado completo sin IA**: SHA-256 + dHash + Hamming. Detecta una foto reciclada aunque la hayan recortado y recomprimido |
| RF-IA-06 | Detección de anomalías | ✅ Reglas estadísticas (±2σ, proveedor nuevo, fraccionamiento, registro tardío) en lugar de modelo |
| RF-IA-07 | Puntaje 0-100 y nivel | ✅ **Implementado completo**: tres señales ponderadas, umbrales configurables, bloqueos duros |
| RF-IA-08 | Explicación legible | ✅ Cada motivo con regla, resultado, mensaje en español y valor que lo disparó |
| RF-IA-09 | Narrativa de impacto | ✅ Por plantillas, que es lo que el propio entregable especifica. Una por donante con su monto exacto |
| RF-IA-10 | Recomendar fondos | ✅ Por afinidad de causa y categoría, sin ML, explicando el motivo de cada sugerencia |
| RF-IA-11 | Etiquetas y versionado de modelos | ✅ `modelos_ia` tiene `reglas-v0` como versión activa; `revisiones_auditoria` acumulará las etiquetas |
| RF-IA-12 | Puntaje histórico de la ONG | ✅ Se recalcula tras cada decisión de auditoría y al vencer un plazo de subsanación |

## Requerimientos externos que necesitan credenciales

| ID | Requerimiento | Estado |
|---|---|---|
| RF-DE-03 | Validez del CPE ante SUNAT | 🟡 `FakeSunat` valida RUC por módulo 11, formato de serie, fecha y aritmética. **Declara explícitamente que no puede confirmar la existencia del comprobante** (`existeEnSunat: null`); la consulta real necesita credenciales SOL |
| RF-07 / RF-08 | Pagos por pasarela | ✅ con `FakeGateway`: webhook firmado, idempotente y asíncrono. Culqi implementa la misma interfaz |
| RF-12 | Notificaciones push | ⏸️ In-app y correo cubren el flujo; FCM diferido ([ADR-0004](adr/0004-notificaciones-sin-push.md)) |

## Requerimientos transdisciplinarios (plan de octubre de 2026)

Vienen del [plan de trabajo](plan-transdisciplinario.md) y se registran **antes** de implementarlos, con su criterio de aceptación (T0.1). Las decisiones de las que dependen están en [ADR-0007](adr/0007-decisiones-transdisciplinarias.md), todavía sin firmar. Los números continúan desde el último que usa el repositorio en cada disciplina; si el Entregable 2 ya usaba alguno, se renumera aquí.

| ID | Requerimiento | Tarea | Depende de | Criterio de aceptación | Estado |
|---|---|---|---|---|---|
| RF-CF-05 | Correspondencia de las cuentas internas con el PCGE al exportar | T1.1 | D1 | Cada tipo de movimiento tiene asiento PCGE; exportado, el debe iguala al haber por asiento y en total; ningún asiento se reescribe | ✅ Sobre la **propuesta** de D1: `contable/pcge.ts` y `GET /analitica/exportar/diario/:fondoId` (`base-contable.spec.ts` · 9 casos) |
| RF-CF-06 | Saldos del fondo con restricción y liberados | T1.2 | D1 | La clasificación de cada fondo suma lo recaudado bruto y coincide con los saldos que mantiene la base | ✅ Sobre la **propuesta** de D1: `contable/clasificacion.ts` y `LibroService.saldosClasificados` (`base-contable.spec.ts` · 6 casos) |
| RF-CF-07 | Estado de actividades y situación del fondo por período | T2.1 | D1 | Los totales del período son la suma de sus movimientos; el retenido final es el inicial más la variación y coincide con el saldo del fondo; la conciliación no reporta descuadre | ✅ Sobre la **propuesta** de D1: `EstadosService`, por mes en hora de Lima y solo desde el libro, con balance de comprobación PCGE (`estados.spec.ts` · 11 casos) |
| RF-CF-08 | Estados mensuales en JSON, Excel y PDF | T2.2, T2.5 | D5 | Los ven el administrador, el auditor y los miembros de la ONG dueña; un miembro de otra ONG y un donante reciben 403 (prueba HTTP); se descargan desde la app | ✅ `GET /analitica/estados/fondos/:id`; Excel y PDF sin dependencias, abiertos con LibreOffice y `pdftotext` (`formatos.spec.ts` · 15, `estados.http.spec.ts` · 13). En la app, **Estados mensuales** en Fondos y en el informe de la ONG (`estados_test.dart` · 7) |
| RF-CF-09 | Cierre mensual inmutable | T2.3 | D1 | Un cierre por fondo y mes, con el hash SHA-256 de su contenido; la base rechaza modificarlo o borrarlo y rechaza un hash que no corresponda al contenido; la ONG recibe aviso | ✅ `cierres_mensuales` con CHECK del hash, cadena entre cierres y triggers de solo inserción; cron del día 1 a las 2:00 de Lima. Un mes cerrado dice si el libro todavía lo sostiene (`estados.spec.ts` · 12 casos; simulacro de respaldo) |
| RF-CF-10 | Libro diario y mayor en formato PLE | T2.4 | D1, D5 | Estructura validada por un contador | 🟡 **Borrador**: formatos 5.1 y 6.1 por ONG y mes, con `BORRADOR-` en el nombre (`estados.spec.ts` · 5 casos). Falta la validación del contador y decidir si el libro, que no es la contabilidad completa de la ONG, se presenta así |
| RF-CF-11 | Remanente al cerrar una causa | T3.1 | D2 | Al vencer el plazo, cada remanente se devuelve o reasigna con su motivo; la cadena sigue íntegra y la conciliación cuadra | ⬜ Pendiente |
| RF-CF-12 | Informe de cierre de causa | T3.2 | D2, D5 | PDF con resumen, estados acumulados, gastos con comprobante y fotos publicables, verificación de cadena y destino del remanente | ⬜ Pendiente |
| RF-IN-05 | Verificación pública del informe de cierre | T3.3 | — | El QR del informe lleva a una página que muestra su hash y recalcula la cadena del fondo | ⬜ Pendiente |
| RF-CO-03 | Aviso de cierre a cada donante | T3.4 | D2 | Cada donante recibe su parte y su destino, por plantilla y con el filtro de lenguaje ético | ⬜ Pendiente |
| RF-SO-05 | Instrumentos de encuesta versionados | T4.1 | D3, D6 | Ítems, escala y versión inmutables una vez publicados; las respuestas no guardan la identidad de quien responde | ✅ Sobre la **propuesta** de D3: `encuestas/instrumentos.ts`; la base comprueba el hash de cada versión y no deja cambiarla ni borrarla; la respuesta guarda un seudónimo HMAC, no la cuenta (`encuestas.spec.ts` · 20 casos, `encuestas.http.spec.ts` · 5, `encuestas_test.dart` · 4) |
| RF-DE-06 | Consentimiento para investigación | T4.1 | D6 | Nadie responde una encuesta sin la finalidad otorgada; revocarla desvincula sus respuestas | ✅ Finalidad `INVESTIGACION`; revocarla reemplaza el seudónimo por uno aleatorio en la misma transacción. La app la pide antes de la primera pregunta y la lista en Privacidad |
| RF-SO-06 | SOC-1 medido | T4.2 | D3 | La variación se calcula sobre pares línea base–seguimiento y reemplaza el «Sin medir» del tablero | ✅ Pares de la misma persona; la línea base solo se ofrece antes del primer impacto y el seguimiento a los 30 días. La escala es una adaptación propia **pendiente de validación** |
| RF-PS-06 | PSI-1 medido con el SUS | T4.3 | D3 | Puntaje SUS con la fórmula estándar; sesión con usuarios reales y su acta | 🟡 El SUS está en la app y PSI-1 se calcula. **Falta la sesión con usuarios reales**: protocolo y formato de acta en [protocolo-sus.md](protocolo-sus.md) |
| RF-SO-07 | Umbral de publicación de agregados | T4.4 | D6 | Ningún indicador se publica con menos respuestas que el umbral; el tablero muestra el *n* | ✅ n ≥ 5 en los que salen de opiniones (SOC-1, PSI-1, COM-1); todos los indicadores llevan su *n* (`encuestas.spec.ts`, `tablero_test.dart`) |
| RF-SO-08 | Unidades de impacto en el gasto | T5.1 | D4 | La ONG declara unidades al registrar el gasto, según su categoría | ⬜ Pendiente |
| RF-SO-09 | Costo por unidad de impacto | T5.2 | D4 | Por fondo y por causa, incluido en el informe de cierre | ⬜ Pendiente |
| RF-DE-07 | Constancia de donación | T6.1 | — | PDF para el donante; si la ONG es perceptora de donaciones, con lo que la norma exige, validado por un contador | ⬜ Pendiente |
| RF-DE-08 | Informe de cumplimiento de la Ley N.° 29733 | T6.2 | — | ARCO en plazo, consentimientos por finalidad y DER-1, exportable | ⬜ Pendiente |
| RF-IN-06 | Exportación IATI | T7.1 | D5 | Actividades, transacciones y resultados de cada causa válidos contra el esquema IATI | ⬜ Pendiente |

---

## Resumen de avance

| Fase | Estado |
|---|---|
| 0 · Cimientos del entorno | ✅ Cerrada — `/salud` responde con PostgreSQL 18.3 desde Flutter Web |
| 1 · Modelo de datos e integridad | ✅ Cerrada — 28 tablas, 9 triggers, 25 pruebas de integridad |
| 2 · Identidad y cumplimiento | ✅ Cerrada — acceso con MFA, RBAC, consentimientos, ARCO y bitácora |
| 3 · ONG, campañas y fondos | ✅ Cerrada — alta y verificación de ONG, campañas, fondos, buscador y puntaje explicable |
| 4 · Donación, pago y retención | ✅ Cerrada — pasarela simulada con webhook firmado, libro cuadrando |
| 5 · Gasto, comprobante y evidencia | ✅ Cerrada — hashes, dHash, nitidez, difuminado manual, URLs firmadas |
| 6 · Motor de Verificación v0 | ✅ Cerrada — el seam de AIni, con los tres niveles y aplicación FIFO |
| 7 · Auditoría, alertas y FIFO | ✅ Cerrada — decisión fundamentada, conflicto de interés, debido proceso reputacional |
| 8 · Motor de Retorno y control social | ✅ Cerrada — narrativa por donante, filtro ético, reporte que abre caso real |
| 9 · Conciliación, analítica y reportes | ✅ Cerrada — conciliación entre fuentes independientes, indicadores de la Tabla 3, exportaciones y tablero de KPIs |
| Frontend Flutter | ✅ Sesión con segundo factor, causas, donación, historial, narrativas, panel de ONG, bandeja de auditoría, tablero de indicadores y derechos ARCO. Desde octubre de 2026, además, un inicio por rol, fotos y comprobantes según el rol, gestión de campañas y fondos, registro y verificación de ONG con su equipo, donación mensual y herramientas del auditor (ver más abajo) |
| 10 y 11 | ⬜ Planificadas |
| Plan transdisciplinario · Fase 0 | 🟡 Decisiones D1–D6 propuestas en [ADR-0007](adr/0007-decisiones-transdisciplinarias.md), **sin firmar**; RF nuevos registrados arriba como pendientes |
| Plan transdisciplinario · Fase 1 | ✅ Base contable sobre la propuesta de D1: el libro se exporta en cuentas del PCGE sin reescribir un asiento, y los saldos de cada fondo se clasifican en con restricción y liberados. **Corrige un defecto latente de la conciliación**: calculaba los saldos del libro solo con RETENCION y EJECUCION, así que el primer REVERSO o REASIGNACION habría aparecido como un descuadre crítico que no existe. Ningún flujo los asentaba todavía; la Fase 3 los va a usar |
| Plan transdisciplinario · Fase 2 | ✅ Estados mensuales por fondo en JSON, Excel y PDF, cierre mensual inmutable y encadenado, aviso a la ONG y pantalla **Estados mensuales**. El PLE queda como borrador hasta que lo valide un contador |
| Plan transdisciplinario · Fase 4 | ✅ Encuestas de SOC-1 y PSI-1 en la app, con consentimiento propio, respuestas sin la cuenta y umbral de publicación. Instrumentos y umbral sobre la **propuesta** de D3 y D6. Falta la sesión de usabilidad con usuarios reales. De paso, `limpiar-datos-de-prueba.sql` recalculaba los saldos con `RETENCION - EJECUCION` sin `COALESCE`: en un fondo sin gastos daba NULL y dejaba su saldo retenido en cero, descuadrando la base de la demo que debía limpiar |

**Pruebas hoy:** 512 en el API y 92 en Flutter. El detalle por suite está en la salida de `npm test`. Las del API se corrieron sobre PostgreSQL 18.6 y con el cifrado en reposo activo, igual que en CI.

**CI estaba en rojo** en `main` sin que la tabla lo dijera: el job del API aplicaba las migraciones pero no la semilla, y 12 de las 17 suites fallaban al buscar los roles del catálogo. Ahora corre `npm run seed` antes de las pruebas.

Las suites del API corren en un solo worker a propósito: escriben sobre la misma base y sobre un libro contable que es un recurso global, con transacciones SERIALIZABLE y advisory locks por fondo. En paralelo se estorban y producen fallos intermitentes, que enseñan a desconfiar de la suite en lugar de a corregir el código.

### Mejora del aplicativo por rol (octubre 2026)

La API tenía casi todo lo que el Entregable 2 pide; la aplicación no lo ofrecía. Una ONG nueva, una campaña, un operador o el sello de verificada solo podían venir de la semilla, y ninguna pantalla mostraba una sola foto o comprobante. Esta tabla cierra lo que faltaba en la interfaz; cada fila tiene su prueba.

| Tema | Estado | Prueba |
|---|---|---|
| Coherencia de roles | ✅ Solo el donante dona (`@Roles('DONANTE')`), y nunca a la ONG de la que es miembro. Causas deja de ser la primera pestaña de todos; cada rol entra a su **Inicio** | `donaciones.http.spec.ts`, `donaciones.spec.ts`, `roles_test.dart` |
| Inicio por rol | ✅ `GET /analitica/panel`: el donante ve lo aportado y lo que espera evidencia; la ONG, lo que debe justificar y lo observado; el auditor, su cola y los casos fuera de plazo; el administrador, ARCO, cola de análisis y cuentas bloqueadas. La sección de la ONG sale de la membresía, no del rol | `panel.spec.ts`, `inicio_test.dart` |
| Fotos y comprobantes por rol | ✅ El auditor ve los originales; la ONG, su comprobante y sus fotos tal como las verá el donante; el donante y el público, solo la versión publicable. La ficha de cada causa muestra «En qué se usó», con la foto de cada gasto aprobado | `gastos.spec.ts`, `retorno.spec.ts`, `evidencias_test.dart` |
| RF-04, RF-05 · Campañas y fondos | ✅ Crear, editar, publicar, pausar y cerrar desde la app, con portada. Transiciones válidas (publicada no vuelve a borrador; cerrada no cambia), `PATCH /fondos/:id` sin cambiar la categoría ni bajar la meta de lo recaudado | `campanas.spec.ts`, `campanas_test.dart` |
| CU08, CU14 · Registro y verificación de ONG | ✅ Cualquier cuenta registra una ONG; el auditor la verifica desde su bandeja con el expediente completo, y no puede verificar una de la que es miembro | `campanas.spec.ts`, `ong_test.dart` |
| Equipo de la ONG | ✅ `/ongs/:id/miembros`: el administrador agrega por correo, cambia el cargo o desactiva sin borrar; siempre queda un administrador activo | `campanas.spec.ts`, `ong_test.dart` |
| CU04, RF-08 · Donación mensual | ✅ «Cada mes» al donar; pausar, reanudar y cancelar en un toque desde Mis aportes | `donante_test.dart` |
| RF-13 · Detalle del aporte | ✅ `GET /donaciones/:id`: en qué gastos se usó cada aporte, cuánto de él en cada uno y su evidencia publicable | `donaciones.spec.ts`, `donante_test.dart` |
| RF-IA-10 · Recomendaciones | ✅ En el inicio del donante, con el motivo de cada sugerencia | `donante_test.dart` |
| CU15, CU17, RF-15 · Herramientas del auditor | ✅ Filtros por nivel y ONG, reasignar por conflicto de interés, descartar alertas con motivo, informe de la ONG y extractos CSV del libro, los gastos y la conciliación | `auditoria.spec.ts`, `auditoria_test.dart` |

Tres hallazgos de seguridad aparecieron en el camino y quedaron corregidos con su prueba:

- **Refrescar la sesión saltaba el segundo factor pendiente.** `tokens.rotar` emitía un token pleno sin mirar si la cuenta tenía MFA configurado: una recarga de página convertía un token de enrolamiento en uno pleno (`identidad.spec.ts`, `sesion_test.dart`).
- **`GET /ongs/:id/alertas` no comprobaba nada**: cualquier sesión leía lo que un auditor le había observado a cualquier ONG. Ahora exige membresía o rol de auditoría (`auditoria.spec.ts`).
- **`incluirMuestreo=false` no excluía nada**: `z.coerce.boolean()` convierte el texto `"false"` en `true` (`auditoria.spec.ts`).

### Fase 10 · Calidad y seguridad (en curso)

| Tema | Estado |
|---|---|
| RNF-19 · Cobertura ≥ 70 % en `contable` y `gastos` | ✅ Cumplida y exigida por CI. Medirla no fue un trámite: el controlador de gastos estaba en 0 % y su ruta de subida leía `req.rawBody`, que nunca se llena para `image/*`, así que **toda subida respondía "no se recibió ningún archivo"** con el archivo entero en el cuerpo. Corregido y cubierto por una prueba que sube y descarga el mismo archivo |
| RNF-03 · Control de acceso verificado (IDOR) | ✅ Un operador no puede listar ni registrar gastos de otra organización, aunque use la misma ruta y el mismo rol: lo que autoriza es la membresía |
| RNF-03 · URLs firmadas | ✅ Firma alterada, enlace vencido, ausencia de token y recorrido de directorio, los cuatro rechazados |
| RNF-03 · Revisión ASVS L2 por capítulo | ✅ [revision-asvs-l2.md](revision-asvs-l2.md). Cuatro hallazgos corregidos; el más grave era que el login admitía 7 200 intentos de contraseña por hora desde una IP, porque el límite de 120/min era global y se aplicaba igual a buscar campañas que a probar contraseñas |
| RNF-03 · Prueba de penetración independiente | ⬜ No se ha hecho. La revisión la hizo quien escribió el código, y eso es una limitación real del entregable |
| RNF-15 · WCAG 2.1 AA con NVDA | ⬜ Pendiente |
| RNF-14 · Medición SUS con usuarios reales | 🟡 El cuestionario está en la app; la sesión está planificada en [protocolo-sus.md](protocolo-sus.md) y sin realizar |
| RNF-10 · p95 de la API | 🟡 Script listo y línea base local tomada (p95 ≤ 4.3 ms). Falta medir contra el despliegue |

### Fase 11 · Despliegue y entrega (preparada)

| Pieza | Estado |
|---|---|
| `Dockerfile` de la API y de la web | ✅ Construidos y levantados. La primera vez la web no compilaba (faltaba `pubspec.lock`, que ahora se versiona), la API se caía al arrancar (cliente de Prisma generado para OpenSSL 1.1 en una imagen con OpenSSL 3) y nginx no enviaba sus cabeceras de seguridad en ningún HTML ni JS. CI las construye en cada cambio ([detalle](despliegue.md#las-imágenes-de-docker-construidas-y-probadas)) |
| `docker-compose.yml` reproducible | ✅ Levantado de punta a punta. PostgreSQL 18 no arrancaba: desde la 18 la imagen se niega a usar un volumen en `/var/lib/postgresql/data`. Puertos del anfitrión configurables (`API_PUERTO`, `WEB_PUERTO`, `BASE_PUERTO`) y servicio `respaldo` |
| [Guía de despliegue](despliegue.md) | ✅ Neon, Render y Firebase paso a paso, con lo que debe crear el responsable y lo que el despliegue no incluye |
| [Guion de demostración](guion-demo.md) | ✅ Los 10 minutos con los datos exactos que produce `seed-demo.ts` |
| Medición de p95 | ✅ Script; falta correrlo contra el despliegue |
| Tabla 19 · enlaces públicos | ⬜ Requiere las cuentas del despliegue |
| Tabla 20 · cuentas de prueba | ✅ Las cinco existen en `seed.ts`. Los cuatro roles con MFA deben enrolarse antes de la demostración |
| Video demostrativo | ⬜ Requiere el despliegue |

### Requerimientos funcionales cerrados en la Fase 9

| ID | Requerimiento | Estado |
|---|---|---|
| RF-15 | Exportación de reportes | ✅ CSV según RFC 4180 del libro, los gastos y la conciliación. El extracto incluye `hash_previo` y `hash_actual` para que un tercero recalcule la cadena por su cuenta |
| RF-CF-04 | Conciliación con reporte de diferencias | ✅ Seis comprobaciones entre fuentes escritas por caminos independientes; no recalcula desde una sola, porque entonces cuadraría siempre y no probaría nada |
| CU16 | Conciliación contable | ✅ Automática cada madrugada, forzable por el administrador. Las pruebas rompen el libro a propósito y verifican que la detecta, la nombra y reporta la diferencia |
| CU17 | Informe de auditoría de una organización | ✅ Incluye la verificación de cadena de cada fondo, las decisiones de auditoría con su comentario y el estado de verificación de la ONG |
| CU20 | Tablero de indicadores transdisciplinarios | ✅ Los de la Tabla 3. Los que no se pueden medir todavía se declaran **con su motivo** en vez de omitirse: un tablero que solo muestra lo que sabe medir sugiere que eso era todo lo que había que medir |
| RNF-07 | Verificación diaria de la cadena | ✅ Corre con la conciliación y reporta qué fondo se rompió |
| CU20 (interfaz) | Tablero de KPIs para el administrador | ✅ Estado de la conciliación primero, porque un tablero calculado sobre un libro descuadrado es una presentación y no una medición; después el movimiento del dinero con `fl_chart` y los indicadores por disciplina (`tablero_test.dart`, 4 casos) |
| RF-01 (interfaz) | Enrolamiento del segundo factor | ✅ QR más la clave escrita, que es la vía accesible y no un extra. Antes de esto, ADMIN y AUDITOR no podían completar el ingreso desde la aplicación: el sistema les exigía un segundo factor que no tenían forma de configurar |

Tres indicadores de la Tabla 3 quedaban sin valor y así se mostraban. SOC-1 y PSI-1 se miden desde la Fase 4 del plan transdisciplinario, con las encuestas de la aplicación y el umbral de publicación de D6. INF-3 sigue sin valor: mide la exactitud de una extracción automática de campos, y es del frente de IA.

### Requerimientos funcionales cerrados en la Fase 8

| ID | Requerimiento | Estado |
|---|---|---|
| RF-12 | Notificaciones | 🟡 In-app completo; el envío por correo entra con SMTP configurado ([ADR-0004](adr/0004-notificaciones-sin-push.md)) |
| RF-CO-01 | Narrativa personalizada por donante | ✅ Con monto aplicado, concepto, ONG, fecha y evidencia |
| RF-CO-02 | Biblioteca de plantillas éticas | ✅ Filtro de lenguaje tolerante a acentos y flexión de género |
| RF-PS-02 | Notificación de impacto con foto y comprobante | ✅ La evidencia solo se adjunta si está anonimizada |
| RF-PS-04 | Preferencias de frecuencia | ✅ Quien pidió resumen no recibe aviso por cada gasto |
| RF-SO-02 | Control social del donante | ✅ Reportar abre un caso de auditoría y devuelve el gasto a revisión |

### Requerimientos funcionales cerrados en la Fase 7

| ID | Requerimiento | Estado |
|---|---|---|
| RF-14 | Panel de auditoría con vista comparativa | ✅ Bandeja por antigüedad o monto, con nivel, score, SLA y alertas abiertas |
| CU11 | Subsanar alerta o justificar | ✅ Responder devuelve el gasto a análisis, no lo aprueba |
| CU15 | Revisar casos de confianza media | ✅ Comentario obligatorio; aprobar usa la misma ruta FIFO que la aprobación automática |
| RF-SO-04 | Debido proceso reputacional | ✅ Un job horario activa `afectaReputacion` solo al vencer el plazo, y nunca sobre una alerta ya respondida |

### Requerimientos funcionales cerrados en la Fase 3

| ID | Requerimiento | Estado |
|---|---|---|
| RF-03 | Registro de ONG con RUC y documentación | ✅ RUC validado por módulo 11 en el borde de la API |
| RF-04 | Gestión de campañas | ✅ Crear, editar, publicar, pausar y cerrar |
| RF-05 | Gestión de fondos con categoría y meta | ✅ Nombre único por campaña |
| RF-06 | Buscador de causas | ✅ Full-text en español (lematiza y ignora acentos), filtros por causa, departamento, puntaje y avance, con paginación |
| RF-SO-01 | Sello de ONG verificada y puntaje explicable | ✅ Tres componentes con su detalle; no castiga la falta de historial |
| RF-SO-04 | Debido proceso reputacional | ✅ El puntaje solo considera alertas con `afectaReputacion` |
| RF-DE-05 | Términos de adhesión | ✅ Obligatorios al registrar la ONG |
| CU12 | Consultar estado de fondos | ✅ Recaudado, retenido y ejecutado por fondo |
| CU14 | Verificar ONG | ✅ Motivo obligatorio incluso al aprobar, con rastro en bitácora |

### Requerimientos funcionales cerrados en la Fase 2

| ID | Requerimiento | Estado |
|---|---|---|
| RF-01 | Registro e inicio de sesión con MFA | ✅ Falta recuperación de contraseña y verificación por correo (dependen del envío de correo, Fase 8) |
| RF-02 | Gestión de roles y perfiles | ✅ Los 5 roles con guard global que niega por defecto |
| RF-DE-01 | Consentimiento por finalidad con versión de política | ✅ Otorgar y revocar; revocar conserva el registro anterior en lugar de borrarlo. La pantalla lista las tres finalidades aunque no estén otorgadas —ocultar un permiso no dado es ocultar que existe— y explica qué deja de pasar al revocar cada una |
| RF-DE-02 | Atención de derechos ARCO con registro, plazo y respuesta | ✅ Plazos en días hábiles (20 para acceso, 10 para el resto), bandeja por urgencia y marca de vencimiento. El titular presenta su solicitud y ve el plazo en días, no solo la fecha; el administrador la responde con motivo obligatorio (`privacidad_test.dart`, 6 casos) |
| RF-16 | Gestión de usuarios | ✅ Búsqueda, cambio de roles, bloqueo y restablecimiento del segundo factor, desde la API (`/identidad/usuarios`) y desde la pantalla *Usuarios* del administrador. Motivo obligatorio y en la bitácora; cada cambio cierra las sesiones de la cuenta; nadie se quita su propio acceso y siempre queda un administrador activo (`usuarios.http.spec.ts` · 26 casos, `usuarios_test.dart` · 4) |
