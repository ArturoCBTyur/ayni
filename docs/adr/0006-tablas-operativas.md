# ADR-0006 · Tablas operativas fuera de las 26 de dominio

- **Estado:** aceptado
- **Fecha:** 2026-09-15

## Contexto

La sección 6.2 del Entregable 2 declara 26 tablas en 5 dominios y el diccionario de la Tabla 13 las enumera. La implementación necesita además soporte para dos cosas que el documento describe en prosa pero no modela como tablas: sesiones con refresh token revocable (RNF-02) y la cola de análisis (ADR-0002).

## Decisión

Se implementan **las 26 tablas de dominio exactamente como el diccionario**, más dos tablas operativas claramente etiquetadas como tales en el esquema:

| Tabla | Para qué | Justifica |
|---|---|---|
| `sesiones` | Refresh tokens rotativos y revocables; solo se guarda el hash | RNF-02 |
| `trabajos_verificacion` | Cola de análisis con reintentos | ADR-0002, RF-IN-02 |

Otras necesidades se resuelven **sin** agregar tablas, para no inflar el modelo:

- **Categorías de gasto:** enum `CategoriaGasto` de PostgreSQL. Taxonomía cerrada en el MVP. RF-17 la vuelve configurable cuando haga falta un catálogo editable.
- **Plantillas de narrativa:** archivos `.eta` versionados en el repositorio. La revisión de lenguaje ético que pide RNF-21 es entonces la revisión de código, que deja rastro en git.

## Consecuencias

- El informe puede afirmar con precisión: 26 tablas de dominio más 2 operativas, 28 en total, y una consulta al catálogo del esquema lo confirma.
- Si más adelante se requiere un catálogo de categorías editable en caliente, se agrega la tabla y se migra el enum; el cambio queda aislado en `fondos`.
