# Especificación técnica y guía de avance del proyecto

**Avance del Examen Parcial — Curso de Inteligencia Artificial**
**Ayni: plataforma web de micro-mecenazgo con trazabilidad total e integración de IA**
*(Opción 1 — Enfoque Ligero API)*

| | |
|---|---|
| **Curso** | Inteligencia Artificial |
| **Docente** | Dr. Abimael Adam Francisco Paredes |
| **Integrantes** | Nieves Quiñonez, Nicol Tamara<br>Bonilla Malpartida, Yvan Hawel<br>Caldas Bahamonde, Arturo Jesús |
| **Evaluación** | Avance de Examen Parcial |
| **Arquitectura target** | Opción 1 — API SaaS (Backend + PostgreSQL + LLM API) |
| **Proyecto académico** | Trazabilidad Radical (Entregable 2) |
| **Aplicación** | Ayni |
| **Fecha** | Semestre Académico 2026-II |

> **Nota sobre el estado de la implementación.** El aplicativo web está construido y funcionando: 281 pruebas automatizadas en el backend, 20 en el frontend, ciclo completo de donación → retención → gasto → verificación → aplicación contable → narrativa al donante. La **capa de IA está diseñada, contratada y con su punto de integración construido y probado**, pero la versión actual la resuelve con un motor determinista. La sección 3 distingue con precisión qué está implementado y qué requiere conectar la API externa. La sección 7 detalla lo que falta.

---

## 1. Definición del problema complejo

El micro-mecenazgo digital en el Perú opera sobre una asimetría de información que ningún actor puede resolver por sí solo: **quien dona no tiene forma de verificar en qué se gastó su dinero, y quien recibe no tiene forma barata de demostrarlo.** La consecuencia no es solo el fraude, sino algo más extendido y más difícil de medir: la desconfianza que impide donar a organizaciones honestas.

Tres problemas complejos fundamentales que el sistema resuelve:

- **Opacidad del destino final del aporte.** El donante entrega dinero a una organización, no a un propósito. Una vez transferido, el sol se mezcla con los demás y su destino se vuelve irrastreable. Los informes de impacto que recibe son agregados, narrativos y no verificables: dicen «ayudamos a 300 familias», no «sus S/ 50 pagaron esta factura». La confianza se pide, no se demuestra.

- **Costo prohibitivo de la rendición de cuentas para las organizaciones pequeñas.** Una ONG que quiere ser transparente debe digitalizar comprobantes, vincularlos a gastos, verificar su validez tributaria, anonimizar a los beneficiarios que aparecen en las fotos y comunicar todo esto de forma comprensible. Hacerlo a mano consume el tiempo del personal que debería estar operando en campo. Las organizaciones más honestas y más pequeñas son las que menos pueden pagar el costo de demostrarlo.

- **Verificación humana que no escala y llega tarde.** Auditar cada gasto con comprobante y evidencia visual exige un criterio experto que es caro y lento. Sin apoyo automatizado, o se revisa todo —y el sistema se atasca— o se revisa por muestreo —y la garantía se debilita justo donde más importa—. El problema se agrava porque las señales de irregularidad son heterogéneas: un comprobante mal formado, una foto reutilizada de otro gasto, un monto fuera de lo habitual para esa categoría.

**Por qué es un problema complejo y no complicado.** No tiene una solución técnica única y cerrada: involucra derecho (Ley N.° 29733 de protección de datos y normativa tributaria de comprobantes de pago), contabilidad (partida doble, trazabilidad a nivel de unidad monetaria), psicología del donante (fatiga comunicacional, fricción de uso), sociología de la confianza institucional e informática. Cada disciplina impone restricciones que las demás no pueden ignorar, y la solución debe satisfacerlas simultáneamente.

---

## 2. Definición del aplicativo web básico

Aplicación web modular con backend de API REST y frontend compilado, diseñada para operar bajo un modelo de proveedor de servicios externo para las capacidades de IA.

