# Revisión OWASP ASVS nivel 2 — RNF-03

Revisión del código del API contra el *Application Security Verification Standard* v4.0.3, nivel 2. Se revisaron los capítulos que aplican a una API REST con sesión, dinero de terceros y archivos subidos por usuarios.

**Qué es y qué no es.** Es una revisión de código hecha por quien lo escribió, con pruebas automatizadas como evidencia. No es una auditoría independiente ni una prueba de penetración; ninguna de las dos se ha hecho, y eso es una limitación real de este entregable, no un trámite pendiente. Un requisito se marca cumplido solo si hay una prueba que falla cuando se rompe.

| Estado | Significado |
|---|---|
| ✅ | Implementado y con prueba que lo respalda |
| 🟡 | Implementado, sin prueba automatizada que lo fije |
| ⬜ | No implementado |
| N/A | No aplica a esta arquitectura |

---

## Hallazgos corregidos durante esta revisión

Cuatro, en orden de gravedad.

### 1. La ruta de inicio de sesión admitía 7 200 intentos de contraseña por hora

El limitador era global: 120 peticiones por minuto para toda la API, aplicado por igual a buscar campañas y a probar contraseñas. Contra una cuenta concreta, eso permite 7 200 intentos por hora desde una sola IP.

Se añadieron dos ventanas con nombre y un límite estricto en las rutas que prueban credenciales: **5 por minuto y 30 por hora** para `POST /identidad/sesion` y `POST /identidad/registro`, 20 por minuto para el canje de refresh. La ventana larga es la que importa: un ataque de credenciales no corre en ráfagas de un minuto, corre durante horas.

Referencia: ASVS V2.2.1. Prueba: `identidad.http.spec.ts` · «corta el sexto intento de inicio de sesión en un minuto», y «el límite no alcanza a las rutas de consulta», que comprueba que el límite es de la ruta y no del cliente — si no, seis peticiones bastarían para dejar la plataforma inutilizable.

### 2. La interfaz interactiva de OpenAPI se publicaba en producción

`SwaggerModule.setup('docs', …)` corría en todos los entornos. La página enumera cada ruta, cada parámetro y cada esquema: es el mapa que un atacante levantaría a mano. Ahora solo se monta fuera de producción. El documento se sigue generando siempre, porque `docs/openapi.json` forma parte del entregable (RF-IN-04).

Referencia: ASVS V14.3.3.

### 3. `CORS_ORIGENES` podía contener un comodín junto con credenciales

La API responde con `credentials: true`. Un `*` en esa lista permitiría que cualquier origen hiciera peticiones autenticadas con la cookie de la víctima. Los navegadores rechazan esa combinación, pero un cliente que no sea un navegador no, y el error habría sido silencioso. Ahora la API **no arranca** si detecta un comodín.

Referencia: ASVS V14.5.3.

### 4. Dependencias con vulnerabilidades conocidas

`sharp@0.33.5` arrastraba CVE de libvips y libheif, y es la biblioteca que procesa cada imagen que sube un usuario: la más expuesta del proyecto. Actualizada a `0.35.4`. `nodemailer` subió de 6.10 a 10.0.10 (inyección de comandos SMTP); no lo usa ningún código todavía, pero una dependencia sin usar que carga un aviso alto es exactamente lo que este capítulo persigue.

Referencia: ASVS V14.2.1. Verificación: las 281 pruebas siguen pasando con `sharp` nuevo, incluidas las de huella perceptual y nitidez, que son las que romperían ante un cambio de comportamiento.

---

## Revisión por capítulo

### V1 · Arquitectura y diseño

| Requisito | Estado | Evidencia |
|---|---|---|
| Componentes de seguridad identificados y aislados | ✅ | `AccesoGuard` como único punto de autenticación; `ZodPipe` como único punto de validación; `BitacoraService` como único punto de escritura de la bitácora |
| Decisiones documentadas | ✅ | Seis ADR en `docs/adr/`, incluidas las tres que se apartan del documento original |
| Separación de confianza entre capas | ✅ | El dominio nunca recibe datos sin validar: el esquema Zod corre en el borde, antes del servicio |

### V2 · Autenticación

| Requisito | Estado | Evidencia |
|---|---|---|
| V2.1.1 · Contraseña de 12 caracteres o más | ✅ | `identidad/esquemas.ts`: mínimo 12, mayúscula, minúscula y dígito |
| V2.2.1 · Anti-automatización en autenticación | ✅ | 5/min y 30/h por ruta (hallazgo 1) |
| V2.2.2 · Segundo factor para roles sensibles | ✅ | TOTP obligatorio para ONG, auditor y administrador; `identidad.spec.ts` · `TotpService.exigeMfa` |
| V2.4.1 · Hash de contraseña resistente | ✅ | Argon2id vía `@node-rs/argon2` |
| V2.2.1 · No enumeración de cuentas | ✅ | Correo inexistente y contraseña errónea devuelven el mismo código y el mismo texto, y se calcula un hash ficticio para que tampoco difieran en tiempo. `identidad.http.spec.ts` |
| Bloqueo de cuenta tras N fallos | ⬜ | **Decisión explícita, no olvido.** Un bloqueo por intentos fallidos permite que un tercero deje fuera a un usuario legítimo con solo conocer su correo. Se optó por limitar la tasa. La limitación honesta: el límite es por IP y no frena un ataque distribuido. Cerrarlo bien requiere detección por cuenta con notificación al titular, que no está en este alcance |

