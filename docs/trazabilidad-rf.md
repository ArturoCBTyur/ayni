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
| RNF-01 | Cifrado en tránsito y reposo | ⬜ Fase 5/11 | TLS en despliegue; cifrado de archivos en `StorageAdapter` | — |
| RNF-02 | Autenticación robusta y RBAC | ✅ | `modules/identidad`: Argon2id, JWT corto + refresh rotativo en cookie httpOnly, TOTP obligatorio, guard global que niega por defecto | `identidad.spec.ts` · 15 casos |
| RNF-03 | OWASP ASVS nivel 2 | 🟡 | `helmet`, `ThrottlerModule` en `app.module.ts` | Falta revisión de Fase 10 |
| RNF-04 | No almacenar datos de tarjeta | ✅ | Solo token y últimos 4; la tokenización ocurre en la pasarela | `donaciones.spec.ts` |
| RNF-05 | Privacidad desde el diseño | ✅ | Consentimiento por finalidad con revocación que conserva la historia, ARCO con plazos en días hábiles y exportación de datos sin credenciales | `cumplimiento.spec.ts` · 15 casos |
| RNF-06 | Anonimización de beneficiarios | 🟡 | Difuminado manual en el servidor + trigger de la base | `imagen.spec.ts`, `gastos.spec.ts`, `integridad.spec.ts`. Automático diferido a AIni |
| RNF-07 | Libro de movimientos inalterable | ✅ | `fn_libro_solo_insercion`, `fn_movimiento_encadenar`, `fn_verificar_cadena` | `integridad.spec.ts` · 7 casos |
| RNF-08 | Bitácora de acciones sensibles | ✅ | `BitacoraService` como punto único de escritura, con comparación antes/después; registro atómico dentro de transacción donde hace falta | `identidad.spec.ts`, `cumplimiento.spec.ts` |
| RNF-09 | Explicabilidad de las decisiones | ✅ | Cada motivo dice qué regla evaluó, cómo salió y con qué valor; el análisis queda atado al motor y a la regla vigente | `reglas-v0.motor.spec.ts`, `verificacion.spec.ts` |
| RNF-10 | p95 de API bajo 500 ms lectura | ⬜ Fase 10 | — | — |
| RNF-11 | Análisis en tiempo razonable | ✅ | El motor de reglas resuelve en milisegundos; `duracionMs` se persiste en cada análisis | `verificacion.spec.ts` |
| RNF-12 | Disponibilidad 99,5 % | ⬜ Fase 11 | — | — |
| RNF-13 | Respaldo y recuperación | ⬜ Fase 11 | — | — |
| RNF-14 | Experiencia de baja fricción | 🟡 | Área de toque 48 dp en `TemaApp` | Falta medición SUS de Fase 10 |
| RNF-15 | Accesibilidad WCAG 2.1 AA | 🟡 | Contraste y toque en `TemaApp` | **Riesgo conocido**, ver ADR-0001 |
| RNF-16 | Operación con conectividad limitada | 🟡 | El backend conserva la hora original de captura al sincronizar | `gastos.spec.ts`. Falta la cola offline en Flutter |
| RNF-17 | Multiplataforma real | 🟡 | Flutter web + Android + iOS habilitados | `flutter build web` en CI |
| RNF-18 | Escalabilidad sin rediseño | 🟡 | Servicios sin estado; cola desacoplada | — |
| RNF-19 | Cobertura ≥ 70 % en contable y gastos | 🟡 | Umbral activo en `jest.config.js` | Se hace exigible al existir los módulos |
| RNF-20 | Español peruano y soles | 🟡 | `Config.locale`, `monedaSimbolo` | — |
| RNF-21 | Narrativas veraces | ✅ | Un Proxy hace fallar cualquier plantilla que referencie un dato no verificado; el filtro de lenguaje corre sobre toda la biblioteca en las pruebas | `retorno.spec.ts` · 5 casos |

## Reglas de negocio del Entregable 2

| ID | Regla | Estado | Prueba |
|---|---|---|---|
| RN-01 | Toda donación pertenece a un único fondo | ✅ | `integridad.spec.ts` · "pertenece a otro fondo" |
| RN-02 | La comisión se registra como movimiento separado | ✅ | `donaciones.spec.ts` |
| RN-03 | Los movimientos no se editan ni eliminan | ✅ | `integridad.spec.ts` · 3 casos |
| RN-04 | La suma aplicada iguala el monto aprobado | ✅ | `integridad.spec.ts` · "no iguala el monto aprobado" |
| RN-05 | Toda evidencia con rostros se anonimiza | ✅ | `integridad.spec.ts` · 2 casos de privacidad |
| RN-06 | El nivel se calcula con la regla vigente y queda registrado | ✅ | `verificacion.spec.ts` · cambiar umbrales no reescribe análisis anteriores |
| RN-07 | Resolución de auditoría en 48 h hábiles | ✅ | `auditoria.spec.ts` · el SLA cuenta horas hábiles saltando fines de semana |
| RN-08 | Muestreo de casos ALTO | ✅ | 10 % de los aprobados automáticamente; alimenta el indicador de falsos aprobados |

## Requerimientos funcionales de AIni — sustituciones sin IA

El detalle del criterio está en [ADR-0005](adr/0005-motor-reglas-v0.md).

| ID | Requerimiento | Estado en v1 |
|---|---|---|
| RF-IA-01 | Difuminado automático de rostros | ⏸️ Se sustituye por difuminado **manual** con declaración obligatoria. La restricción de BD que protege al beneficiario sigue activa e igual de estricta |
| RF-IA-02 | Extracción OCR de campos | ⏸️ Se sustituye por captura manual con validación de formato y aritmética |
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
| 9 a 11 | ⬜ Planificadas |

**Pruebas hoy:** 239 en el API y 2 de widgets en Flutter. El detalle por suite está en la salida de `npm test`.

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
| RF-DE-01 | Consentimiento por finalidad con versión de política | ✅ Otorgar y revocar; revocar conserva el registro anterior en lugar de borrarlo |
| RF-DE-02 | Atención de derechos ARCO con registro, plazo y respuesta | ✅ Plazos en días hábiles (20 para acceso, 10 para el resto), bandeja por urgencia y marca de vencimiento |
| RF-16 | Gestión de usuarios | 🟡 Roles y bloqueo cubiertos; falta la administración desde la interfaz |
