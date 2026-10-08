# ADR-0007 · Decisiones transdisciplinarias previas (Fase 0)

- **Estado:** propuesto — **ninguna decisión está firmada todavía**
- **Fecha:** 2026-10-08
- **Plan:** [plan-transdisciplinario.md](../plan-transdisciplinario.md), Parte B

El plan pedía este documento como `0006-decisiones-transdisciplinarias.md`, pero el número 0006 ya lo ocupa [tablas operativas](0006-tablas-operativas.md). Va como 0007.

## Cómo leer este documento

Cada decisión tiene la misma forma: qué hay hoy en el código, qué opciones existen, **qué se propone** y qué cambia en el código si se firma otra cosa. La propuesta la redactó el equipo de Informática para que la disciplina responsable tenga algo concreto que aceptar, corregir o rechazar; **no reemplaza su firma**.

Las Fases 1 y 2 se construyeron sobre las propuestas de D1 y D5, porque el plan las pone antes que la firma y esperar habría bloqueado todo. Para que eso no se convierta en un hecho consumado, lo que depende de D1 vive en un solo archivo (`apps/api/src/modules/contable/pcge.ts`): si Contabilidad firma otra correspondencia, cambia esa tabla y sus pruebas, no los servicios.

## Firmas

| ID | Decisión | Responsable | Estado | Firma y fecha |
|---|---|---|---|---|
| D1 | Estándar contable y correspondencia con el PCGE | Contabilidad | Propuesta | — |
| D2 | Remanente al cerrar una causa | Derecho y Contabilidad | Propuesta | — |
| D3 | Instrumentos de SOC-1 y PSI-1 | Sociología y Psicología | Propuesta | — |
| D4 | Unidades de impacto por categoría | Sociología | Propuesta | — |
| D5 | Formatos de salida | Todas | Propuesta | — |
| D6 | Base legal de las encuestas | Derecho | Propuesta | — |

---

## D1 · Estándar contable

### Lo que hay hoy

El libro (`contable/cuentas.ts`) usa cinco cuentas propias y seis tipos de movimiento:

| Tipo | Debe | Haber |
|---|---|---|
| INGRESO | 10.1 Caja y bancos | 20.1 Donaciones por ejecutar |
| COMISION | 63.1 Comisiones de pasarela | 10.1 Caja y bancos |
| RETENCION | 20.1 Donaciones por ejecutar | 20.2 Fondos retenidos por justificar |
| EJECUCION | 20.2 Fondos retenidos por justificar | 60.1 Gastos ejecutados |
| REVERSO | 60.1 Gastos ejecutados | 20.2 Fondos retenidos por justificar |
| REASIGNACION | 20.2 Fondos retenidos por justificar | 20.1 Donaciones por ejecutar |

La donación es **pasivo** mientras no se justifica: es una obligación frente al donante y frente a la causa.

### Tres cosas que Contabilidad tiene que saber antes de firmar

Salieron de sumar el libro de la base de demostración por cuenta (3 donaciones por S/ 650.00 y un gasto aprobado por S/ 118.00):

| Cuenta interna | Debe | Haber | Saldo |
|---|---|---|---|
| 10.1 Caja y bancos | 650.00 | 25.36 | 624.64 deudor |
| 20.1 Donaciones por ejecutar | 624.64 | 650.00 | **25.36 acreedor** |
| 20.2 Fondos retenidos por justificar | 118.00 | 624.64 | 506.64 acreedor |
| 60.1 Gastos ejecutados | 0.00 | 118.00 | **118.00 acreedor** |
| 63.1 Comisiones de pasarela | 25.36 | 0.00 | 25.36 deudor |

1. **«60.1 Gastos ejecutados» tiene saldo acreedor.** La ejecución se abona a esa cuenta: económicamente es el reconocimiento del ingreso cuando la condición del donante se cumple, no el gasto. Además, en el PCGE la cuenta 60 es *Compras*. Llevarla a una cuenta de gasto del elemento 6 daría un gasto con saldo acreedor.
2. **«20.1 Donaciones por ejecutar» nunca se salda: retiene un pasivo igual a las comisiones.** El INGRESO abona el bruto y la RETENCION solo carga el neto. La parte de la donación que se consumió en la comisión queda como una obligación que no existe.
3. **El libro no registra la salida del dinero hacia la ONG.** Ningún movimiento abona Caja por un gasto aprobado, así que «10.1 Caja y bancos» es *lo recibido neto de comisiones*, no lo que está en custodia. El libro es un **registro de control de fondos restringidos**, no la contabilidad completa de la ONG.