### V3 · Gestión de sesiones

| Requisito | Estado | Evidencia |
|---|---|---|
| V3.2.1 · Token generado por el servidor | ✅ | JWT de acceso de 15 minutos; refresh opaco de 48 bytes aleatorios |
| V3.4.1–3 · Cookie con `HttpOnly`, `Secure` y `SameSite` | ✅ | `httpOnly` siempre; `secure` y `SameSite=None` en producción. `identidad.http.spec.ts` comprueba que el refresh **no** aparece en el cuerpo JSON |
| V3.3.1 · Cierre de sesión revoca el token | ✅ | `TokensService.revocar` marca la sesión; `identidad.spec.ts` |
| V3.5.3 · Rotación del refresh | ✅ | Cada canje emite un par nuevo y revoca el usado; un token expirado, revocado o inexistente devuelve el mismo error, para no confirmarle a un atacante que acertó |
| Token de alcance reducido | ✅ | El token de MFA pendiente solo abre las rutas de enrolamiento. `identidad.http.spec.ts` · `/perfil` → 403, `/mfa/iniciar` → 201 |

### V4 · Control de acceso

| Requisito | Estado | Evidencia |
|---|---|---|
| V4.1.1 · Denegar por defecto | ✅ | `AccesoGuard` rechaza toda ruta sin `@Publico()`. Olvidar un decorador deja la ruta cerrada, no abierta |
| V4.1.3 · Mínimo privilegio | ✅ | `@Roles()` donde el rol basta; membresía comprobada en el servicio donde no |
| V4.2.1 · Referencias directas a objetos (IDOR) | ✅ | **El caso central.** Las rutas de gastos no llevan `@Roles` a propósito: el rol no alcanza, porque un operador puede registrar gastos pero solo los de su organización. `gastos.http.spec.ts` prueba con dos organizaciones que la misma ruta y el mismo rol dan 403 al cambiar el identificador |
| V4.3.1 · Interfaces administrativas protegidas | ✅ | `almacenamiento-estado` y los umbrales del motor exigen `ADMIN`; probado en `gastos.http.spec.ts` |

### V5 · Validación, saneamiento y codificación

| Requisito | Estado | Evidencia |
|---|---|---|
| V5.1.3 · Validación positiva de toda entrada | ✅ | `ZodPipe` en cada DTO; `gastos/esquemas.ts` al 100 % de sentencias |
| V5.3.4 · Consultas parametrizadas | ✅ | Prisma parametriza; las consultas crudas usan plantillas etiquetadas. **Ningún `$queryRawUnsafe` ni `$executeRawUnsafe` en código de producción**: el único que existe está en un ayudante de pruebas excluido del build, y su entrada es una constante |
| V5.1.4 · Rechazo de tipos inesperados | ✅ | `ParseUUIDPipe` en cada identificador; un id que no es UUID no llega al servicio |
| Reglas de negocio validadas en el borde | ✅ | El consentimiento de imagen se exige antes de que el archivo toque el disco (RF-DE-04) |

### V7 · Manejo de errores y registro

| Requisito | Estado | Evidencia |
|---|---|---|
| V7.1.1 · No registrar credenciales ni secretos | ✅ | Ninguna llamada a `logger.*` incluye clave, token, hash ni secreto |
| V7.3.1 · Registro de eventos sensibles | ✅ | `bitacora_auditoria` guarda usuario, fecha, IP, valor anterior y nuevo (RNF-08) |
| V7.4.1 · Mensajes de error sin detalle interno | ✅ | Los errores se traducen a lenguaje comprensible; el cliente nunca recibe una traza |
| Bitácora inalterable | 🟡 | Es una tabla ordinaria: un administrador de base de datos puede modificarla. El libro contable sí es insertable-solamente por trigger; la bitácora no. Es una diferencia consciente entre el dinero y el rastro |

### V8 · Protección de datos

| Requisito | Estado | Evidencia |
|---|---|---|
| V8.1.1 · Sin datos sensibles en caché del cliente | ✅ | Las descargas responden `Cache-Control: private` |
| V8.3.1 · Datos sensibles fuera de la URL | ✅ | Ningún dato personal viaja en query string; las URL firmadas llevan token y caducidad, no identidad |
| V8.2.2 · Minimización | ✅ | No se almacena ningún dato de tarjeta: solo token de la pasarela y últimos cuatro dígitos (RNF-04) |
| Cifrado en reposo | ⬜ | Diferido a la Fase 11: depende del proveedor de base de datos y de almacenamiento |

### V9 · Comunicaciones

