# Ayni

Plataforma de micro-mecenazgo dirigido con trazabilidad total de las donaciones.

*Ayni* es la reciprocidad andina: lo que se da vuelve, y quien recibe rinde cuentas de lo recibido. El proyecto académico que implementa se llama **Trazabilidad Radical**, y así aparece en el Entregable 2.

Cada donación se asigna a un **fondo** con un destino concreto y queda **retenida contablemente** hasta que la ONG demuestra el gasto con un comprobante de pago y una evidencia visual. Cuando el gasto se verifica, el donante recibe una narrativa personalizada con la evidencia de lo que su aporte hizo posible.

Proyecto de los cursos de **Proyectos Transdisciplinarios** e **Inteligencia Artificial**.
Implementa el Entregable 2 del equipo: 21 casos de uso, 21 RNF, 47 RF y 26 tablas en 5 dominios.

## Estado

El ciclo de confianza funciona de extremo a extremo —donar, retener, registrar el gasto, verificarlo, aplicar FIFO, narrar al donante— y la etapa de verificación tiene **dos motores intercambiables** detrás de una sola interfaz:

| Motor | Qué es | Cuándo |
|---|---|---|
| `MotorReglasV0` | Reglas deterministas en el propio backend, sin IA | `VERIFICACION_DRIVER=reglas-v0` |
| `MotorAIni` | Cliente del servicio de análisis en [`apps/aini`](apps/aini) | `VERIFICACION_DRIVER=aini` |

Se conmutan con una variable de entorno: no cambia la base de datos, ni el core contable, ni el frontend ([ADR-0005](docs/adr/0005-motor-reglas-v0.md)). **Si AIni no responde, la plataforma no se queda sin verificar:** cae al motor de reglas y lo anota en la explicación del análisis, para que un auditor sepa con qué criterio se evaluó ese caso.

Cada análisis queda atado al modelo y a la regla de umbrales **vigentes al momento** (RN-06), así que dos años después se puede saber con qué criterio se aprobó un gasto, no solo que se aprobó.

Y cada decisión de auditor se guarda en `revisiones_auditoria`: es el **conjunto etiquetado** con el que AIni se reentrena.

## AIni: qué hace de IA, y qué deliberadamente no

[`apps/aini`](apps/aini) es un servicio Python propio —**no una API de terceros**—. Corre en la infraestructura del proyecto, sin clave que custodiar ni cuota que agotar, y los datos de los beneficiarios no salen de ella. Para un sistema que trata datos sensibles bajo la **Ley N.° 29733**, eso último no es un detalle de costo.

| Señal | Técnica | Qué resuelve que una regla no puede |
|---|---|---|
| Lectura del comprobante | **OCR** (rapidocr-onnxruntime) | Lee el papel y lo coteja con lo que se tecleó |
| Coherencia concepto ↔ categoría | **spaCy**, vectores de palabras | Un alquiler de oficina no es atención veterinaria |
| Perfil del gasto | **Isolation Forest** (scikit-learn) | Ve *combinaciones* raras, no señales sueltas |

El caso que justifica el lector: un operador que teclea `185.00` sobre una boleta de `158.00` pasa **todas** las reglas deterministas —el RUC es válido, el IGV cuadra, las fechas son posibles— porque todas razonan sobre el dato declarado, y el dato declarado es impecable. Para verlo hay que leer el documento.

La señal **visual** no usa aprendizaje automático, y es deliberado: nitidez, EXIF y distancia de Hamming son magnitudes exactas, y someterlas a una predicción las volvería menos precisas y menos explicables.

**Los límites están medidos y escritos, no omitidos:** el detector de anomalías se entrenó con 600 gastos sintéticos porque la base real tiene cuatro; la señal de lenguaje deja pasar cerca del 13 % de las categorizaciones erróneas; el lector solo se probó sobre boletas generadas, no sobre papel térmico real. **Por eso las tres señales restan puntos y derivan a una persona en vez de decidir solas.** El detalle, con las mediciones, está en [el README de AIni](apps/aini/README.md).

## Stack

