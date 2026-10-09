# Plan de trabajo · Requisitos transdisciplinarios

**Responsable:** Yhojan
**Alcance:** libros y estados contables estandarizados, cierre de causa, encuestas e indicadores de la Tabla 3 que hoy dicen «Sin medir», impacto social, documentos legales y datos abiertos.
**Fuera de alcance:** INF-3 (exactitud del lector de comprobantes) y todo lo de AIni, que lleva el frente de IA.

> **Estado (octubre de 2026):** las nueve fases están implementadas sobre las **propuestas** de D1–D6, que siguen sin firma. Lo que falta, y de quién depende, está en la [matriz de trazabilidad](trazabilidad-rf.md#requerimientos-transdisciplinarios-plan-de-octubre-de-2026): la firma de cada decisión, la validación del PLE y de la constancia por un contador, y la sesión de usabilidad con usuarios reales.

El proyecto ya demuestra la trazabilidad con hashes, conciliación y evidencia. Lo que falta es decirlo en el idioma de cada disciplina: un contador necesita estados estandarizados, un abogado una política de remanentes y una base legal para encuestar, un sociólogo una medición de confianza con línea base. Este plan convierte eso en tareas con su prueba.

---

## Parte A · Lo que hay que saber antes de tocar código

### A1. Levantar y probar el proyecto

- Seguir el [README](../README.md): PostgreSQL 18 **en el puerto 5433**, `npm run seed` y `npx tsx prisma/seed-demo.ts`, Flutter 3.47.
- **La suite del API se niega a correr si hay una API respondiendo en el puerto 3000** (`src/comun/prisma/preparar-pruebas.ts`): su trabajador de cola escribe en la misma base y produce fallos intermitentes. Detener el servidor antes de `npx jest`. Las pruebas escriben en la base de desarrollo y limpian lo suyo.
- **No usar `dart format`**: el repo está escrito a 100 columnas y el formateador lo reescribe entero a 80.
- Cada fase cierra con todo en verde:

```bash
cd apps/api && npx jest --coverage
```

```bash
cd apps/app && flutter analyze && flutter test
```

  CI exige cobertura ≥ 70 % en `contable` y `gastos` (RNF-19).
- Cuentas de prueba y códigos del segundo factor: [guion-demo.md](guion-demo.md#cuentas-tabla-20) y `npm run demo:listo`.

### A2. Mapa del código

| Dónde | Qué hay |
|---|---|
| `apps/api/src/modules/contable/cuentas.ts` | Plan de cuentas y asientos. Hoy son **5 cuentas propias**, no códigos del PCGE |
| `apps/api/src/modules/contable/libro.service.ts` | Asientos, saldos y verificación de la cadena de hashes |
| `apps/api/src/modules/analitica/` | Indicadores de la Tabla 3 (`indicadores.service.ts`), conciliación, exportaciones CSV, informe de ONG y panel de inicio |
| `apps/api/src/modules/retorno/` | Narrativas al donante, plantillas y filtro de lenguaje ético |
| `apps/api/src/modules/cumplimiento/` | Consentimientos por finalidad y derechos ARCO (Ley 29733) |
| `apps/api/prisma/schema.prisma` | Modelo de datos. `FeedbackDonante` ya guarda la valoración de cada narrativa (COM-1) |
| `apps/api/prisma/sql/reglas-integridad.sql` | Lo que la base impone por su cuenta: libro inmutable, cadena de hashes, RN-04, evidencia anonimizada |
| `apps/app/lib/funciones/` | Pantallas por rol. Piezas reutilizables en `lib/comun/`: visor de archivos, descarga de CSV (`descarga.dart`), tarjeta de análisis |

Indicadores de la Tabla 3 que hoy dicen «Sin medir»: **SOC-1** (variación del índice de confianza, meta +20 % sobre la línea base), **PSI-1** (SUS ≥ 75) e INF-3 (de IA).

### A3. Reglas que no se rompen

- **El libro es de solo inserción y está encadenado por hash.** Nada se corrige con `UPDATE`: se registra un movimiento `REVERSO` o `REASIGNACION` (ya existen en `TipoMovimiento`). La base rechaza lo demás.
- **Una foto con personas solo se publica difuminada.** Para todo lo que no es el auditor se usa `urlPublicable()` de `gastos/evidencia-publica.ts`. Ningún informe público lleva un original.
- **Un informe público solo afirma cifras que salen de la base**, como las narrativas (RNF-21).
- **Cada cosa que un rol ve o descarga pasa por su permiso**, con una prueba HTTP que lo demuestre (ver `donaciones.http.spec.ts` como modelo). Lo que autoriza a una ONG es la membresía, no el rol.
- Las fechas de columnas `DATE` se leen en la app con `Formato.aDia`, no con `aFecha`, o se corren un día en Lima.

### A4. Forma de trabajo

- Una rama y un PR por fase, con las pruebas en verde.
- Coordinar con el frente de IA antes de tocar `retorno/`, `gastos/` o `verificacion/`, que comparten.
- **No crear datos de prueba en la base de la demostración.** Los scripts de demo buscan la ONG del operador demo; aun así, una ONG o campaña nueva aparece en el guion en vivo.

---

## Parte B · Fase 0 · Decisiones previas (bloquean el resto)

Cada decisión queda escrita y firmada por la disciplina responsable en [`docs/adr/0007-decisiones-transdisciplinarias.md`](adr/0007-decisiones-transdisciplinarias.md) (el 0006 ya estaba ocupado).

| ID | Decisión | Responsable |
|---|---|---|
| D1 | **Estándar contable.** INPAG (guía internacional para entidades sin fines de lucro, IFR4NPO) o ASC 958 para presentar fondos *con* y *sin* restricción del donante, y la correspondencia de las 5 cuentas internas con el PCGE. Ojo: en el PCGE la cuenta 20 es mercaderías, y el modelo trata la donación como **pasivo** hasta justificarla | Contabilidad |
| D2 | **Remanente al cerrar una causa.** Plazo para justificar lo retenido y, después, devolución al donante o reasignación con su consentimiento | Derecho y Contabilidad |
| D3 | **Instrumentos.** Escala de confianza para SOC-1 (ítems, Likert, cuándo se mide la línea base y el seguimiento) y SUS estándar de 10 ítems para PSI-1 | Sociología y Psicología |
| D4 | **Unidades de impacto por categoría de gasto** (por ejemplo, «animales atendidos», «esterilizaciones») | Sociología |
| D5 | **Formatos de salida**: PDF, Excel, CSV; si se incluye IATI | Todas |
| D6 | **Base legal de las encuestas (Ley 29733).** ¿Nueva finalidad de consentimiento `INVESTIGACION`? Umbral mínimo de respuestas para publicar un agregado (por ejemplo, n ≥ 5) | Derecho |

- **T0.1** Registrar los RF nuevos con su ID (`RF-CF-xx`, `RF-DE-xx`, `RF-SO-xx`…) en [trazabilidad-rf.md](trazabilidad-rf.md) como ⬜ Pendiente **antes** de implementarlos, con su criterio de aceptación.

---

## Parte C · Tareas

### Fase 1 · Base contable estandarizada

- **T1.1** Tabla de correspondencia cuentas internas → PCGE (según D1), aplicada **al exportar**. No se reescribe ningún asiento.
  *Prueba:* cada tipo de movimiento tiene correspondencia y, exportado, el debe sigue igualando al haber.
- **T1.2** Clasificación de los saldos de cada fondo en *con restricción* (retenido) y *liberados* (ejecutado), según D1.

### Fase 2 · Estados mensuales por fondo

- **T2.1** Servicio que arma, para un período, el **estado de actividades** (donaciones brutas, comisiones, ejecutado por categoría, retenido inicial y final) y la **situación del fondo**.
  *Prueba:* los totales cuadran con la suma de movimientos del libro y con la conciliación.
- **T2.2** `GET /analitica/estados/fondos/:id?periodo=AAAA-MM` en JSON, Excel y PDF. Lo ven el administrador, el auditor y los miembros de la ONG dueña.
  *Prueba HTTP:* un miembro de otra ONG recibe 403.
- **T2.3** Cierre mensual automático (cron el día 1, como la conciliación diaria): guarda un **snapshot inmutable con el hash de su contenido**, para que el informe de un mes no cambie después, y avisa a la ONG.
- **T2.4** *(según D5)* Libro diario y mayor en formato PLE de SUNAT. Validar la estructura con un contador.
- **T2.5** App: «Estados mensuales» con descarga en la pestaña Fondos de la ONG y en el informe de ONG del auditor.

### Fase 3 · Cierre de causa

- **T3.1** Política de remanente (D2): al vencer el plazo, movimiento `REVERSO` o `REASIGNACION` con su motivo.
  *Prueba:* la cadena sigue íntegra y la conciliación cuadra.
- **T3.2** Informe de cierre en PDF: resumen, estados acumulados, gastos con su comprobante y fotos publicables, verificación de cadena, remanente y su destino.
- **T3.3** Verificación pública: un QR en el informe lleva a una página que muestra el hash del informe y recalcula la cadena del fondo.
- **T3.4** Aviso de cierre a cada donante con su parte, reutilizando las plantillas de `retorno/` y su filtro de lenguaje ético.

### Fase 4 · Encuestas e indicadores «Sin medir»

- **T4.1** Modelo de instrumento versionado (ítems, escala, versión) y de respuesta, con el consentimiento de D6. Desvincular las respuestas de la persona cuando corresponda.
- **T4.2** **SOC-1**: encuesta de confianza en dos momentos (línea base y tras el primer impacto). Calcular la variación y reemplazar el «Sin medir» en `indicadores.service.ts`.
- **T4.3** **PSI-1**: cuestionario SUS dentro de la app, con su fórmula estándar. Además, una sesión con usuarios reales y su acta (cubre también RNF-14).
- **T4.4** El tablero muestra el *n* de cada indicador y no publica nada por debajo del umbral de D6.

### Fase 5 · Impacto social

- **T5.1** Unidades de impacto opcionales en cada gasto (D4): migración y campo en el formulario de registrar gasto.
- **T5.2** Costo por unidad de impacto por fondo y por causa, incluido en el informe de cierre.

### Fase 6 · Derecho y tributario

- **T6.1** Constancia de donación en PDF para el donante. Si la ONG está calificada por SUNAT como perceptora de donaciones (dato nuevo en la ONG), incluye lo que la norma exija; validarlo con un contador.
- **T6.2** Informe exportable de cumplimiento de la Ley 29733: ARCO en plazo, consentimientos por finalidad y DER-1.

### Fase 7 · Datos abiertos *(opcional)*

- **T7.1** Exportación en el estándar IATI de las actividades, transacciones y resultados de cada causa.

### Fase 8 · Cierre

- **T8.1** Matriz RF, guion de demo e indicadores al día; `openapi.json` regenerado desde el código actual; suites completas en verde.

---

## Orden sugerido

**Fase 0 → 1 → 2 → 4 → 3 → 5 → 6 → 7 → 8.**

La Fase 4 va antes que la 3 porque es barata y cierra dos indicadores «Sin medir». La 3 depende de D2.

## Criterio de «terminado» para cada tarea

1. Tiene su RF en la matriz, con el criterio de aceptación.
2. Tiene al menos una prueba que falla si se rompe; si expone datos, una prueba HTTP de permisos.
3. Lo validó la disciplina responsable cuando se trata de un estándar, una norma o un instrumento.
4. La documentación que lo nombra está al día.