Las tres son consecuencias del modelo y no defectos de cuadre: debe y haber siempre son iguales, y la conciliación cuadra. Pero cambian lo que un estado financiero puede afirmar y cómo debe leerse un libro diario exportado.

### Opciones de estándar

| Opción | A favor | En contra |
|---|---|---|
| **INPAG** (International Non-Profit Accounting Guidance, IFR4NPO) | Construida sobre la NIIF para las PYMES, que es el marco que el Perú ya usa; pensada para organizaciones sin fines de lucro; presenta fondos *con* y *sin* restricción | Reciente; poca práctica local todavía |
| **ASC 958** (US GAAP) | Madura; separa *net assets with/without donor restrictions* y trata la donación condicionada como anticipo reembolsable (pasivo) | Es norma estadounidense; obliga a traducir a NIIF para cualquier uso local |

### Propuesta

- **INPAG** como marco de presentación: fondos **con restricción** (lo retenido, 20.2) y **liberados** (lo ejecutado, 60.1).
- Mantener la donación como **pasivo** hasta justificarla. Esto se sostiene solo si D2 da al donante un derecho real sobre el remanente (devolución o reasignación con su consentimiento): **D1 y D2 se firman juntas.** Si el remanente quedara en la ONG sin más, la donación es ingreso con restricción desde el primer día y el pasivo no corresponde.
- Correspondencia con el PCGE **al exportar**, a nivel de divisionaria y con la cuenta interna como subcuenta auxiliar. Ningún asiento se reescribe:

| Cuenta interna | PCGE | Nombre PCGE | Naturaleza en el modelo |
|---|---|---|---|
| 10.1 Caja y bancos | 104 | Cuentas corrientes en instituciones financieras | Deudora |
| 20.1 Donaciones por ejecutar | 496 | Ingresos diferidos | Acreedora |
| 20.2 Fondos retenidos por justificar | 496 | Ingresos diferidos | Acreedora |
| 60.1 Gastos ejecutados | 759 | Otros ingresos de gestión | Acreedora |
| 63.1 Comisiones de pasarela | 639 | Otros servicios prestados por terceros | Deudora |

Con esta tabla, RETENCION y REASIGNACION se exportan como reclasificaciones dentro de la 496, distinguidas por la subcuenta auxiliar.

### Lo que Contabilidad decide además

- Si 104 es correcta para el dinero en la pasarela o corresponde 107 *Fondos sujetos a restricción*, y a qué nivel (divisionaria o subdivisionaria) se presenta.
- Si los hallazgos 2 y 3 se resuelven **en el libro**, con dos tipos de movimiento nuevos (liberar la parte consumida por la comisión; registrar el desembolso a la ONG), o solo **en la presentación**. Lo primero cambia el enum `TipoMovimiento`, el trigger de saldos y la conciliación; lo segundo no toca la base.
- Qué cuenta del elemento 6 corresponde a cada categoría de gasto, si el estado de actividades debe presentar el gasto por naturaleza.

---

## D2 · Remanente al cerrar una causa

### Lo que hay hoy

Nada lo resuelve. `LibroService.asentarReverso` existe pero no lo llama ningún flujo, y usa siempre el asiento de REVERSO (60.1 → 20.2): **solo sirve para revertir una ejecución**; si se usara sobre un INGRESO asentaría las cuentas equivocadas. REASIGNACION pasa lo retenido a 20.1, pero no existe el movimiento que lo lleve a otro fondo. Y no hay movimiento que represente una **devolución** al donante.

### Propuesta

1. **Plazo para justificar:** 90 días calendario desde que el fondo se cierra (o la campaña termina), con aviso a la ONG a los 60.
2. **Al vencer**, el remanente de cada donante (su parte no aplicada, que el FIFO ya conoce por `monto_neto - monto_aplicado`) va a donde el donante elija: **devolución** o **reasignación** a otro fondo, con su consentimiento expreso. Sin respuesta en 30 días, devolución.
3. Que Derecho confirme la figura: una donación con cargo, cuyo incumplimiento da derecho a reclamar lo no usado, y qué exige la norma tributaria si la ONG es perceptora de donaciones.

### Consecuencias en el código

La Fase 3 necesita lo que hoy falta: un tipo de movimiento **DEVOLUCION** (20.2 → 10.1) o una regla equivalente, y el par de movimientos de una reasignación entre fondos (salida en uno, retención en el otro) dentro de la misma transacción. Ambos tocan el trigger de saldos, la conciliación y `fn_aplicacion_validar`.

---

## D3 · Instrumentos de SOC-1 y PSI-1

### SOC-1 · Variación del índice de confianza (meta +20 % sobre la línea base)

