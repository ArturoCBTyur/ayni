# Evaluación de AIni

Mide **cuánto acierta** AIni contra bancos etiquetados. Las pruebas (`pruebas/`) fijan el comportamiento que no puede cambiar; esto da la cifra que cada mejora tiene que mover en la dirección correcta.

```bash
python -m evaluacion                    # todo lo disponible
```

```bash
python -m evaluacion --solo conceptos --detalle
```

```bash
python -m evaluacion --comparar         # 1 si algo empeoró, 2 si el banco cambió
```

```bash
python -m evaluacion --guardar          # reescribe linea_base.json
```

Se corre desde `apps/aini`.

## Los bancos

| Archivo | Qué es | Se versiona |
|---|---|---|
| `conceptos.csv` | Conceptos de gasto con la categoría que les corresponde | Sí |
| `comprobantes.py` | Boletas sintéticas, dibujadas y degradadas en cada corrida | Sí (el código) |
| `campo.jsonl` | Anotación de cada comprobante real, con su hash | Sí |
| `campo/` | Las fotos reales | **No** |
| `linea_base.json` | Las métricas de referencia | Sí |

### Conceptos

Columnas: `concepto, categoria, corresponde, alternativas, origen`.

- Las categorías son **las del backend** (`enum CategoriaGasto` del esquema de Prisma), no las que AIni describe. Es lo que llega en producción.
- Cada concepto con `corresponde=si` se mide contra su categoría y contra las demás: esos son los pares ajenos. `alternativas` (separadas por `|`) excluye las categorías donde el gasto también sería legítimo, y `OTROS` nunca cuenta como ajena.
- Un par ajeno contra una categoría que AIni no sabe medir cuenta como **aceptado**, porque en producción «no se pudo evaluar» no resta puntos. Si se dejara fuera, un desvío hacia esa categoría no contaría en ningún lado.
- `corresponde=no` añade pares ajenos explícitos, como los casos difíciles de `probar.py`.
- `origen=control-*` son conceptos escritos **antes** del cambio que van a medir, con términos que no lo motivaron. `rechazaCorrectosPorOrigen` los mide aparte: la mejora sobre los conceptos que inspiraron un cambio es optimista, y la de los de control no.
- `origen=redactado` son conceptos escritos para arrancar el banco, **sin revisar todavía por el equipo**. Las etiquetas entre `MEDICAMENTOS` y `ATENCION_VETERINARIA` son las más discutibles. Hay que revisarlas y sumar conceptos reales de la base.

### Comprobantes de campo

1. Fotografiar el comprobante como lo haría el operador: con el celular y con prisa. **Tachar antes el nombre y el DNI del cliente**, para que el archivo nunca los contenga.
2. Guardar la foto en `evaluacion/campo/` (carpeta privada, fuera de git).
3. Añadir su línea a `campo.jsonl` con lo que dice el papel y el hash del archivo. Si la imagen falta o el hash no coincide, el caso se omite y se avisa.
4. Que otra persona revise la anotación: un error de anotación se cuenta como error del lector.

Cuando se amplía un banco, la comparación devuelve 2. Hay que regenerar la línea base **en el mismo commit**.

## Cómo leer las cifras del lector

Cada campo cae en una de tres clases, porque no cuestan lo mismo:

- **no leído**: no penaliza a nadie.
- **incorrecto**: genera una discrepancia falsa y una alerta que la ONG lee. Es la cifra que más importa vigilar.

El banco sintético es más fácil que la realidad: son boletas nítidas degradadas con filtros. La cifra que vale para producción es la del banco de campo. Además, el sintético depende de las fuentes y de onnxruntime de cada sistema operativo, así que la integración continua (Linux) compara solo los conceptos.

## Línea base inicial (2026-10-08, código sin cambios)

**Conceptos** (180 conceptos, 911 pares ajenos):

| Métrica | Valor |
|---|---|
| Cobertura (gastos en los que se pudo medir) | 77,2 % |
| Rechaza conceptos correctos | 33,8 % |
| Acepta equivocados | 9,6 % |
| Acierta la categoría como la más parecida | 74,1 % |

- El rechazo de correctos es más del doble del ~15 % que documenta `documental.py`, medido sobre 25 conceptos. Con un banco más variado, la cifra empeora. Parte puede deberse a cómo están redactados los conceptos; la revisión del banco lo dirá.
- **ESTERILIZACION y OTROS nunca se miden.** El backend envía esas categorías, pero AIni no las describe, y a cambio describe SERVICIOS y ADMINISTRATIVO, que el backend no usa. Esos gastos reciben «no se pudo evaluar» sin restar puntos.
- Hay 15 palabras sin vector. Las del dominio: «desparasitacion», «antirrabica», «garrapaticida», «ovariohisterectomía», «venoclisis», «gatario». Las de lugar: «huánuco», «pillco», «huallaga». También «castracion» sin tilde. Todas las palabras de las descripciones de categoría sí tienen vector.

**Lector, banco sintético** (18 comprobantes):

| Métrica | Valor |
|---|---|
| Total leído correctamente | 88,9 % |
| Total leído incorrectamente | 5,6 % (1 caso) |
| Discrepancias falsas | 5,6 % |
| Distingue un monto alterado en S/ 27 | 88,9 % |
| Tiempo por comprobante (mediana) | 3–4 s |

«Distingue» exige que el cotejo alerte con el monto alterado **y no** con el correcto. Un total mal leído alertaría con cualquier cosa que se teclee, y eso no es detección.

- `s11`: con las etiquetas «SUBTOTAL» y «TOTAL», el total se lee del subtotal y se acusa una discrepancia que no existe.
- `s05`: inclinada +7°, el OCR pone cada monto antes de su etiqueta y se lee mal. `TestRobustez` solo prueba −7°.
- `s14`, `s15`: las series «FA01» y «EB01» no se reconocen.
- `s16`, `s17`: las fechas «14-SEP-2026» y «2026-09-14» no se reconocen.

**Lector, banco de campo** (3 comprobantes reales):

| Métrica | Valor |
|---|---|
| RUC leído correctamente | 3 de 3 |
| **Total leído correctamente** | **0 de 3** |
| Discrepancias falsas | 1 de 3 |
| Fecha, subtotal o IGV leídos | 0 de 3 |
| Tiempo por comprobante (mediana) | ~11 s |

- `c001` (SuperPet, térmica, doblada, sostenida a mano):
  - **Acusa una discrepancia falsa.** El «TOTAL A PAGAR» sale tenue y el OCR lo lee como basura, así que el lector toma el importe de «TOTAL GRATUITO» (16,78). Un operador que tecleó bien S/ 99 recibiría una alerta.
  - La coma decimal («S/ 83,90») impide leer el subtotal y el IGV.
  - La fecha AAAA-MM-DD, partida en dos líneas, no se lee.
- `c002` (talonario, escrito a mano, escaneado): solo se lee el RUC. La serie «001» no tiene letra y la fecha y el total están manuscritos.
- `c003` (térmica, baja resolución, sin serie impresa): solo se lee el RUC. La coma decimal y la etiqueta «GRAVADA» sin «OP.» no se reconocen.
- Las fotos reales tardan unas tres veces más que las sintéticas, porque son más grandes.
