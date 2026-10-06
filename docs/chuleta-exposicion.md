# Ayni · chuleta de exposición — versión local

Ten esto abierto en otra ventana. Una página, nada más.

---

## Arrancar (si algo se cayó)

> **PowerShell no acepta `&&`.** La versión 5.1 de Windows da un error de
> sintaxis con ese separador. Cada comando va por separado; el `cd` solo hace
> falta una vez por ventana.

**Ventana 1 — la API.** Va primero: el worker de verificación vive ahí.

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\api
```

```bash
npm run start:prod
```

**Ventana 2 — AIni.** El motor de IA. Tarda unos segundos en cargar spaCy.

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\aini
```

```bash
python -m uvicorn aini.main:app --host 127.0.0.1 --port 8000
```

Comprobar que está arriba, y que el lector de comprobantes está encendido:

```bash
curl http://127.0.0.1:8000/salud
```

Debe decir `"lectorComprobantes":{"activo":true}`. Si dice `false`, el OCR está apagado por la variable `AINI_OCR` y todos los gastos saldrán con «no se pudo leer el comprobante».

**Para que la API use AIni y no el motor de reglas**, en `apps/api/.env`: `VERIFICACION_DRIVER=aini`. Si AIni no responde, la API **no** se queda sin verificar: cae al motor de reglas y lo anota en el análisis.

**Ventana 3 — la aplicación web.**

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\app\build\web
```

```bash
python -m http.server 5000
```

**Ventana 4 — los códigos del segundo factor.**

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\api
```

```bash
npm run demo:codigos
```

La aplicación queda en **http://localhost:5000**

Si la base quedara vacía, en la ventana 4: `npx tsx prisma/seed-demo.ts` y después `npm run demo:preparar`.

---

## Cuentas · clave común `Demo.2026!tr`

| Rol | Correo | Segundo factor |
|---|---|---|
| Donante | `donante@demo.pe` | no pide |
| Operador de campo | `ong.operador@demo.pe` | **sí** |
| Auditor | `auditor@demo.pe` | **sí** |
| Administradora de ONG | `ong.admin@demo.pe` | **sí** |
| Administrador | `admin@demo.pe` | **sí** |

**Los códigos del segundo factor ya están enrolados.** Para verlos, en la ventana 4:

```bash
npm run demo:codigos
```

Cambian cada 30 segundos. El comando dice cuántos quedan; si estás por debajo de 10, vuelve a correrlo antes de teclear.

---

## Qué hay preparado

Seis gastos, uno por cada cosa que quieres enseñar. Los dos últimos los decidió **AIni**; los cuatro primeros, el motor de reglas:

| Monto | Estado | Nivel | Motor | Qué demuestra |
|---|---|---|---|---|
| S/ 118 | Aprobado | **ALTO** 97 | reglas | El camino feliz: resolvió solo y el donante ya recibió su narrativa |
| S/ 189 | **En revisión** | MEDIO 79 | reglas | **El auditor decide.** El dígito verificador del RUC no cuadra |
| S/ 64 | Aprobado | ALTO 100 | reglas | Segundo caso automático |
| S/ 72 | **Observado** | **BAJO** 0 | reglas | Evidencia reciclada, detectada a distancia 1 de 64 bits con un SHA-256 **distinto** |
| S/ 145 | **En revisión** | MEDIO 76.37 | **AIni** | **Un alquiler de oficina cargado al fondo veterinario.** Comprobante impecable; ninguna regla aritmética lo ve. El modelo de lenguaje sí |
| S/ 185 | **En revisión** | MEDIO 68.47 | **AIni** | **Declara S/ 185 sobre una boleta de S/ 158.** El lector leyó el papel. Ninguna regla podía: el dato tecleado es perfecto |

Fondo «Atención veterinaria»: recaudado S/ 383.24 · **retenido S/ 201.24** · ejecutado S/ 182.

> Que la tabla diga qué motor decidió cada gasto **no es decoración**: `analisis_aini` guarda el modelo y la regla de umbrales vigentes al momento (RN-06). Dos años después se puede saber con qué criterio se aprobó un gasto, no solo que se aprobó.

