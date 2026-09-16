# ADR-0002 · Cola de verificación en PostgreSQL en lugar de BullMQ/Redis

- **Estado:** aceptado
- **Fecha:** 2026-09-15

## Contexto

La sección 7.1 del Entregable 2 define BullMQ sobre Redis como cola asíncrona del MVP, con evolución a RabbitMQ o Kafka en la versión con deep learning. El propósito de la cola es no bloquear la API mientras se analiza una evidencia (RF-IN-02) y permitir reintentos.

En el entorno de desarrollo no hay Redis ni Docker instalados, y Redis nativo en Windows no tiene soporte oficial (requiere Memurai o WSL).

Además, el motor de verificación de esta versión es determinista y tarda milisegundos, no los segundos que justificaban una cola dedicada.

## Decisión

La cola vive en una tabla `trabajos_verificacion` de PostgreSQL, consumida con `SELECT ... FOR UPDATE SKIP LOCKED` por un worker de `@nestjs/schedule`.

## Motivos

- No introduce una dependencia de infraestructura que el entorno no puede ejecutar hoy, ni un componente más que operar en el despliegue.
- `FOR UPDATE SKIP LOCKED` es el patrón estándar de cola en PostgreSQL: da exclusión mutua entre workers, reintentos y backoff sin perder trabajos.
- El trabajo queda en la **misma transacción** que el gasto que lo origina, así que es imposible encolar un análisis de un gasto que no se guardó.
- El contrato observable no cambia: el gasto pasa por `EN_ANALISIS` y el frontend ve estados visibles, igual que con BullMQ.

## Consecuencias

- El throughput es menor que con Redis. Irrelevante en el volumen del piloto.
- Cuando entre AIni, Redis será necesario de todos modos (análisis de segundos, RNF-11 exige p95 menor a 60 s). En ese momento se cambia el **productor**; el consumidor y los estados permanecen.
- La tabla no forma parte de las 26 tablas de dominio del Entregable 2. Ver ADR-0006.