**Propuesta:**

- Escala Likert de 1 a 7, de 6 a 8 ítems, adaptada de una escala publicada de confianza en organizaciones benéficas (por ejemplo, la de Sargeant y Lee) y validada en español por Sociología.
- **Línea base:** al donar por primera vez, antes de la primera notificación de impacto.
- **Seguimiento:** 30 días después de la primera notificación de impacto.
- **Índice:** media de los ítems llevada a 0-100. SOC-1 es la variación de la media de los pares (base, seguimiento) de las mismas personas, no de dos muestras distintas.

### PSI-1 · System Usability Scale (meta SUS ≥ 75)

**Propuesta:** el SUS estándar de 10 ítems y 5 puntos, en una traducción al español ya validada, sin adaptar los ítems. Puntaje: 2.5 × (Σ(impares − 1) + Σ(5 − pares)). Se aplica al terminar una tarea real (donar o registrar un gasto), no al azar.

**Lo que decide Psicología:** la traducción, el momento y si se aplica a todos los roles o por rol (el SUS de un operador de campo y el de un donante no miden lo mismo).

---

## D4 · Unidades de impacto por categoría

Propuesta de partida, una unidad por categoría de `CategoriaGasto`:

| Categoría | Unidad propuesta |
|---|---|
| ALIMENTOS | raciones entregadas |
| ATENCION_VETERINARIA | animales atendidos |
| MEDICAMENTOS | tratamientos completados |
| INSUMOS | — (sin unidad: el insumo no es un resultado) |
| TRANSPORTE | traslados realizados |
| INFRAESTRUCTURA | espacios habilitados |
| ESTERILIZACION | esterilizaciones |
| OTROS | — |

**Lo que decide Sociología:** si la unidad es por categoría o la elige la ONG por fondo, y si se reporta resultado (animales atendidos) o producto (consultas). El costo por unidad de la Fase 5 hereda esa elección.

---

## D5 · Formatos de salida

### Lo que hay hoy

CSV (RFC 4180, con BOM para Excel) para el libro, los gastos y la conciliación. El informe de auditoría se entrega como estructura y se imprime desde el navegador, a propósito, para no sumar una dependencia de renderizado en el servidor.

### Propuesta

| Formato | Para qué | Cómo |
|---|---|---|
| JSON | La aplicación y cualquier integración | Siempre disponible |
| CSV | Extractos que se cruzan en una planilla | Como hoy |
| Excel (`.xlsx`) | Los estados mensuales que pide Contabilidad | Office Open XML generado en el servidor **sin dependencias**: una hoja, celdas numéricas, ZIP almacenado |
| PDF | Los estados mensuales y, en la Fase 3, el informe de cierre | Generado en el servidor **sin dependencias**, solo texto con las fuentes estándar del PDF |
| PLE (TXT de SUNAT) | Libro diario y mayor | **Borrador** hasta que un contador valide la estructura |
| IATI | Datos abiertos | Se decide en la Fase 7 |

El PDF se genera en el servidor, a diferencia del informe de auditoría, porque el cierre mensual y el informe de cierre tienen que ser **el mismo documento cada vez** que se piden, con su hash. Un PDF impreso desde el navegador cambia con el navegador.

Se escribieron sin bibliotecas porque lo que se necesita es poco (texto, tablas, una hoja) y el proyecto ya evita dependencias de ese tipo; si la Fase 3 pide gráficos o imágenes en el PDF, conviene reevaluarlo.

---

## D6 · Base legal de las encuestas (Ley N.° 29733)

### Lo que hay hoy

`FinalidadConsentimiento` tiene TRATAMIENTO_DATOS, COMUNICACIONES y USO_IMAGEN. Ninguna cubre usar respuestas para investigación.

### Propuesta

- Una finalidad nueva, **INVESTIGACION**: separada, revocable, que no condiciona donar ni usar la plataforma.
- Las respuestas se guardan **desvinculadas** de la cuenta: un código seudónimo (HMAC del usuario con una clave del servidor) permite emparejar línea base y seguimiento sin guardar quién respondió. Al revocar, se borra el vínculo y las respuestas quedan anónimas o se eliminan, según decida Derecho.
- **Umbral de publicación n ≥ 5** para cualquier agregado, por fondo, ONG o período. Por debajo, el tablero dice cuántas respuestas faltan y no publica el valor.

**Lo que decide Derecho:** la finalidad, el texto del consentimiento, el destino de las respuestas al revocar, y si una encuesta a usuarios de la plataforma requiere algo más que el consentimiento (por ejemplo, la inscripción del banco de datos).