| Capa de arquitectura | Tecnología seleccionada | Rol en el sistema |
|---|---|---|
| **Frontend (interfaz)** | Flutter Web 3.47 (Dart 3.13), Riverpod 3, `fl_chart` | Interfaz única para los cinco roles: donante, administrador de ONG, operador de campo, auditor y administrador de plataforma. Captura de eventos, consultas asíncronas y renderizado dinámico. El mismo código base compila a Android e iOS sin reescritura. |
| **Backend (lógica)** | NestJS 11 sobre Node.js 22 (TypeScript) | Procesamiento de la lógica de negocio, autenticación con JWT y segundo factor, núcleo contable transaccional, orquestación de consultas y **comunicación HTTPS con la API de IA externa**. Actúa como proxy seguro: la clave de la API nunca llega al navegador. |
| **Base de datos** | PostgreSQL 18 | Almacenamiento relacional de usuarios, organizaciones, campañas, fondos, donaciones, gastos, comprobantes, evidencias e **historial completo de análisis de IA**. Integridad garantizada por triggers, no solo por la aplicación. |
| **Almacenamiento de archivos** | Adaptador `AlmacenamientoArchivos` (disco local en desarrollo, S3 en despliegue) | Comprobantes y evidencias fotográficas, servidos mediante URL firmadas con caducidad. |

> **Desviación declarada respecto del formato.** El formato de referencia propone PHP como capa de backend. Este proyecto usa NestJS/TypeScript. La decisión es anterior a este avance y está documentada en el Entregable 2 y en los ADR del repositorio. **El patrón arquitectónico de la Opción 1 se cumple íntegramente**: el backend actúa como intermediario seguro que custodia las credenciales, consolida el contexto desde PostgreSQL, construye el prompt, consume la API externa por HTTPS y persiste la traza. Lo que cambia es el lenguaje de esa capa, no su función ni su responsabilidad.

---

## 3. Caracterización de requerimientos funcionales con IA (3 funciones)

Las tres funciones de IA cubren los tres procesos que el formato distingue: **operativo**, **comercial/comunicacional** y **servicio al cliente**.

### RF-IA-01 · Verificación automática de gastos (proceso operativo)

- **Descripción.** Analiza el comprobante de pago y la evidencia fotográfica de cada gasto declarado por una ONG y emite un **puntaje de confianza de 0 a 100**, un nivel (ALTO / MEDIO / BAJO) y una **explicación legible en español** de cada señal evaluada. El nivel determina el flujo: ALTO se aprueba automáticamente, MEDIO deriva a revisión humana, BAJO se observa y genera alerta.

- **Subproceso / actividades.** Al registrarse un gasto, el backend encola el trabajo de verificación en PostgreSQL. Un trabajador consume la cola, recopila el contexto (datos declarados, hashes de los archivos, historial de la organización, media y desviación de la categoría), lo ensambla en un prompt estructurado junto con las imágenes, y lo envía a la API de IA. La respuesta llega en **JSON validado contra un esquema** con los campos `score_documental`, `score_visual`, `score_anomalia`, `score_final`, `nivel`, `datos_extraidos`, `explicacion[]`, `alertas[]` y `version_modelo`. El resultado íntegro se persiste en la tabla `analisis_aini`.

- **Componente IA.** Modelo multimodal con capacidad de lectura de documentos (OCR de comprobante) y evaluación de coherencia visual, en modo JSON estructurado.

- **Estado.** ⚠️ **El punto de integración está construido y probado; falta conectar la API externa.** Existe la interfaz `MotorVerificacion` con el contrato de datos completo, la cola, el trabajador, la persistencia, la regla de umbrales y la derivación al auditor. Hoy lo resuelve `MotorReglasV0`, un motor determinista (dígito verificador del RUC por módulo 11, aritmética del IGV, huella perceptual dHash contra todo el histórico, desviación estadística del monto). Conectar la IA consiste en implementar la misma interfaz y cambiar una variable de entorno.

### RF-IA-02 · Generación de narrativa de impacto personalizada (proceso comunicacional)