| Requisito | Estado | Evidencia |
|---|---|---|
| V9.1.1 · TLS en todo el tráfico | ⬜ | Fase 11. En local el desarrollo es HTTP; la cookie ya exige `Secure` cuando `NODE_ENV=production` |

### V11 · Lógica de negocio

| Requisito | Estado | Evidencia |
|---|---|---|
| V11.1.1 · Secuencia de pasos respetada | ✅ | Un gasto no puede aprobarse sin análisis; el libro no admite aplicar más de lo aprobado (RN-04, por trigger) |
| V11.1.4 · Anti-automatización en operaciones de negocio | ✅ | Límite global de 120/min más los estrictos por ruta |
| Integridad de los datos financieros | ✅ | `movimientos_contables` rechaza UPDATE y DELETE; cadena SHA-256 encadenada por trigger; conciliación diaria entre fuentes independientes. `integridad.spec.ts` y `analitica.spec.ts` |
| Concurrencia sobre el mismo fondo | ✅ | Transacciones SERIALIZABLE con reintento; dos donaciones simultáneas al mismo fondo no pierden ni duplican asientos. `donaciones.spec.ts` |

### V12 · Archivos y recursos

| Requisito | Estado | Evidencia |
|---|---|---|
| V12.1.1 · Límite de tamaño | ✅ | 25 MB por subida, aplicado en el middleware y en el handler |
| V12.3.1 · Sin recorrido de rutas | ✅ | `rutaDe` normaliza, quita separadores iniciales, resuelve y comprueba que el resultado quede bajo la raíz. Probado en `gastos.spec.ts` y por HTTP en `gastos.http.spec.ts` |
| V12.4.1 · Almacenamiento fuera de la raíz web | ✅ | Los archivos se sirven por handler con firma, nunca como estáticos |
| V12.5.1 · Extensiones permitidas | 🟡 | La lista blanca es de extensión declarada, no de contenido real. Un archivo HEIC renombrado a `.jpg` lo detectaría `sharp` por su cabecera. Mitigado subiendo `sharp`, no cerrado |
| Enlaces firmados con caducidad | ✅ | Firma HMAC y vencimiento; probadas las cuatro formas de que no sirva: firma alterada, enlace vencido, sin token y recorrido de directorio |

### V13 · API y servicios web

| Requisito | Estado | Evidencia |
|---|---|---|
| V13.1.3 · Sin claves de API en la URL | ✅ | La autenticación va en cabecera `Authorization` |
| V13.2.1 · Métodos HTTP restringidos | ✅ | Cada handler declara su método; Nest devuelve 404 para el resto |
| V13.2.3 · Protección contra CSRF | ✅ | La API acepta el token en cabecera, no en cookie: un formulario de otro sitio no puede añadirla. El refresh sí va en cookie, pero `SameSite` la restringe y su rotación invalida el anterior |
| Firma de webhooks | ✅ | HMAC sobre el cuerpo crudo e idempotencia por evento; reenviar un webhook no duplica asientos |

### V14 · Configuración

| Requisito | Estado | Evidencia |
|---|---|---|
| V14.1.3 · Configuración validada al arrancar | ✅ | Zod valida todas las variables; secretos con mínimo 24 caracteres. Si falta una, la API no levanta |
| V14.2.1 · Dependencias sin vulnerabilidades conocidas | 🟡 | Ver riesgos aceptados |
| V14.3.3 · Sin información de depuración en producción | ✅ | Swagger fuera de producción (hallazgo 2) |
| V14.4.1 · Cabeceras de seguridad | ✅ | `helmet()` con su configuración por defecto |
| V14.5.3 · CORS restringido | ✅ | Lista explícita de orígenes; comodín rechazado al arrancar (hallazgo 3) |
| Secretos fuera del repositorio | ✅ | `.env` y el SQL con la contraseña del rol están en `.gitignore`, verificado antes de cada commit |

---

## Riesgos aceptados

**Cadena `@nestjs/*` → `multer`.** Ocho avisos de severidad alta cuya raíz es una denegación de servicio en el análisis de `multipart/form-data` de `multer`. **Este proyecto no usa multipart en ninguna ruta**: las subidas son un `PUT` binario contra una URL firmada, como en S3. La ruta vulnerable no es alcanzable. Cerrar el aviso exige subir a NestJS 12, un cambio de versión mayor del framework que no corresponde decidir dentro de una revisión de seguridad. Queda anotado para la Fase 11.

**`deepmerge-ts` vía `@prisma/config`.** Agotamiento de pila al fusionar objetos recursivos, en código que solo corre al leer la configuración de Prisma en tiempo de construcción, con entrada que no viene de un usuario.

---

## Lo que esta revisión no cubre

- Prueba de penetración y auditoría independiente: ninguna se ha hecho.
- V6 · Criptografía almacenada: no hay cifrado en reposo todavía (Fase 11).
- V9 · TLS: depende del despliegue.
- V10 · Código malicioso: no hay revisión de procedencia de dependencias más allá de `npm audit`.
- Configuración del proveedor en la nube: pertenece a la Fase 11.