**Los dos casos de AIni son los que valen en el curso de IA.** Si solo te da tiempo para uno, usa el de S/ 185: un número impreso contra otro tecleado se entiende sin explicar nada.

---

## El acto en vivo: subir una boleta y verla recorrer los roles

**Es lo que no se puede preparar.** Los seis gastos sembrados ya están analizados; este se analiza delante de la sala.

### Antes de empezar (una vez, sin público)

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\aini
```

```bash
python probar.py archivos
```

Escribe en el Escritorio, en `boletas-ayni`, tres boletas y tres evidencias. **Abre la carpeta y déjala lista**, porque vas a elegir archivos desde el diálogo del navegador.

| Archivo | Impreso | Qué teclear | Qué demuestra |
|---|---|---|---|
| `1-boleta-de-78.jpg` | S/ 78.00 | **78** | El lector confirma los cuatro campos |
| `2-boleta-de-78-pero-declare-140.jpg` | S/ 78.00 | **140** | **El que importa.** El lector detecta el monto |
| `3-boleta-ilegible.jpg` | — | 78 | No pudo leer: lo declara y **no** penaliza |

Usa una evidencia distinta por gasto: dos iguales se bloquean por reutilizadas, que es correcto pero no es lo que quieres mostrar ahí.

### En vivo · Operador (`ong.operador@demo.pe` + código)

Gastos → **Registrar gasto**.

1. **Paso 1.** En «Comprobante de pago» pulsa **Elegir archivo** → `2-boleta-de-78-pero-declare-140.jpg`. En «Evidencia del gasto» → `evidencia-2.jpg`.
2. **Paso 2.** Fondo **Atención veterinaria** · Monto **140** · Concepto **cirugía veterinaria de un perro atropellado** · Proveedor **Clinica Veterinaria San Roque**.
3. **Paso 3.** Boleta · RUC **20601030579** · Serie **B001** · Número **006102** · Fecha de emisión: hoy (ya viene puesta).
4. **Registrar gasto.**

> «Fíjense en que no estoy escribiendo nada raro. El RUC es válido, el IGV lo calcula el sistema, las fechas están en orden. Para cualquier regla aritmética este gasto es impecable.»

El worker lo toma en unos 5 s y el análisis tarda ~1-3 s más. En la lista de gastos aparece **MEDIO**, alrededor de 70.

### En vivo · Auditor (`auditor@demo.pe` + código)

Auditoría → el gasto de **S/ 140** → baja a **«Lo que el modelo leyó en el papel»**:

```
  RUC emisor        20601030579   ✓
  Documento         B001-006102   ✓
  Fecha de emisión  <hoy>         ✓
  Importe total     S/ 78.00      ✗  se declaró S/ 140.00
