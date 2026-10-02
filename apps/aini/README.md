# AIni — motor de verificación de Ayni

Servicio de análisis de gastos. Recibe el contrato de la sección 7.4 del Entregable 2 y devuelve puntaje, nivel y una explicación legible de cada señal.

**Es un servicio propio, no una API de terceros.** Corre en la infraestructura del proyecto, sin clave de proveedor ni cuota que agotar, y los datos de los beneficiarios no salen de ella. Para un sistema que trata datos sensibles bajo la Ley N.° 29733, eso último no es un detalle de costo.

---

## Puesta en marcha

```bash
pip install -r requirements.txt
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

Y en `apps/api/.env`:

```
VERIFICACION_DRIVER=aini
AINI_URL=http://127.0.0.1:8000
```

Comprobar que respondió: `curl http://127.0.0.1:8000/salud`

---

## Qué hace, señal por señal

El puntaje final es la media ponderada de tres señales. **Los pesos y los umbrales no viven aquí**: llegan en cada petición, dentro de `regla`, porque la RN-06 exige que el nivel se calcule con la regla vigente al momento y que quede registrado cuál fue. El administrador los cambia sin tocar ni redesplegar el modelo.

### Documental — ¿el comprobante es coherente?

| Comprobación | Técnica |
|---|---|
| Dígito verificador del RUC | Módulo 11 (algoritmo de SUNAT) |
| Aritmética del IGV y del total | Determinista |
| Fechas de emisión y gasto | Determinista |
| **Coherencia concepto ↔ categoría** | **spaCy, vectores de palabras** |

La última es la única con procesamiento de lenguaje, y es la que justifica tener un modelo en esta señal: **¿el concepto que la ONG escribió corresponde a la categoría del fondo del que está sacando el dinero?** Un «alquiler de oficina» cargado al fondo de «atención veterinaria» tiene el RUC válido, el IGV exacto y las fechas en orden. Ninguna regla aritmética lo ve. El modelo sí.

Un detalle medido y no supuesto: **`Doc.similarity` de spaCy no sirve para esto.** Promedia el documento entero, y las preposiciones pesan tanto como los sustantivos. Sobre los conceptos reales de este proyecto la medida se invertía —«atención veterinaria» contra «alquiler de oficina» puntuaba 0.791, y contra su propia categoría 0.617—. Filtrando a sustantivos, verbos, adjetivos y nombres propios, el orden se corrige:

| Situación | Similitud |
|---|---|
| El concepto y su propia categoría | 0.76 – 0.81 |
| Categoría distinta, dominio afín | 0.57 – 0.65 |
| Incoherente | 0.31 – 0.44 |

### Visual — ¿la evidencia sirve y es nueva?

Nitidez, resolución, coherencia de la fecha EXIF, y la distancia de Hamming contra el histórico, que calcula el backend porque es quien tiene la base. **Nada de esto es aprendizaje automático, y es deliberado**: son magnitudes exactas, y someterlas a una predicción las volvería menos precisas y menos explicables.

El reconocimiento de escena —«¿esta foto muestra lo que el concepto dice?»— sí necesitaría visión por computadora y no está en esta versión.

### Anomalía — ¿el perfil del gasto es el de siempre?

**Isolation Forest** (scikit-learn) sobre siete características: monto, desviación respecto a la media de su categoría, proveedor nuevo, gastos recientes, fracción del saldo que consume, y los dos desfases de fecha.

Por qué un modelo y no más reglas: el motor determinista ya compara el monto contra ±2σ y marca el proveedor nuevo, pero **no ve combinaciones**. Un monto apenas alto no es sospechoso, un proveedor nuevo tampoco, y tres gastos en la semana tampoco; los tres juntos, en un gasto que además consume casi todo el saldo retenido, sí. Medido sobre el modelo entrenado:

| Perfil | `score_samples` |
|---|---|
| Gastos normales (mediana) | −0.443 |
| Monto muy atípico | −0.605 |
| Consume todo el saldo | −0.607 |
| **Los cuatro a la vez** | **−0.774** |

Ninguna señal suelta baja de −0.61. Esa brecha es la que una regla por señal no puede expresar.

---

## La explicabilidad no la da el modelo

Isolation Forest devuelve un número y nada más, y un número sin motivo viola el RNF-09, que es una exigencia central del proyecto. Por eso cada análisis acompaña el puntaje con los motivos derivados de las características fuera de rango: **el modelo decide cuánto, las reglas de lectura explican por qué.**

Ninguna respuesta sale sin `explicacion.motivos`, y hay una prueba que lo comprueba regla por regla.

---

## Lo que el modelo sabe y lo que no

**El detector de anomalías se entrenó con 600 gastos sintéticos.** La base del proyecto tiene cuatro, y con cuatro muestras un modelo no aprende: memoriza. La distribución se construyó a partir de lo que una ONG animalista pequeña registra de verdad, pero sigue siendo construida.

Eso significa que **el modelo reconoce lo que esa distribución considera raro, no lo que esta organización considera raro.** Son cosas distintas. Si mañana la ONG empieza a operar con montos mayores, el modelo seguirá midiendo contra una referencia inventada hasta que se reentrene.

El camino para cerrar esa brecha ya está:

```bash
python -m entrenamiento.entrenar --real
```

suma los gastos aprobados de la base al conjunto. A medida que se acumule historial real, la referencia deja de ser sintética. La proporción de cada origen queda escrita en `modelos/anomalia.ficha.json`, junto al modelo.

---

## Cuando esto se cae

El backend **no** deja el gasto sin verificar: `MotorAIni` cae al motor de reglas determinista y lo anota en la explicación del análisis, de modo que un auditor pueda ver que ese caso se evaluó con reglas y no con el modelo. Una ONG esperando que se libere su dinero no puede quedar bloqueada porque un proceso de Python se cayó.

Lo mismo si el servicio responde algo que no es el contrato: el backend valida la forma antes de confiar en ella y, si no cuadra, usa el respaldo. Hay diez pruebas en `apps/api` que recorren cada forma de fallar.

---

## Pruebas

```bash
python -m pytest pruebas/ -q
```

20 casos. Lo que fijan no son los números del modelo —un umbral puede moverse al reentrenar— sino el comportamiento que el proyecto promete: que un gasto del fondo equivocado se detecte, que una evidencia reutilizada no se rescate con un comprobante impecable, que nunca falte la explicación, y que un modelo ausente degrade la señal en vez de tumbar la verificación.

---

## Lo que esta versión no hace

- **No lee el comprobante.** Los campos los captura el operador, y el análisis lo declara con `fuente: "declarado"` en vez de afirmar `"ocr"`. El día que haya lectura automática se sabrá qué análisis la tuvieron.
- **No reconoce la escena** de la evidencia.
- **No difumina rostros.** Eso sigue siendo manual, y la restricción que protege al beneficiario vive en la base de datos, no aquí.

Las tres están contempladas en el contrato de datos, así que entran sin cambiarlo.
