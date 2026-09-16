# Despliegue — Fase 11

Guía para poner la plataforma en línea y completar la Tabla 19 del Entregable 2.

Todo lo que no depende de una cuenta ajena está listo en el repositorio: `Dockerfile` para la API y para la web, `docker-compose.yml` reproducible, migraciones, semillas y el script de medición de latencia. Lo que falta son las cuentas y los secretos, que solo puede crear quien va a ser dueño del despliegue.

---

## Antes de nada: lo que tienes que crear tú

No lo puedo hacer por ti, y tampoco deberías dármelo. Son cuentas a tu nombre y credenciales que no necesito ver para que el despliegue funcione.

| Qué | Dónde | Para qué | Plan gratuito alcanza |
|---|---|---|---|
| Base de datos PostgreSQL | [neon.tech](https://neon.tech) | Base de producción | Sí (0.5 GB) |
| Servicio web con Docker | [render.com](https://render.com) | La API | Sí, con suspensión por inactividad |
| Hosting estático | [firebase.google.com](https://firebase.google.com) o [netlify.com](https://netlify.com) | La aplicación Flutter Web | Sí |
| Repositorio remoto | [github.com](https://github.com) | Código y despliegue continuo | Sí |

**Sobre la suspensión de Render.** El plan gratuito apaga el servicio tras 15 minutos sin tráfico, y la siguiente petición tarda entre 30 y 60 segundos en responder mientras arranca. Para una demostración en vivo eso es fatal: conviene abrir la URL cinco minutos antes de empezar. También distorsiona la medición de p95 del RNF-10, así que el número hay que tomarlo con el servicio ya caliente y decirlo en el informe.

---

## Paso 1 · Generar los secretos

Cinco valores aleatorios, uno por variable. **No reutilices el mismo para dos.** Si un secreto se filtra, que comprometa una cosa y no cinco:

```bash
for n in JWT_ACCESS_SECRET JWT_REFRESH_SECRET COOKIE_SECRET STORAGE_URL_SECRET PASARELA_WEBHOOK_SECRET; do echo "$n=$(openssl rand -base64 36)"; done
```

Guárdalos en el gestor de secretos del proveedor, nunca en el repositorio. La API valida al arrancar que cada uno tenga al menos 24 caracteres y **no levanta** si falta alguno: es preferible fallar al inicio que a mitad de una transacción contable.

---

## Paso 2 · La base de datos

1. Crea un proyecto en Neon, región **South America (São Paulo)** si está disponible: es la más cercana a Perú y la distancia a la base es lo que más pesa en la latencia de cada petición.
2. Copia la cadena de conexión. Debe incluir `?sslmode=require`.
3. Aplica el esquema y las semillas desde tu máquina:

```bash
cd apps/api
DATABASE_URL="postgresql://...neon.tech/...?sslmode=require" npx prisma migrate deploy
```

```bash
cd apps/api
DATABASE_URL="postgresql://...neon.tech/...?sslmode=require" npx tsx prisma/seed.ts
```

`seed.ts` crea los roles, las reglas de confianza, la ONG de demostración y las cinco cuentas de la Tabla 20. `seed-demo.ts` añade el recorrido completo del guion (donaciones, gastos y narrativas) y es el que conviene para la demostración.

**Por qué las migraciones no corren solas al arrancar el contenedor.** Un contenedor que migra al levantarse convierte cada reinicio y cada réplica en una carrera sobre el esquema. Sobre un libro contable con triggers de integridad eso no es aceptable, así que `prisma migrate deploy` es un paso explícito y deliberado.

---

## Paso 3 · La API en Render

Servicio nuevo → **Web Service** → conectar el repositorio de GitHub.

| Campo | Valor |
|---|---|
| Runtime | Docker |
| Dockerfile Path | `apps/api/Dockerfile` |
| Docker Context | `apps/api` |
| Health Check Path | `/api/v1/salud` |

Variables de entorno:

```
NODE_ENV=production
PORT=3000
API_PREFIX=api/v1
DATABASE_URL=<la cadena de Neon, con sslmode=require>
JWT_ACCESS_SECRET=<generado>
JWT_ACCESS_TTL=900
JWT_REFRESH_SECRET=<generado>
JWT_REFRESH_TTL=604800
COOKIE_SECRET=<generado>
STORAGE_URL_SECRET=<generado>
PASARELA_WEBHOOK_SECRET=<generado>
CORS_ORIGENES=https://<tu-dominio-web>
PASARELA_WEBHOOK_URL=https://<tu-api>.onrender.com/api/v1/webhooks/pasarela
STORAGE_DRIVER=disco
STORAGE_DIR=/app/storage
PASARELA_DRIVER=fake
CPE_DRIVER=fake
VERIFICACION_DRIVER=reglas-v0
TOTP_EMISOR=Ayni
```

Tres avisos que evitan errores caros:

- **`CORS_ORIGENES` sin comodín.** La API responde con credenciales y arranca con error si detecta un `*`. Es deliberado: un comodín permitiría a cualquier origen usar la cookie de sesión de la víctima.
- **`STORAGE_DRIVER=disco` con el disco efímero de Render pierde los archivos en cada reinicio.** Para la demostración alcanza si se siembra después de desplegar. Para conservarlos hay que añadir un disco persistente de Render o implementar `S3Storage`, que ya tiene su interfaz lista (ADR-0003).
- **`NODE_ENV=production` apaga la interfaz de OpenAPI.** El documento sigue en `docs/openapi.json`; lo que no se publica es la página interactiva, que enumera cada ruta y cada esquema.

---

## Paso 4 · La aplicación web

La URL de la API se compila dentro del paquete, así que hay que construir **después** de conocerla:

```bash
cd apps/app
flutter build web --release --dart-define=API_BASE_URL=https://<tu-api>.onrender.com/api/v1
```

Con Firebase Hosting:

```bash
npx firebase-tools login
```

```bash
cd apps/app && npx firebase-tools init hosting
```

Al preguntar por el directorio público responde `build/web` y **sí** a «configure as a single-page app»: sin eso, recargar el navegador en `/causas` da 404, que es el error más común al desplegar una aplicación de este tipo.

```bash
cd apps/app && npx firebase-tools deploy --only hosting
```

Con Netlify sirve `netlify deploy --dir=build/web --prod`, y la redirección a `index.html` se configura en su panel.

Cuando tengas el dominio final, vuelve a Render y ajusta `CORS_ORIGENES`.

---

## Paso 5 · Comprobar que quedó bien

```bash
curl https://<tu-api>.onrender.com/api/v1/salud
```

Debe responder `"conectada": true` y la versión de PostgreSQL.

```bash
cd apps/api && npm run medir:latencia -- --url=https://<tu-api>.onrender.com/api/v1
```

Este es el número que responde el **RNF-10**, no el de localhost. Con el servicio ya caliente: si el primer intento sale en decenas de segundos, es el arranque en frío y hay que repetir.

Y el recorrido completo: abre la web, entra con `donante@demo.pe`, dona, entra con `ong.operador@demo.pe`, registra un gasto, entra con `auditor@demo.pe`, apruébalo, y vuelve al donante a ver su narrativa. Es el guion de [guion-demo.md](guion-demo.md).

---

## Entorno completo en local, sin instalar nada

Para quien revise el proyecto y no quiera instalar PostgreSQL, Node ni Flutter:

```bash
docker compose up --build
```

El servicio `migraciones` aplica el esquema y las semillas antes de que la API arranque, y termina. Para el escenario completo del guion:

```bash
docker compose run --rm migraciones npx tsx prisma/seed-demo.ts
```

La web queda en `http://localhost:8080` y la API en `http://localhost:3000`. El desarrollo del día a día no usa esto: es más rápido con el PostgreSQL nativo y `npm run dev`.

> **Por qué las migraciones corren en un servicio aparte.** El CLI de Prisma es una dependencia de desarrollo y la imagen de producción la omite a propósito: un contenedor que sirve peticiones no tiene por qué poder alterar el esquema. El servicio `migraciones` usa la etapa de construcción de la misma imagen, que sí lo trae.

---

## Advertencia sobre las imágenes de Docker

**Los dos `Dockerfile` y el `docker-compose.yml` no se han construido.** La máquina donde se desarrolló el proyecto no tiene Docker instalado, así que están escritos y revisados pero no ejecutados. Se cuidaron los errores conocidos —`.dockerignore` para que los `node_modules` de Windows no entren en una imagen Debian, imagen con glibc porque `sharp` y `argon2` traen binarios precompilados que no existen para musl, versión de Flutter fijada, redirección a `index.html` para el enrutamiento del cliente—, pero conviene correr `docker compose up --build` una vez antes de depender de ellos para una entrega.

Nada del despliegue en Render depende de que el compose funcione: Render construye directamente desde `apps/api/Dockerfile`.

---

## Tabla 19 — enlaces por completar

Cuando termines, estos son los tres que el entregable pide:

| Recurso | Enlace |
|---|---|
| Aplicativo web desplegado | `https://______` |
| API y documentación | `https://______/api/v1/salud` |
| Repositorio de código | `https://github.com/______` |

---

## Lo que este despliegue no incluye

Dicho aquí para que no se descubra durante la demostración:

- **Pagos reales.** `FakeGateway` simula la pasarela. Culqi implementa la misma interfaz cuando haya cuenta de comercio.
- **Consulta real a SUNAT.** `FakeSunat` valida el RUC por módulo 11 y el formato, y **declara que no puede confirmar** si el comprobante existe (`existeEnSunat: null`). La consulta real necesita credenciales SOL.
- **Correo saliente.** Las notificaciones son in-app. Con `SMTP_*` configurado se activa el envío (ADR-0004).
- **AIni.** La verificación la produce el Motor de Reglas v0. El seam está listo: cambiar `VERIFICACION_DRIVER` conmuta la implementación sin tocar la base, el núcleo contable ni el frontend.


---

## Regenerar el PDF del avance

`docs/avance-examen-parcial.html` es la versión imprimible del documento de avance. Para volver a generar el PDF tras editarlo, con Edge en modo sin ventana:

```bash
"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe" --headless --disable-gpu --no-pdf-header-footer --print-to-pdf="docs\Ayni-Avance-Examen-Parcial-IA.pdf" "file:///C:/Users/User/Desktop/repositories/trazabilidad-radical/docs/avance-examen-parcial.html"
```

El salto de página por sección, los márgenes A4 y el tema claro fijo están en el bloque `@media print` del propio HTML, no en el comando.