| Capa | Tecnología |
|---|---|
| Presentación | Flutter 3.47.4 Web (PWA), un solo código base con Android e iOS habilitados |
| Backend | Node.js 24 + NestJS 11 (TypeScript), API REST, OpenAPI |
| Datos | PostgreSQL 18 + Prisma |
| Verificación | Dos motores tras la interfaz `MotorVerificacion`: reglas deterministas, o **AIni** |
| IA (AIni) | Python 3.12 + FastAPI · scikit-learn · spaCy `es_core_news_md` · rapidocr-onnxruntime |
| Cola | Tabla en PostgreSQL con `FOR UPDATE SKIP LOCKED` ([ADR-0002](docs/adr/0002-cola-en-postgresql.md)) |
| Archivos | `StorageAdapter`: disco en desarrollo, S3 en despliegue ([ADR-0003](docs/adr/0003-almacenamiento-en-disco.md)) |
| Pagos | Adaptador `PasarelaPago` con `FakeGateway`; Culqi implementa la misma interfaz |

Los diez módulos del backend corresponden 1:1 a la Tabla 15 del Entregable 2: `identidad`, `campanas`, `donaciones`, `contable`, `gastos`, `verificacion`, `auditoria`, `retorno`, `analitica`, `cumplimiento`.

## Requisitos

- Node.js 20 o superior (probado en 24.14.0)
- PostgreSQL 18 **escuchando en el puerto 5433** (no el 5432 por defecto)
- Flutter 3.47 canal stable, con soporte web habilitado
- Python 3.12, solo si se quiere correr AIni (el backend arranca igual sin ella)

## Puesta en marcha

### 1. Base de datos

Copiar la plantilla y poner una contraseña propia. El script crea el rol `tr_app`, la base y la extensión `pgcrypto`:

```bash
cp apps/api/prisma/sql/00-crear-base.example.sql apps/api/prisma/sql/00-crear-base.sql
```

```bash
psql -U postgres -h localhost -p 5433 -f apps/api/prisma/sql/00-crear-base.sql
```

El archivo con la contraseña real **no se versiona**, por eso se parte de la plantilla. Esa misma contraseña va en `DATABASE_URL` dentro de `.env`, en el paso siguiente.

### 2. API

```bash
cd apps/api && npm install && cp .env.example .env
```

Completar `DATABASE_URL` en `.env` con la contraseña del rol, y luego:

```bash
npx prisma migrate deploy && npm run seed && npm run dev
```

La API queda en `http://localhost:3000` y la documentación OpenAPI en `http://localhost:3000/docs`.

### 3. Aplicación

```bash
cd apps/app && flutter run -d edge --dart-define=API_BASE_URL=http://localhost:3000/api/v1
```

En esta máquina no hay Chrome instalado, de ahí `-d edge`. Con Chrome disponible, `-d chrome` funciona igual.

### 4. AIni (opcional)

El backend funciona sin ella, con el motor de reglas. Para verificar con los modelos:

```bash
cd apps/aini && pip install -r requirements.txt
```

```bash
python -m spacy download es_core_news_md
```

```bash
python -m entrenamiento.entrenar
```

```bash
python -m uvicorn aini.main:app --host 127.0.0.1 --port 8000
```

Y en `apps/api/.env`: `VERIFICACION_DRIVER=aini`. Comprobar con `curl http://127.0.0.1:8000/salud`, que también dice si el lector de comprobantes está activo.

## Verificación

```bash
cd apps/api && npm test
```

```bash
cd apps/app && flutter analyze && flutter test
```

```bash
cd apps/aini && python -m pytest pruebas/ -q
```

Y un banco de pruebas para tirarle casos al modelo a mano, encontrar dónde falla y poder responder sin adivinar cuando alguien pregunte:

```bash
cd apps/aini && python probar.py limites
```

Cobertura del núcleo contable y de gastos (RNF-19: umbral del 70 %, exigido en CI):

```bash
cd apps/api && npm run test:cov
```

Latencia de lectura (RNF-10). Contra `localhost` mide la aplicación; contra el despliegue mide lo que experimenta quien usa la plataforma, que es lo que responde el requisito:

