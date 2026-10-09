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
| **Cotejo contra el documento** | **OCR, redes neuronales ONNX** |
| **Coherencia concepto ↔ categoría** | **spaCy, vectores de palabras** |

La última es la única con procesamiento de lenguaje, y es la que justifica tener un modelo en esta señal: **¿el concepto que la ONG escribió corresponde a la categoría del fondo del que está sacando el dinero?** Un «alquiler de oficina» cargado al fondo de «atención veterinaria» tiene el RUC válido, el IGV exacto y las fechas en orden. Ninguna regla aritmética lo ve. El modelo sí.

Un detalle medido y no supuesto: **`Doc.similarity` de spaCy no sirve para esto.** Promedia el documento entero, y las preposiciones pesan tanto como los sustantivos. Sobre los conceptos reales de este proyecto la medida se invertía —«atención veterinaria» contra «alquiler de oficina» puntuaba 0.791, y contra su propia categoría 0.617—. Filtrando a sustantivos, verbos, adjetivos y nombres propios, el orden se corrige:

| Situación | Similitud |
|---|---|
| El concepto y su propia categoría | 0.76 – 0.81 |
| Categoría distinta, dominio afín | 0.57 – 0.65 |
| Incoherente | 0.31 – 0.44 |

### Lectura del comprobante — ¿lo declarado es lo que dice el papel?

Antes de evaluar nada, AIni **descarga la foto o el PDF del comprobante y lo lee** (`ocr.py`), y compara campo por campo lo leído contra lo que el operador tecleó (`cotejo.py`).

Esto cambia de categoría lo que el sistema puede comprobar. Hasta aquí, todas las reglas razonaban **sobre el dato declarado**: que el RUC estuviera bien formado, que el IGV cuadrara, que las fechas fueran posibles. Un operador que teclea `185.00` sobre una boleta de `158.00` pasa todas esas reglas —el dato es impecable— y el fondo paga S/ 27 que el papel no respalda. Para verlo hay que leer el documento.

| Campo | Qué pasa si discrepa | Resta |
|---|---|---|
| Importe total | Es lo que sale del fondo | 35 |
| RUC del emisor | El comprobante es de otro | 30 |
| Serie y número | Es otro documento | 30 |
| Fecha de emisión | Advertencia, no falla | 15 |

**Motor:** `rapidocr-onnxruntime` (detección y reconocimiento en ONNX). Se eligió sobre Tesseract porque no exige instalar un binario del sistema aparte, que en Windows era el punto de fricción del equipo. Cuesta ~2.6 s por imagen, que es la mayor parte del tiempo de análisis.

**Antes que el texto, el QR.** Los comprobantes electrónicos llevan un QR con el formato de SUNAT (`RUC|tipo|serie|número|IGV|total|fecha|…`). Si la foto lo deja decodificar, sus campos mandan sobre lo leído del texto. No es una lectura sino un dato escrito por el sistema de facturación del emisor: no confunde un 1 con un 7, no depende de cómo estén dispuestas las líneas, y retocar el total impreso en la foto no cambia el del QR. Lo decodifica OpenCV, que ya viene con RapidOCR, en décimas de segundo. Si el QR no se puede leer (es pequeño en la foto, o el emisor solo puso un enlace), se sigue con el texto como antes. Cuando el total sale del QR, el mensaje del cotejo lo dice.

**Comprobantes en PDF.** La factura o boleta que llega por correo es un PDF, y el backend ya lo aceptaba, pero AIni no lo sabía leer: lo marcaba como no leído y, como sin cotejo nada se aprueba solo, todo gasto con PDF terminaba en revisión. Ahora el lector reconoce el PDF por su contenido, no por el nombre del archivo. Si lo emitió un sistema de facturación, trae el texto dentro: se extrae tal cual, sin OCR, con confianza 1 y en décimas de segundo. Los trozos se ordenan por su posición en la página, porque algunos sistemas escriben todas las etiquetas y después todos los montos. Si es un escaneo, no hay texto que extraer, y la página se lee como una foto. En los dos casos el QR se busca en la página convertida en imagen. Así, un PDF con el total editado no engaña al cotejo si conserva el QR original. Usa `pypdfium2` (PDFium, el motor de PDF de Chrome) y lee como mucho las dos primeras páginas. El `/salud` indica si está disponible (`leePdf`).

