# Ayni · guía de la demostración en vivo

Recorrido de 15 minutos por la aplicación con los cinco roles, con el momento de IA hecho **delante del público**: se sube una boleta de verdad y el modelo la lee.

**Esta es la guía de la demostración.** Las otras tres sirven para otra cosa: [presentacion-mvp.md](presentacion-mvp.md) enseña la IA desde la terminal sin interfaz, [guia-interactiva-ia.md](guia-interactiva-ia.md) es el recorrido con el público participando, y [chuleta-exposicion.md](chuleta-exposicion.md) es la tarjeta de referencia para tener abierta al lado.

**La idea que organiza todo:** cada pantalla responde una pregunta que una persona real se hace. No recorras menús; recorre preguntas.

> **Cada cuenta entra a su Inicio**, que ya es una de esas preguntas: *¿qué tengo pendiente?* Desde ahí, las pestañas que nombra esta guía están a un toque. Si sobra tiempo, [guion-demo.md](guion-demo.md#si-sobra-tiempo-lo-que-cada-rol-puede-hacer-ahora) resume lo que cada rol puede hacer además: crear campañas, verificar una ONG, donar cada mes.

---

## 1. Arrancar · cuatro ventanas

> PowerShell 5.1 **no acepta `&&`**. Cada comando va por separado; el `cd` solo hace falta una vez por ventana.

**1 · AIni** — primero, tarda unos segundos en cargar el modelo de lenguaje.

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\aini
```

```bash
python -m uvicorn aini.main:app --host 127.0.0.1 --port 8000
```

**2 · Backend**

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\api
```

```bash
npm run start:prod
```

**3 · Aplicación web**

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\app\build\web
```

```bash
python -m http.server 5000
```

**4 · La ventana de apoyo** — tenla a la vista todo el tiempo.

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\api
```

La aplicación queda en **http://localhost:5000**

---

## 2. Comprobar, cinco minutos antes

En la ventana 4:

```bash
npm run demo:listo
```

Comprueba los tres servicios, **qué motor está conectado de verdad**, el estado de los seis gastos del guion, el saldo que queda para subir uno nuevo, los archivos que vas a adjuntar, y te imprime los códigos del segundo factor con lo que les queda de vida.

Termina diciendo `LISTO` o exactamente qué falta, con el comando para arreglarlo. **Córrelo hasta que diga LISTO.**

> Vigila una línea en particular: si dice *«dice "aini" pero AIni no responde»*, el backend cree que verifica con la IA, AIni no está, y cada gasto nuevo se analizaría con el motor de reglas **sin que nada en la pantalla lo diga**. Es el respaldo funcionando como debe, y a la vez la única forma de exponer «miren la IA» sin IA.

**Y entra una vez con cada rol antes de presentar.** No para ensayar: para que los códigos ya estén probados y no descubras un problema con público delante.

### Lo que necesitas en el Escritorio

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\aini
```

```bash
python probar.py archivos
```

Deja en `Escritorio\boletas-ayni` tres boletas y tres evidencias. **Abre la carpeta y déjala abierta**: vas a elegir archivos desde el diálogo del navegador.

| Archivo | Impreso | Qué teclear | Qué demuestra |
|---|---|---|---|
| `1-boleta-de-78.jpg` | S/ 78.00 | **78** | El lector confirma los cuatro campos |
| `2-boleta-de-78-pero-declare-140.jpg` | S/ 78.00 | **140** | **El acto principal.** El lector lo detecta |
| `3-boleta-ilegible.jpg` | — | 78 | No pudo leer: **no** penaliza, pero sin verificar el papel no se aprueba solo (MEDIO, a revisión) |

Una evidencia distinta por gasto: dos iguales se bloquean por reutilizadas, que es correcto pero no es lo que quieres mostrar ahí.

---

## 3. Las cinco cuentas · clave común `Demo.2026!tr`

| Rol | Correo | Segundo factor |
|---|---|---|
| Donante | `donante@demo.pe` | no pide |
| Operador de campo | `ong.operador@demo.pe` | **sí** |
| Auditor | `auditor@demo.pe` | **sí** |
| Administradora de ONG | `ong.admin@demo.pe` | **sí** |
| Administrador | `admin@demo.pe` | **sí** |

> **El ingreso con segundo factor es en dos pasos y conviene saberlo.** Escribes correo y contraseña, el primer intento «falla» a propósito —el servidor responde que falta el código— y recién ahí aparece el campo de 6 dígitos. No es un error: el campo aparece solo cuando se pide. Pero si no lo esperas, delante del público parece que la contraseña está mal.

---

## 4. Lo que ya está preparado

Seis gastos, cada uno para enseñar algo distinto. **Los dos últimos los decidió AIni.**

| Monto | Estado | Nivel | Motor | Para qué sirve |
|---|---|---|---|---|
| S/ 118 | Aprobado | ALTO 97 | reglas | El camino feliz: resolvió solo y el donante ya tiene su narrativa |
| S/ 64 | Aprobado | ALTO 100 | reglas | Segundo caso automático |
| S/ 189 | **En revisión** | MEDIO 79 | reglas | El RUC no pasa el dígito verificador |
| S/ 72 | **Observado** | BAJO 0 | reglas | **Evidencia reciclada**, detectada a distancia 1 de 64 bits |
| S/ 145 | **En revisión** | MEDIO 76 | **AIni** | **Un alquiler de oficina en el fondo veterinario** |
| S/ 185 | **En revisión** | MEDIO 68 | **AIni** | **Declara S/ 185 sobre una boleta de S/ 158** |

Fondo «Atención veterinaria»: recaudado S/ 383.24 · **retenido S/ 201.24** · ejecutado S/ 182.

> Esas cifras son del día en que se escribió esto. `npm run demo:listo` te imprime las de hoy, que es lo que debes mirar.

---

## Minuto 0–2 · El donante encuentra una causa

**Entra con `donante@demo.pe`** (sin código).

**Causas** → dos campañas de «Huellas del Ande», con sello de organización verificada y su puntaje de confianza.

Abre **«Esterilización comunitaria»** y señala el desglose del puntaje.

> «No es una estrella inventada: son tres componentes con su detalle. Y fíjense en algo —el donante no elige una ONG, elige un **fondo** con una categoría de gasto concreta. Ese es el primer acto de trazabilidad, antes de que entre un sol.»

---

## Minuto 2–4 · Dona, y el dinero queda retenido

Dona **S/ 50** al fondo «Atención veterinaria». Tres pasos, con opción de aporte anónimo.

**Lee en voz alta la confirmación:**

> «Retenido: esperando evidencia.»

> «No dice "gracias por tu donación". Dice que el dinero entró y **la ONG todavía no puede usarlo**. Se liberará cuando alguien demuestre en qué se gastó.»

**Mis aportes** → la línea de tiempo: Donado → **Retenido** → En verificación → Ejecutado.

> «Detrás de esto quedaron tres asientos contables —ingreso, comisión y retención—, encadenados por hash. El libro no admite que se editen ni se borren: lo impide la base de datos, no el código.»

---

## Minuto 4–8 · El acto en vivo: subir una boleta y que la IA la lea

**Es lo único que no se puede preparar.** Los seis gastos de la tabla ya están analizados; este se analiza delante de la sala.

**Sal y entra con `ong.operador@demo.pe`** (pide código). **Gastos** → **Registrar gasto**.

**Paso 1 · Capturar.** En «Comprobante de pago» pulsa **Elegir archivo** → `2-boleta-de-78-pero-declare-140.jpg`. En «Evidencia del gasto» → `evidencia-2.jpg`.

> «En el campo, el operador fotografía la boleta con el teléfono. Acá estoy eligiendo el archivo porque esta laptop no tiene cámara trasera.»

**Paso 2 · Datos.** Fondo **Atención veterinaria** · Monto **140** · Concepto **cirugía veterinaria de un perro atropellado** · Proveedor **Clinica Veterinaria San Roque**.

**Paso 3 · Comprobante.** Boleta · RUC **20601030579** · Serie **B001** · Número **006102** · Fecha de emisión: hoy, ya viene puesta.

> «Fíjense en que no estoy escribiendo nada raro. El RUC es válido, el IGV lo calcula el sistema, las fechas están en orden. **Para cualquier regla aritmética este gasto es impecable.**»

**Registrar gasto.** El trabajador lo toma en unos 5 segundos y el análisis tarda 1 a 3 más. Recarga la lista: aparece **MEDIO**, alrededor de 70.

> «Lo que acaba de pasar: el backend le pasó a AIni una URL firmada del archivo, AIni la descargó, le pasó el reconocimiento de texto, y comparó campo por campo lo leído contra lo que tecleé.»

### Si el momento se enfría, llena el silencio con esto

El análisis tarda unos segundos de silencio incómodo. Es buen momento para decir qué está haciendo: descargando la foto, detectando dónde hay texto, reconociéndolo, y cotejando los cuatro campos.

---

## Minuto 8–10 · El auditor ve lo que el modelo leyó

**Entra con `auditor@demo.pe`** (pide código). **Auditoría** → la bandeja, ordenable por antigüedad o monto, con el plazo de 48 horas hábiles a la vista.

Abre el gasto de **S/ 140** que acabas de crear. Baja hasta la tarjeta **«Lo que el modelo leyó en el papel»**:

```
  RUC emisor        20601030579   ✓
  Documento         B001-006102   ✓
  Fecha de emisión  <hoy>         ✓
  Importe total     S/ 78.00      ✗  se declaró S/ 140.00
```

**Deténte aquí. Es el punto más alto de la demostración.**

> «El modelo descargó la foto, la leyó, y encontró que el papel dice S/ 78. Yo declaré S/ 140.
>
> El fondo iba a pagar S/ 62 que el comprobante no respalda. Y eso **ninguna regla sobre el dato declarado podía verlo**, porque el dato declarado está perfecto: el RUC es válido, el IGV cuadra, las fechas son coherentes. Para verlo hay que leer el documento.»

Señala el resumen del análisis, que lo dice en una línea: *«El comprobante dice S/ 78.00 y se declaro S/ 140.00.»*

> «Y noten el tono: no dice "fraude". Lo más probable es que el operador transpusiera dos dígitos, que es exactamente lo que un sistema así debería ayudar a corregir. Resta puntos y deriva a una persona; no bloquea ni acusa. Hay una prueba automatizada que falla si el texto de la alerta acusa a alguien.»

**Observa el gasto con comentario.**

> «El modelo no decide esto. Encontró el problema y lo explicó en español; decide una persona, y su comentario queda guardado en `revisiones_auditoria` junto al nivel que el motor había propuesto.
>
> Eso significa que **cada decisión de un auditor es una etiqueta supervisada**. El sistema está generando, con el uso, el conjunto de datos con el que se reentrenará el modelo.»

### El otro caso de AIni, si hay tiempo

Abre el de **S/ 145**: un alquiler de oficina cargado al fondo veterinario.

> «Este comprobante no tiene nada mal. El RUC existe, el IGV cuadra, el monto es razonable. Lo único que está mal es que es dinero donado para curar animales, pagando una renta — y eso tampoco lo ve ninguna regla: hay que entender qué **dice** el concepto.»

---

## Minuto 10–12 · El donante ve qué hizo posible su dinero

**Vuelve a `donante@demo.pe`** → **Impacto**. Usa el gasto de **S/ 118**, que ya está aprobado y narrado.

La narrativa nombra **su monto exacto aplicado**, no el total del gasto: el concepto, el proveedor, la fecha, el comprobante y la foto anonimizada.

> «Si tres personas financiaron un gasto de S/ 118, cada una recibe el mensaje con lo que puso ella. No "ayudamos a 300 familias": sus S/ 50 pagaron esta factura.»

Señala el botón de **reportar una inconsistencia**.

> «Y si algo no le cuadra, puede objetar. Eso abre un caso real de auditoría y devuelve el gasto a revisión.»

---

## Minuto 12–14 · El administrador comprueba que todo cuadra

**Entra con `admin@demo.pe`** (pide código) → **Tablero**.

**Arriba:** «El libro contable cuadra», con las cadenas de hashes íntegras.

> «Esto no se calcula desde una sola fuente. Compara los pagos de la pasarela contra los asientos del libro, los saldos de cada fondo contra la suma de sus movimientos, y las aplicaciones contra los montos aprobados. Si recalculara desde un solo lado, cuadraría siempre y no probaría nada.»

**El gráfico del movimiento del dinero:** cuánto entró, cuánto sigue **retenido esperando evidencia**, cuánto se ejecutó.

**Abajo, los indicadores por disciplina.** Señala los que dicen **«Sin medir» con su motivo**.

> «Tres no se pueden medir todavía: dos necesitan instrumentos externos —una encuesta y una prueba de usabilidad con personas— y uno depende de una capacidad que esta versión no tiene.
>
> Un tablero que solo muestra lo que sabe medir sugiere que eso era todo lo que había que medir. Declarar lo que falta es parte de lo que el proyecto propone.»

---

## Minuto 14–15 · Intentar romperlo

En la ventana 4:

```bash
npm run demo:romper
```

Siete intentos de estafar al donante, en SQL directo contra PostgreSQL, por fuera de la API y de toda validación: alterar el libro, borrar un movimiento, repetir un comprobante, reutilizar el archivo, cobrar más de lo que entró, notificar una foto sin difuminar, falsificar la cadena de hashes. **La base rechaza los siete**, y al final recalcula cada SHA-256 fondo por fondo.

> «Ninguna de estas defensas está en el código de la aplicación. Viven en la base de datos, así que un error en el backend —o alguien con acceso a la base y malas intenciones— no las puede sortear.»

Es seguro correrlo en cualquier momento: cada intento vive en una transacción que **siempre** se deshace.

---

## Si solo tienes 6 minutos

Sáltate la donación y el tablero. El esqueleto mínimo que sigue demostrando IA:

1. **`npm run demo:listo`** → verde. *(ya hecho, sin público)*
2. **Operador** sube `2-boleta-de-78-pero-declare-140.jpg` declarando **140**. *(3 min)*
3. **Auditor** abre el gasto y muestra la tarjeta del lector. *(2 min)*
4. **`npm run demo:romper`**. *(1 min)*

Si ni eso cabe, deja solo el paso 3 sobre el gasto de **S/ 185**, que ya está sembrado y analizado: la tarjeta se ve igual y no dependes de que nada funcione en vivo.

---

## Si te sobra tiempo

**Mis datos y privacidad** — en el menú de la cuenta, con cualquier rol.

> «Los tres permisos aparecen aunque no estén otorgados: ocultar uno que no se dio es ocultar que existe. Y cada uno explica qué deja de pasar si se revoca, no solo que se revoca.»

Con `admin@demo.pe`, **Solicitudes**: la bandeja ARCO ordenada por plazo, no por fecha de llegada.

> «Lo que decide a cuál entrar primero es cuánto queda para incumplir. Una rectificación de ayer vence antes que un acceso de hace dos semanas, porque la Ley N.° 29733 les da plazos distintos: 10 días hábiles y 20.»

**Cerrar el círculo completo en vivo** — sube `1-boleta-de-78.jpg` declarando **78** y número **006101**. Debería salir ALTO, aprobarse solo, aplicarse FIFO y llegarle la narrativa al donante.

> **Ensaya este caso antes.** Es el único del guion que escribe en el libro contable, y el libro es de solo inserción: no se puede deshacer. Consume S/ 78 del saldo retenido y cambia las cifras del tablero.

---

## Las preguntas que van a salir

**«¿Esto usa IA?»** — la que importa.
Sí, tres modelos, y **ninguno es una API de terceros**: corren en `apps/aini`, en esta máquina.

| Señal | Técnica | Qué resuelve que una regla no puede |
|---|---|---|
| Lectura del comprobante | **OCR**, redes ONNX | Lee el papel y lo coteja con lo tecleado |
| Coherencia concepto ↔ categoría | **spaCy**, vectores de palabras | Un alquiler no es atención veterinaria |
| Perfil del gasto | **Isolation Forest** (scikit-learn) | Ve *combinaciones* raras, no señales sueltas |

Y la señal **visual** deliberadamente no usa aprendizaje automático: nitidez, EXIF y distancia de Hamming son magnitudes exactas, y someterlas a una predicción las haría menos precisas y menos explicables. Saber dónde *no* poner un modelo es parte del diseño.

**«¿Qué tan bien lee las boletas?»**
Cinco pruebas automatizadas degradan una boleta —borrosa, a media escala, inclinada 7°, oscurecida, con contraste bajo— y exigen que siga leyendo el importe y el RUC. **Pero todas esas boletas las generamos nosotros.** Papel térmico real, arrugado y fotografiado de lado no se ha probado, y eso es justo lo que llega del campo: la cifra de precisión en producción todavía no existe.

**«¿Y si el concepto usa una palabra técnica?»** — adelántala, duele menos.
Ahí falla. `es_core_news_md` se entrenó sobre texto periodístico y no conoce la terminología del dominio: «desparasitación» y «antirrábica» no tienen vector.

| Concepto | Similitud | Veredicto |
|---|---|---|
| «cirugía veterinaria de un perro atropellado» | 0.899 | corresponde |
| «desparasitación de ocho perros rescatados» | 0.418 | **no corresponde** ← falso positivo |

El segundo es un gasto veterinario legítimo y el modelo lo rechaza, porque de sus cuatro palabras solo «perros» y «rescatados» tienen vector. No se arregla con umbrales: se arregla con vectores del dominio. **Está escrito en el código, junto a la función que lo mide** — y es la razón por la que esta señal resta puntos y deriva a una persona en vez de decidir sola.

**«¿Los pagos son reales?»**
No. La pasarela está simulada, con webhook firmado e idempotente. Culqi implementa la misma interfaz cuando haya cuenta de comercio.

**«¿Consultan a SUNAT?»**
No, y el sistema **lo dice** en vez de simularlo: el resultado declara que no pudo confirmar la existencia del comprobante. Se valida el RUC por módulo 11, la serie y la aritmética del IGV. Leer el papel y cotejarlo es otra cosa que sí se hace; que el documento exista en los registros de SUNAT necesita credenciales SOL.

**«¿Por qué el difuminado de rostros es manual?»**
Porque el reconocimiento automático necesita visión por computadora y no está en esta versión. Pero la restricción que protege al beneficiario —no se puede notificar una evidencia sin anonimizar— **vive en la base de datos** y sigue activa igual. Cambia quién marca los rostros, no la garantía. Se demuestra en el minuto 14.

**«¿Qué pasa si se cae el servicio de IA?»**
El gasto no queda sin verificar: lo resuelve el motor determinista y queda anotado en la explicación, para que un auditor sepa con qué criterio se evaluó ese caso. Se puede demostrar en vivo con `npm run demo:comparar -- --url=http://127.0.0.1:9999`.

---

## Si algo falla en vivo

| Síntoma | Qué hacer |
|---|---|
| «No se pudo contactar al servidor» | Se cayó el backend. Relanza `npm run start:prod` en la ventana 2 |
| El código del segundo factor no entra | Caducó. `npm run demo:listo` otra vez; si quedan menos de 10 segundos, espera al siguiente |
| Pantalla en blanco | Ctrl+F5 |
| Un gasto sigue «en análisis» | El trabajador corre cada 5 segundos. Espera y recarga |
| El gasto nuevo dice `reglas-v0` | AIni no está corriendo. `npm run demo:listo` lo detecta y lo dice |
| Todo sale «no se pudo leer el comprobante» | El lector está apagado: `curl http://127.0.0.1:8000/salud` debe decir `"activo":true` |
| «Ya existe un comprobante con esa serie y número» | Ese número ya se usó. Sube la siguiente boleta, o cambia el número |
| «La evidencia ya se había presentado» | Repetiste una evidencia. Usa `evidencia-1/2/3`, una por gasto |
| «El gasto declara más de lo retenido» | Mira el saldo en `demo:listo`. Es correcto que bloquee, pero no es lo que querías mostrar |
| El diálogo de archivos no abre | Usa **Elegir archivo**, no «Tomar foto»: en una laptop no hay cámara trasera |

**No cierres las ventanas 1, 2 y 3 durante la presentación.**

---

## Dos cosas que esta versión no muestra

Dichas acá para que no te sorprendan en vivo:

- **La bandeja del auditor solo lista los casos en revisión**, no los observados. Un gasto bloqueado —como el de S/ 72— lo ve la ONG en su lista, con su motivo, y se resuelve por el flujo de subsanación. No lo busques en la bandeja.
- **La aplicación no tiene pantalla de administración de umbrales.** Se pueden cambiar por la API, y el cambio queda en bitácora, pero no hay interfaz. Si te preguntan por CU18, es más honesto decir eso que improvisar.