```

> «El modelo descargó la foto, la leyó, y encontró que el papel dice S/ 78. Se declararon S/ 140. El fondo iba a pagar S/ 62 que el comprobante no respalda — y eso ninguna regla sobre el dato declarado podía verlo, porque el dato declarado está perfecto.»

Y el resumen del análisis lo dice en una línea: *«El comprobante dice S/ 78.00 y se declaro S/ 140.00.»*

→ **Observa** el gasto con comentario. Vuelve al operador: el gasto está observado, con el motivo en español.

### Si quieres cerrar el círculo

Repite con `1-boleta-de-78.jpg` declarando **78** y número **006101**. Sale **ALTO**, se aprueba solo, se aplica FIFO y **el donante recibe la narrativa**. Es el contraste que remata: el mismo sistema, el mismo lector, y la diferencia la hace el papel.

> Hay S/ 201.24 retenidos en el fondo. Alcanza para los tres gastos de la tabla; si subes más, revisa el saldo o el bloqueo por saldo insuficiente aparecerá y será correcto, pero no es lo que querías enseñar.

---

## El recorrido, en orden

**1 · Donante** (`donante@demo.pe`, sin código)
Causas → «Esterilización comunitaria» → dona S/ 50 → **la confirmación dice «Retenido: esperando evidencia»**, no «gracias».
→ Mis aportes: la línea de tiempo Donado → Retenido → En verificación → Ejecutado.

> Aquí está el argumento del proyecto: el dinero entró y la ONG **todavía no puede usarlo**.

**2 · Operador** (`ong.operador@demo.pe` + código)
Gastos → abre el de **S/ 72**, el observado.
→ El motivo en español: la evidencia coincide con una foto ya presentada.

> «El archivo es distinto, los bytes no coinciden. Lo que coincide es la imagen. Distancia 1 de 64 bits.»

**3 · Auditor** (`auditor@demo.pe` + código) — **el momento de IA**
Auditoría → el caso de **S/ 185** → comprobante, evidencia y señales lado a lado.

Baja a la tarjeta **«Lo que el modelo leyó en el papel»**. Campo por campo: RUC ✓, documento ✓, fecha ✓, y el importe en rojo — **S/ 158.00**, con «se declaró S/ 185.00» debajo.

> «El RUC es válido, el IGV cuadra, las fechas están bien. Todas las reglas del sistema miran el dato que el operador escribió, y ese dato es impecable. El modelo leyó la boleta, y la boleta dice otra cosa: el fondo iba a pagar S/ 27 que el comprobante no respalda.»

→ Aprueba u observa **con comentario obligatorio**.

> «El modelo no decide esto. Encontró el problema y lo explicó en español; decide una persona, y su comentario queda guardado en `revisiones_auditoria`: **es la etiqueta con la que se reentrenará AIni.**»

**3b · El otro caso de AIni**, si hay tiempo: el de **S/ 145**, un alquiler de oficina cargado al fondo veterinario.

> «Este comprobante no tiene nada mal. El RUC existe, el IGV cuadra, el monto es razonable. Lo único que está mal es que es dinero donado para curar animales, pagando una renta — y eso no lo ve ninguna regla aritmética, hay que entender qué dice el concepto.»

**4 · Donante otra vez** → Impacto
La narrativa nombra **su monto exacto aplicado**, no el total del gasto.

**5 · Administrador** (`admin@demo.pe` + código) → Tablero
Arriba: **«El libro contable cuadra»**. Abajo: los indicadores, y los que dicen **«Sin medir» con su motivo**.

> «Un tablero que solo muestra lo que sabe medir sugiere que eso era todo lo que había que medir.»

---

## Si te sobra tiempo

### Intentar romperlo, en vivo

```bash
npm run demo:romper
```

Siete intentos de estafar al donante, en SQL directo contra PostgreSQL, por fuera de la API y de toda validación: alterar el libro, borrar un movimiento, repetir un comprobante, reutilizar el archivo, cobrar más de lo que entró, notificar una foto sin difuminar, falsificar la cadena de hashes. **La base rechaza los siete**, y al final recalcula cada SHA-256 fondo por fondo.

> «Ninguna de estas defensas está en el código de la aplicación. Viven en la base, así que un error en el backend —o alguien con acceso a la base y malas intenciones— no las puede sortear.»

Es seguro correrlo minutos antes de exponer: cada intento vive en una transacción que **siempre** se deshace.

### El lector de comprobantes, con otros números

```bash
python probar.py boleta --impreso 158 --monto 185
```

Desde `apps/aini`. Dibuja la boleta, la lee y muestra el cotejo campo por campo. Pon los dos importes iguales y el gasto sale ALTO: sirve para mostrar que el lector no busca problemas donde no hay.

### El libro, verificable por un tercero

El CSV del libro incluye `hash_previo` y `hash_actual` de cada movimiento: **un tercero puede recalcular la cadena por su cuenta, sin confiar en que el sistema diga la verdad sobre sí mismo.**

---

## Las preguntas que te van a hacer, con su respuesta

**«¿Esto usa IA?»** — la que importa en este curso.
Sí, tres modelos distintos, y **ninguno es una API de terceros**: corren en `apps/aini`, en esta máquina.

| Señal | Técnica | Qué hace que una regla no pueda |
|---|---|---|
| Lectura del comprobante | **OCR, redes ONNX** | Lee el papel y lo compara con lo tecleado |
| Coherencia concepto ↔ categoría | **spaCy, vectores de palabras** | Entiende que un alquiler no es atención veterinaria |
| Perfil del gasto | **Isolation Forest** (scikit-learn) | Ve *combinaciones* raras, no señales sueltas |

Y una señal que **deliberadamente no** usa aprendizaje automático: la visual. Nitidez, EXIF y distancia de Hamming son magnitudes exactas; someterlas a una predicción las haría menos precisas y menos explicables. Saber dónde *no* poner un modelo es parte del diseño.

El puntaje nunca lo decide el modelo solo: **los pesos y los umbrales llegan en cada petición** y quedan registrados con el análisis (RN-06), así que el administrador los cambia sin redesplegar nada.

**Si te preguntan por la precisión, no infles la cifra.** Está medida y es modesta: el detector de anomalías se entrenó con 600 gastos sintéticos porque la base real tiene cuatro; la señal de lenguaje deja pasar ~13 % de las categorizaciones erróneas; el lector solo se probó sobre boletas que generamos nosotros, no sobre papel térmico real. **Por eso las tres señales restan puntos y derivan a una persona en vez de decidir solas.** Eso es un argumento de diseño, no una disculpa.

**«¿Y si el concepto usa una palabra técnica?»** — la pregunta que más duele, y conviene adelantarla.
Ahí falla. `es_core_news_md` se entrenó sobre texto periodístico y **no conoce la terminología del dominio**: «desparasitación» y «antirrábica» no tienen vector. Medido:

| Concepto | Similitud | Veredicto |
|---|---|---|
| «cirugía veterinaria de un perro atropellado» | 0.899 | corresponde |
| «desparasitación de ocho perros rescatados» | 0.418 | **no corresponde** ← falso positivo |

El segundo es un gasto veterinario legítimo y el modelo lo rechaza, porque de sus cuatro palabras solo «perros» y «rescatados» tienen vector, y ninguna dice que sea atención veterinaria.

No se arregla con umbrales: se arregla con vectores del dominio —entrenar sobre texto veterinario, o mantener un diccionario de términos—. **Está escrito en el código, junto a la función que lo mide.** Y es la razón por la que esta señal resta puntos y deriva a una persona en vez de decidir sola.

**«¿Los pagos son reales?»**
No. La pasarela está simulada, con webhook firmado e idempotente. Culqi implementa la misma interfaz cuando haya cuenta de comercio.

**«¿Consultan a SUNAT?»**
No, y el sistema **lo dice** en vez de simularlo. Se valida el RUC por módulo 11, la serie y la aritmética del IGV, y el resultado declara que no pudo confirmar la existencia del comprobante. La consulta real necesita credenciales SOL.

---

## Si algo falla en vivo

| Síntoma | Qué hacer |
|---|---|
| «No se pudo contactar al servidor» | La API se cayó. Relanza `npm run start:prod` |
| El código del segundo factor no entra | Caducó. `npm run demo:codigos` otra vez |
| La pantalla queda en blanco | Recarga con Ctrl+F5 |
| Un gasto sigue «en análisis» | El worker corre cada 5 s. Espera y recarga |
| Todo sale «no se pudo leer el comprobante» | AIni está caída o el OCR apagado: `curl http://127.0.0.1:8000/salud` |
| Los análisis dicen `reglas-v0` y esperabas AIni | Falta `VERIFICACION_DRIVER=aini` en `.env`; reinicia la API |
| «Ya existe un comprobante con esa serie y número» | Ese número ya se usó. Sube la siguiente boleta de la tabla, o cambia el número |
| «La evidencia ya se había presentado» | Repetiste una evidencia. Usa `evidencia-1/2/3`, una por gasto |
| «El gasto declara más de lo retenido» | Quedan S/ 201.24 en el fondo. Es correcto que bloquee, pero no es el caso que querías mostrar |
| El diálogo de archivos no abre | Usa **Elegir archivo**, no «Tomar foto»: en una laptop no hay cámara trasera |

**No cierres la terminal de la API durante la exposición.**