- **Descripción.** Cuando un gasto se aprueba y se aplica contablemente a las donaciones que lo financiaron, genera para **cada donante afectado** un mensaje con su monto exacto aplicado, el concepto real del gasto, la organización, la fecha y la evidencia anonimizada. El texto se adapta al aporte concreto de esa persona, no al total del gasto.

- **Subproceso / actividades.** El motor de retorno consulta la aplicación FIFO para saber qué donación financió qué parte del gasto, extrae de PostgreSQL los datos verificados y construye un prompt que **solo contiene campos verificados**, con instrucciones explícitas de no inferir ni embellecer. La IA devuelve asunto y cuerpo; el backend los valida contra un filtro de lenguaje antes de enviarlos.

- **Componente IA.** Modelo de lenguaje generativo con *system prompt* restringido y validación de salida.

- **Estado.** ⚠️ **Implementado con plantillas, sin IA.** El ciclo completo funciona: una notificación por donante con su monto exacto, un `Proxy` que hace fallar cualquier plantilla que referencie un dato no verificado, y un filtro de lenguaje ético tolerante a acentos y flexión de género que rechaza términos como «héroe» o «desgarradora». Sustituir la plantilla por una llamada al modelo requiere conservar esas dos validaciones, que son las que impiden que el sistema afirme algo que no puede demostrar.

### RF-IA-03 · Asistente de transparencia para el donante (servicio al cliente)

- **Descripción.** Chat integrado en la interfaz del donante que responde preguntas sobre **sus propios aportes**: en qué se gastó su dinero, en qué estado está, por qué sigue retenido, qué respaldo documental existe. También resuelve dudas generales sobre el funcionamiento de la plataforma.

- **Subproceso / actividades.** El donante escribe desde el widget de chat. El frontend Flutter envía la consulta al backend, que **recupera exclusivamente los datos del donante autenticado** (sus donaciones, aplicaciones, gastos financiados y estado de cada uno), inyecta un *system prompt* con las políticas de la plataforma y las restricciones de privacidad, y llama a la API externa. La respuesta se devuelve al frontend para renderizarse en la burbuja de conversación.

- **Componente IA.** Modelo conversacional con *system prompt* delimitado y contexto acotado al usuario en sesión (*guardrails* de contexto y de privacidad).

- **Estado.** ⬜ **No implementado.** Es la función que requiere más trabajo nuevo: no existe el módulo de chat ni en backend ni en frontend. Los datos que necesita sí existen y están expuestos (línea de tiempo del aporte, narrativas, aplicaciones FIFO).

> **Restricción de privacidad que condiciona las tres funciones.** El sistema trata datos de beneficiarios de programas sociales, categoría sensible bajo la Ley N.° 29733. Ninguna evidencia fotográfica en la que aparezcan personas puede enviarse a un tercero —incluida la API de IA— sin anonimizar. Esa restricción está implementada **en la base de datos mediante un trigger**, no en la aplicación, de modo que ningún error de programación pueda eludirla.

---

## 4. Diagrama de base de datos relacional (PostgreSQL)

El esquema completo tiene **28 tablas de dominio en cinco dominios** (29 en `public`, contando la tabla de control de migraciones de Prisma). Se detallan las que sostienen la operación básica y las que almacenan las trazas generadas por la IA.

### Dominio operativo