Sobre una boleta degradada a propósito el lector recupera el importe y el RUC con la imagen limpia, borrosa, al 50 % de escala, inclinada 7° hacia cualquier lado, oscurecida al 45 % y con el contraste al 35 %. **Eso no es un dato del README, es `TestRobustez`**: las degradaciones se aplican en la prueba, así que si una versión de la biblioteca empeora, falla en vez de dejar esta frase afirmando algo que dejó de ser cierto.

Comprobantes reales hay **cuatro** en el banco de campo de `evaluacion/`: tres tickets térmicos fotografiados en la mano y una boleta de talonario escrita a mano. Sobre los cuatro, el lector no lee mal ningún campo y no abre ninguna discrepancia falsa. En los térmicos lee el importe, el RUC y la fecha aunque traigan coma decimal, la fecha pegada a la hora o partida en dos líneas, o un «TOTAL GRATUITO» antes del total. Cuando la línea del total es ilegible, lo calcula como subtotal + IGV y el mensaje del cotejo lo indica. En uno el texto no bastaba (los montos salen antes que su etiqueta y no hay IGV impreso para calcular el total), y lo resolvió el QR. **Lo escrito a mano no lo lee**: en la boleta de talonario saca el RUC, la serie y el número, que están impresos, y declara como no leídos la fecha y el total. Leer escritura a mano exigiría otro modelo. Cuatro casos no son una tasa, así que **la cifra honesta de precisión en producción todavía no existe.**

Dos principios gobiernan el cotejo, y los dos están puestos a propósito:

- **Una discrepancia no es un fraude.** Lo más probable es que el operador se equivocara al teclear. Los mensajes lo tratan así, la penalización deriva a revisión humana en vez de bloquear, y hay una prueba que falla si el texto de la alerta acusa.
- **No leer un campo no es una discrepancia.** Un comprobante borroso del que no se pudo sacar el total no dice que el total esté mal: dice que no se pudo verificar. Se declara como tal y **no se penaliza**, porque castigar una foto mala castigaría al operador por su cámara y no por su gasto.
- **Pero sin leer el papel nada se aprueba solo.** El nivel ALTO aprueba el gasto sin que lo mire nadie, y eso exige haber cotejado al menos el total o el RUC contra el comprobante. Si no se pudo, el puntaje no cambia pero el nivel queda en MEDIO, y el gasto pasa a una persona con el motivo `ocr.sin_cotejo`. Antes, una boleta ilegible con todo lo demás en orden se aprobaba sola con 90 puntos: nada de lo verificado venía del papel.

Cuando el lector consigue leer, `datos_extraidos.fuente` pasa a `"ocr"` y **se reportan los valores del papel, no los declarados**, aunque difieran. Si se devolvieran los declarados, el campo diría `"ocr"` sobre datos que nadie verificó contra el documento, que es peor que no leerlo. La discrepancia no se pierde: viaja como motivo, con los dos valores, y abre una alerta `DECLARACION_NO_COINCIDE`.

Se puede apagar con `AINI_OCR=0`. El `/salud` reporta si está activo, porque apagado no falla: devuelve «no se pudo leer» como si todas las fotos fueran malas, y ningún gasto llega a ALTO.

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

Las pruebas fijan el comportamiento; **cuánto acierta** el motor lo mide `python -m evaluacion` contra bancos etiquetados y una línea base versionada. Ver [`evaluacion/README.md`](evaluacion/README.md).

107 casos. Lo que fijan no son los números del modelo —un umbral puede moverse al reentrenar— sino el comportamiento que el proyecto promete: que un gasto del fondo equivocado se detecte, que una evidencia reutilizada no se rescate con un comprobante impecable, que un monto que no coincide con el papel se detecte y que una foto ilegible no se confunda con uno, que nunca falte la explicación, y que un modelo ausente degrade la señal en vez de tumbar la verificación.

---

## Lo que esta versión no hace

- **No valida el comprobante contra SUNAT.** Se lee el papel y se coteja contra lo declarado, pero que el documento exista de verdad en los registros de SUNAT es otra pregunta, y necesita credenciales SOL.
- **No reconoce la escena** de la evidencia.
- **No difumina rostros.** Eso sigue siendo manual, y la restricción que protege al beneficiario vive en la base de datos, no aquí.

Las tres están contempladas en el contrato de datos, así que entran sin cambiarlo.