```bash
cd apps/api && npm run medir:latencia
```

El recorrido de extremo a extremo (donar, registrar gasto, verificar, aplicar FIFO, narrar al donante) está en [docs/guion-demo.md](docs/guion-demo.md).

## Integridad contable

Cuatro reglas que la base de datos hace cumplir, y que ningún bug del backend puede eludir:

- `movimientos_contables` es de **solo inserción**: los triggers rechazan `UPDATE` y `DELETE`. Las correcciones se registran como movimientos de tipo `REVERSO`.
- Cada movimiento se **encadena por hash** (`hash_actual = SHA-256(hash_previo || datos)`), con secuencia y hashes asignados por la base, no por la aplicación.
- La suma de `aplicaciones_donacion` de un gasto aprobado **debe igualar** su monto aprobado, validado por un constraint trigger diferido.
- Una notificación **no puede** referenciar una evidencia sin anonimizar, ni enviarse sin consentimiento vigente cuando no es transaccional.

Todas están en [`apps/api/prisma/sql/reglas-integridad.sql`](apps/api/prisma/sql/reglas-integridad.sql), documentadas contra la sección 6.6 del entregable.

Y se pueden ver fallar:

```bash
cd apps/api && npm run demo:romper
```

Siete intentos de estafar al donante, en SQL directo contra PostgreSQL, por fuera de la API y de toda validación. La base rechaza los siete y al final recalcula cada cadena de hashes, fondo por fondo. Cada intento vive en una transacción que siempre se deshace, así que es seguro correrlo sobre la base de demostración.

## Entorno completo con Docker

Para revisar el proyecto sin instalar PostgreSQL, Node ni Flutter:

```bash
docker compose up --build
```

La web queda en `http://localhost:8080` y la API en `http://localhost:3000`. Las migraciones y las semillas las aplica un servicio aparte antes de que la API arranque. Si esos puertos ya están ocupados, se cambian sin tocar el archivo:

```bash
API_PUERTO=3100 WEB_PUERTO=8180 BASE_PUERTO=5434 docker compose up --build
```

CI construye las imágenes en cada cambio y corre un simulacro de respaldo y restauración sobre ellas.

La misma imagen de Flutter sirve para analizar y probar la aplicación con la versión exacta del proyecto, sin instalarla:

```bash
docker build --target sdk -t ayni-flutter-sdk apps/app
```

```bash
docker run --rm -v "$PWD/apps/app":/app -v ayni-pub-cache:/root/.pub-cache -w /app ayni-flutter-sdk sh -c "flutter pub get && flutter analyze && flutter test"
```

## Cifrado y respaldo

Las evidencias y los secretos del segundo factor se guardan cifrados con AES-256-GCM (RNF-01), con la clave de `CIFRADO_CLAVE`: obligatoria en producción, opcional en desarrollo. Para activarla sobre datos existentes o rotarla, `npm run cifrado:migrar`.

El respaldo (RNF-13) no termina en el volcado: termina en una restauración que demuestra que lo restaurado es el mismo libro contable, cadena por cadena. El procedimiento, y por qué la clave no viaja con el respaldo, están en [docs/respaldo.md](docs/respaldo.md).

## Documentación

- [Decisiones de arquitectura (ADR)](docs/adr/)
- [Matriz de trazabilidad RF/RNF](docs/trazabilidad-rf.md)
- [Guía de despliegue](docs/despliegue.md) — qué crear, en qué orden y qué no incluye
- [Guion de demostración](docs/guion-demo.md) — los 10 minutos, paso a paso
- [AIni: el motor de verificación](apps/aini/README.md) — las tres señales, con las mediciones y los límites
- [Revisión OWASP ASVS L2](docs/revision-asvs-l2.md) — capítulo por capítulo, con lo que no cubre
- [Respaldo y recuperación](docs/respaldo.md) — respaldar, restaurar, verificar y rotar la clave de cifrado

## Equipo

Nieves Quiñonez, Nicol Tamara · Bonilla Malpartida, Yvan Hawel · Caldas Bahamonde, Arturo Jesús

Docente: Dr. Abimael Adam Francisco Paredes