| Tabla | Campos clave / atributos | Relación / descripción |
|---|---|---|
| `usuarios` | `id` (PK), `correo`, `hash_password`, `totp_secreto`, `estado` | 1 a N con `ong_miembros` y `donantes`. Cinco roles vía `usuario_roles`. |
| `ongs` | `id` (PK), `ruc`, `razon_social`, `estado_verificacion`, `puntaje_confianza` | 1 a N con `campanas`. El puntaje es público y explicable. |
| `campanas` | `id` (PK), `ong_id` (FK), `titulo`, `slug`, `causa`, `busqueda` (tsvector) | 1 a N con `fondos`. Búsqueda full-text en español. |
| `fondos` | `id` (PK), `campana_id` (FK), `categoria_gasto`, `meta`, `saldo_recaudado`, `saldo_retenido`, `saldo_ejecutado` | **Unidad de trazabilidad.** El donante aporta a un fondo, no a una organización. |
| `donaciones` | `id` (PK), `donante_id` (FK), `fondo_id` (FK), `monto`, `estado` | 1 a N con `aplicaciones_donacion`. |
| `gastos` | `id` (PK), `fondo_id` (FK), `ong_id` (FK), `monto_declarado`, `monto_aprobado`, `estado`, `capturado_en` | 1 a 1 con `comprobantes`, 1 a N con `evidencias`. |
| `comprobantes` | `id` (PK), `gasto_id` (FK), `ruc_emisor`, `tipo`, `serie`, `numero`, `subtotal`, `igv`, `total`, `validez_cpe` | **`UNIQUE (ruc_emisor, tipo, serie, numero)`**: un comprobante no puede presentarse dos veces. |
| `evidencias` | `id` (PK), `gasto_id` (FK), `hash_sha256`, `hash_perceptual`, `nitidez`, `contiene_personas`, `anonimizada` | `UNIQUE (hash_sha256)`. El hash perceptual detecta fotos recicladas aunque el archivo cambie. |

### Dominio contable

| Tabla | Campos clave / atributos | Relación / descripción |
|---|---|---|
| `movimientos_contables` | `id` (PK), `fondo_id` (FK), `secuencia`, `tipo`, `cuenta_debe`, `cuenta_haber`, `monto`, **`hash_previo`**, **`hash_actual`** | **Libro de solo inserción.** Triggers rechazan `UPDATE` y `DELETE`. Cada asiento se encadena: `hash_actual = SHA-256(hash_previo ‖ datos)`. Un tercero puede recalcular la cadena sin confiar en el sistema. |
| `aplicaciones_donacion` | `id` (PK), `donacion_id` (FK), `gasto_id` (FK), `monto` | N a M entre donaciones y gastos. Un trigger diferido exige que la suma aplicada **iguale** el monto aprobado. |

### Dominio de inteligencia artificial

Es el que el formato destaca con `ia_log`. Aquí se descompone en cuatro tablas porque la trazabilidad del proyecto lo exige:

| Tabla | Campos clave / atributos | Relación / descripción |
|---|---|---|
| `modelos_ia` | `id` (PK), `nombre`, `version`, `activo`, `descripcion` | Catálogo de motores. La fila activa hoy es `reglas-v0`; al conectar la API externa se inserta una fila nueva y se comparan métricas contra ella. |
| `reglas_confianza` | `id` (PK), `umbral_alto`, `umbral_medio`, `peso_documental`, `peso_visual`, `peso_anomalia`, `vigente_desde` | Umbrales y pesos configurables por el administrador. **Versionados**: cambiar un umbral no reescribe análisis anteriores. |
| `analisis_aini` | `id` (PK), `gasto_id` (FK), `modelo_id` (FK), `regla_id` (FK), `score_documental`, `score_visual`, `score_anomalia`, `score_final`, `nivel`, **`datos_extraidos` (JSONB)**, **`explicacion` (JSONB)**, `duracion_ms` | **Equivalente ampliado del `ia_log`.** Guarda la respuesta íntegra del modelo, atada al motor y a la regla vigente en ese momento. |
| `revisiones_auditoria` | `id` (PK), `gasto_id` (FK), `auditor_id` (FK), `decision`, `comentario`, `es_muestreo` | Decisión humana con comentario obligatorio. **Cada fila es una etiqueta supervisada**: la versión actual sin IA ya está generando el conjunto de datos con el que se evaluará y ajustará el modelo. |

---

## 5. Procedimiento detallado de integración (API externa)

Flujo de integración técnica bajo el Enfoque Ligero, en cinco etapas secuenciales:

- **Paso 1 · Configuración de credenciales y entorno.** Se genera una API Key en el proveedor. Se almacena como variable de entorno del servidor (`AINI_API_KEY`), validada al arrancar por un esquema Zod que exige longitud mínima y **hace fallar el arranque si falta**. La clave nunca se compila en el paquete Flutter ni viaja al navegador: el frontend solo conoce la URL del backend propio.

