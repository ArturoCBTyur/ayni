# Trazabilidad Radical

Plataforma de micro-mecenazgo dirigido con trazabilidad total de las donaciones.

Cada donación se asigna a un **fondo** con un destino concreto y queda **retenida contablemente** hasta que la ONG demuestra el gasto con un comprobante de pago y una evidencia visual. Cuando el gasto se verifica, el donante recibe una narrativa personalizada con la evidencia de lo que su aporte hizo posible.

Proyecto de los cursos de **Proyectos Transdisciplinarios** e **Inteligencia Artificial**.
Implementa el Entregable 2 del equipo: 21 casos de uso, 21 RNF, 47 RF y 26 tablas en 5 dominios.

## Estado: MVP v1 — sin IA

Esta versión es **deliberadamente sin inteligencia artificial**. El ciclo de confianza completo funciona de extremo a extremo, pero la etapa de verificación la resuelve un **Motor de Reglas v0** determinista que respeta el contrato de datos exacto de AIni.

Cuando AIni se incorpore, se implementa `MotorAIni` contra la misma interfaz y se conmuta con una variable de entorno. No cambia la base de datos, ni el core contable, ni el frontend. Ver [ADR-0005](docs/adr/0005-motor-reglas-v0.md).

Efecto secundario deliberado: como cada decisión de auditor se guarda en `revisiones_auditoria`, esta versión ya va generando el **dataset etiquetado** que AIni necesitará para entrenarse.

## Stack

| Capa | Tecnología |
|---|---|
| Presentación | Flutter 3.47.4 Web (PWA), un solo código base con Android e iOS habilitados |
| Backend | Node.js 24 + NestJS 11 (TypeScript), API REST, OpenAPI |
| Datos | PostgreSQL 18 + Prisma |
| Verificación | Motor de Reglas v0 (sin IA) tras la interfaz `MotorVerificacion` |
| Cola | Tabla en PostgreSQL con `FOR UPDATE SKIP LOCKED` ([ADR-0002](docs/adr/0002-cola-en-postgresql.md)) |
| Archivos | `StorageAdapter`: disco en desarrollo, S3 en despliegue ([ADR-0003](docs/adr/0003-almacenamiento-en-disco.md)) |
| Pagos | Adaptador `PasarelaPago` con `FakeGateway`; Culqi implementa la misma interfaz |

Los diez módulos del backend corresponden 1:1 a la Tabla 15 del Entregable 2: `identidad`, `campanas`, `donaciones`, `contable`, `gastos`, `verificacion`, `auditoria`, `retorno`, `analitica`, `cumplimiento`.

## Requisitos

- Node.js 20 o superior (probado en 24.14.0)
- PostgreSQL 18 **escuchando en el puerto 5433** (no el 5432 por defecto)
- Flutter 3.47 canal stable, con soporte web habilitado

## Puesta en marcha

### 1. Base de datos

Ejecutar una sola vez como superusuario. El script crea el rol `tr_app`, la base y la extensión `pgcrypto`:

```bash
psql -U postgres -h localhost -p 5433 -f apps/api/prisma/sql/00-crear-base.sql
```

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

## Verificación

```bash
cd apps/api && npm test
```

```bash
cd apps/app && flutter analyze && flutter test
```

El recorrido de extremo a extremo (donar, registrar gasto, verificar, aplicar FIFO, narrar al donante) está en [docs/guion-demo.md](docs/guion-demo.md).

## Integridad contable

Cuatro reglas que la base de datos hace cumplir, y que ningún bug del backend puede eludir:

- `movimientos_contables` es de **solo inserción**: los triggers rechazan `UPDATE` y `DELETE`. Las correcciones se registran como movimientos de tipo `REVERSO`.
- Cada movimiento se **encadena por hash** (`hash_actual = SHA-256(hash_previo || datos)`), con secuencia y hashes asignados por la base, no por la aplicación.
- La suma de `aplicaciones_donacion` de un gasto aprobado **debe igualar** su monto aprobado, validado por un constraint trigger diferido.
- Una notificación **no puede** referenciar una evidencia sin anonimizar, ni enviarse sin consentimiento vigente cuando no es transaccional.

Todas están en [`apps/api/prisma/sql/reglas-integridad.sql`](apps/api/prisma/sql/reglas-integridad.sql), documentadas contra la sección 6.6 del entregable.

## Documentación

- [Decisiones de arquitectura (ADR)](docs/adr/)
- [Matriz de trazabilidad RF/RNF](docs/trazabilidad-rf.md)
- [Guion de demostración](docs/guion-demo.md)

## Equipo

Nieves Quiñonez, Nicol Tamara · Bonilla Malpartida, Yvan Hawel · Caldas Bahamonde, Arturo Jesús

Docente: Dr. Abimael Adam Francisco Paredes