- **Paso 2 · Extracción de contexto local (SQL).** Al consumirse un trabajo de la cola, el backend ejecuta consultas a PostgreSQL para reunir: datos declarados del gasto, hashes y metadatos de los archivos, historial de comprobantes de esa organización, media y desviación estándar de la categoría del fondo, y saldo retenido disponible. Es el mismo contexto que hoy alimenta al motor determinista.

- **Paso 3 · Construcción y delimitación del prompt (system prompting).** El backend arma la estructura con: **(a)** el rol del modelo —auditor documental, no asistente creativo—; **(b)** reglas operativas estrictas, incluida la prohibición de inferir datos ausentes; **(c)** el contexto extraído de PostgreSQL; y **(d)** el formato de salida obligatorio, que es el contrato de datos de la sección 7.4 del Entregable 2. Las evidencias con personas solo se envían en su versión anonimizada.

- **Paso 4 · Consumo REST/HTTPS.** Solicitud `POST` asíncrona hacia la API externa con el payload JSON y autenticación por *Bearer token*, con tiempo límite explícito y reintentos con retroceso exponencial gestionados por la cola.

- **Paso 5 · Validación, almacenamiento y renderizado.** El backend recibe la respuesta, **valida su estructura contra el esquema antes de confiar en ella**, persiste el análisis completo en `analisis_aini` junto con `version_modelo` y la regla vigente, aplica la regla de umbrales para decidir el flujo del gasto, y expone el resultado al frontend, que lo renderiza con el puntaje, el nivel y los motivos legibles.

> **Control de excepciones.** Si la API externa falla, agota el tiempo o devuelve una estructura inválida, el sistema **no se detiene**: la cola reintenta con retroceso y, agotados los intentos, el gasto queda en revisión humana. El motor determinista permanece disponible como respaldo conmutable por variable de entorno. Un gasto nunca se aprueba por un error de la IA, y nunca se pierde por su caída.

---

## 6. Explicación del funcionamiento arquitectónico (backend y frontend)

### Flujo operativo en el backend (NestJS + PostgreSQL)

1. **Custodia de seguridad.** El backend es el único que conoce la API Key. Actúa como proxy: el navegador jamás la recibe. La autenticación usa token de acceso corto en memoria y token de refresco en cookie `httpOnly`, con segundo factor obligatorio para los roles que mueven dinero o aprueban gastos.

2. **Consolidación de contexto.** Transforma los datos relacionales planos en objetos estructurados aptos para el consumo del modelo, incluyendo agregados que la IA no podría calcular por sí sola (media histórica de la categoría, distancia de Hamming contra el histórico de evidencias, saldo retenido disponible).

3. **Control de excepciones.** Captura latencia, caída o respuesta malformada y devuelve un comportamiento por defecto —derivar a revisión humana— que garantiza que la plataforma siga operando.

4. **Integridad que no depende de la aplicación.** El libro contable rechaza modificaciones por *trigger*; la suma aplicada debe igualar el monto aprobado; una notificación no puede referenciar una evidencia sin anonimizar. **Ningún error de la IA ni del backend puede violar estas reglas**, porque no viven en el código de la aplicación.

### Flujo operativo en el frontend (Flutter Web)

1. **Eventos de usuario.** Captura las acciones de la interfaz: registrar un gasto con su comprobante y evidencia, aprobar u observar desde la bandeja del auditor, consultar el detalle de un aporte.

2. **Consultas asíncronas.** Peticiones HTTP no bloqueantes hacia las rutas del backend mediante `dio`, con el token de acceso en cabecera y manejo de errores traducidos a lenguaje comprensible.

3. **Renderizado dinámico.** Muestra el puntaje de confianza con su nivel y los motivos legibles, la línea de tiempo del aporte (Donado → Retenido → En verificación → Ejecutado), el tablero de indicadores con gráficos, y la narrativa de impacto con su evidencia.

4. **Accesibilidad declarada.** El lienzo de Flutter Web no expone sus elementos al lector de pantalla hasta que se activa el modo accesible. Por eso las cifras de los gráficos se repiten como texto y el código QR del segundo factor viene acompañado de la clave escrita.

---

## 7. Estado frente al requisito evaluativo

> *«Los alumnos deberán presentar la ejecución funcional de estos 6 puntos en el aplicativo web, demostrando que al menos las 3 funciones de IA consumen la API externa y reflejan los datos dinámicamente en la interfaz.»*

Este avance declara con precisión dónde está el proyecto respecto de ese requisito.

| Punto | Estado |
|---|---|
| 1 · Problema complejo | ✅ Definido y sustentado en el Entregable 2 |
| 2 · Aplicativo web básico | ✅ **Construido y funcionando.** 281 pruebas en backend, 20 en frontend, cinco roles operativos |
| 3 · Tres funciones con IA | ⚠️ **Diseñadas y contratadas; ninguna consume todavía la API externa** |
| 4 · Base de datos relacional | ✅ 28 tablas de dominio desplegadas, con las cuatro tablas de traza de IA creadas y en uso |
| 5 · Procedimiento de integración | ✅ Definido; el punto de integración está construido y probado |
| 6 · Funcionamiento arquitectónico | ✅ Backend y frontend operativos, con control de excepciones |

**Lo que falta, dicho sin rodeos.** Las tres funciones de IA no consumen todavía una API externa. La versión actual resuelve la verificación con un motor determinista y la narrativa con plantillas, y el asistente conversacional no existe. Esto no es un retraso imprevisto: **fue una decisión de diseño explícita** para construir primero el ciclo de confianza completo y verificable, y conectar la IA sobre una base que ya funciona.

**Lo que esa decisión hizo posible.** Existe la interfaz `MotorVerificacion` con el contrato de datos literal que consumirá el modelo, la cola asíncrona con reintentos, la persistencia versionada del análisis, la regla de umbrales, la derivación al auditor y el registro de cada decisión humana. Conectar RF-IA-01 consiste en implementar una interfaz existente y cambiar una variable de entorno —sin tocar la base de datos, el núcleo contable ni el frontend—.

Y hay un efecto que conviene subrayar: como cada decisión de auditor se guarda en `revisiones_auditoria` con su comentario y el nivel que el motor había propuesto, **la versión sin IA lleva meses generando el conjunto de datos etiquetado con el que se evaluará el modelo**. Es la diferencia entre conectar una API a ciegas y conectarla teniendo contra qué compararla.

**Trabajo restante estimado para cumplir el requisito:**

| Función | Trabajo | Dificultad |
|---|---|---|
| RF-IA-01 · Verificación | Implementar `MotorAIni` contra la interfaz existente; cliente HTTP, prompt, validación de esquema | Baja — el andamiaje está construido |
| RF-IA-02 · Narrativa | Sustituir la plantilla por llamada al modelo, conservando el filtro ético y la validación de datos verificados | Baja |
| RF-IA-03 · Asistente | Módulo nuevo en backend y widget de chat en frontend | Media — es la única sin base previa |

---

## Anexos y evidencia

| Documento | Contenido |
|---|---|
| [`trazabilidad-rf.md`](trazabilidad-rf.md) | Matriz de trazabilidad: cada RF y RNF con su módulo, endpoint y la prueba que lo demuestra |
| [`revision-asvs-l2.md`](revision-asvs-l2.md) | Revisión OWASP ASVS nivel 2, capítulo por capítulo |
| [`guion-demo.md`](guion-demo.md) | Recorrido de demostración de 10 minutos con los cinco roles |
| [`despliegue.md`](despliegue.md) | Guía de despliegue y lo que el sistema no incluye |
| [`adr/`](adr/) | Seis decisiones de arquitectura documentadas, incluida [ADR-0005](adr/0005-motor-reglas-v0.md) sobre el motor determinista |
| `openapi.json` | Documentación OpenAPI de la API, generada del código |
