# Ayni · guía interactiva para probar la IA en vivo

Cómo demostrar los modelos delante de público, con el público participando.

El recorrido empieza por lo más concreto —**el lector de comprobantes**, que lee una boleta y detecta que el importe declarado no es el impreso— y termina en lo más convincente: **pedirle a alguien de la sala que proponga un gasto** y ver cómo lo clasifica el modelo de lenguaje. Todo lo demás se puede preparar; eso no.

---

## Preparación

Una sola ventana de PowerShell. No hace falta ni el backend ni la base: el banco de pruebas habla directo con el modelo.

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\aini
```

**Ensáyalo una vez antes**, no para memorizarlo sino porque la primera carga del modelo de lenguaje tarda unos segundos y conviene que eso pase sin público.

El acto del lector tarda unos 3 s en leer la imagen, y se nota en silencio delante de la sala. Es buen momento para decir en voz alta qué está haciendo: descargando la foto, detectando dónde hay texto y reconociéndolo.

---

## El recorrido guiado

```bash
python probar.py demo
```

Avanza por actos; cada uno espera un Enter, así que tú marcas el ritmo.

### Acto 1 · Lee el comprobante y lo compara con lo declarado

Dibuja una boleta de S/ 158, declara S/ 185, y deja que el modelo lea la imagen.

```
  El papel dice    S/ 158.00
  Se declara       S/ 185.00

  Nivel  MEDIO      Puntaje 78.72

  El lector encontro en la imagen:
    RUC          20601030579  = lo declarado
    Comprobante  B001-000123  = lo declarado
    Fecha        2026-09-14   = lo declarado
    Total        S/ 158.00    != se declaro S/ 185.00
```

> «El RUC es válido, el IGV cuadra, las fechas están bien. Para el motor de reglas este gasto es impecable, porque todas sus reglas miran el dato que el operador tecleó. El modelo leyó el papel, y el papel dice otra cosa: el fondo iba a pagar S/ 27 que el comprobante no respalda.»

**Es el acto que mejor funciona, y por eso va primero:** no hace falta confiar en ninguna medida de similitud para entender un número impreso contra otro tecleado.

Si alguien pregunta si es fraude, la respuesta honesta es que casi nunca: lo más probable es que el operador transpusiera dos dígitos. Por eso el sistema deriva el caso a una persona en vez de bloquearlo, y por eso ni la alerta ni el mensaje acusan a nadie — hay una prueba que falla si el texto lo hace.

### Acto 2 · Un gasto que ninguna regla detecta

Muestra un alquiler de oficina cargado al fondo veterinario.

```
  concepto   "alquiler de oficina administrativa y mobiliario de escritorio"
  fondo      ATENCION_VETERINARIA
  similitud  0.441
  veredicto  NO CORRESPONDE
```

> «El comprobante es impecable: RUC válido, IGV exacto, fechas coherentes. El motor de reglas lo aprueba automáticamente. Lo único que está mal es que es dinero donado para curar animales, pagando una renta.»

### Acto 3 · El mismo gasto, en su fondo correcto

```
  fondo      ADMINISTRATIVO
  similitud  0.603
  veredicto  CORRESPONDE
```

> «No es que el modelo desconfíe del alquiler. Desconfía del fondo.»

### Acto 4 · No busca palabras, mide significado

Dos conceptos cuyas palabras **no aparecen** en la descripción de su categoría, y aun así los clasifica bien.

### Acto 5 · Dónde se equivoca

Muestra «compra de alimento» aceptado contra la categoría veterinaria, que es un error.

> «Un modelo que solo se enseña acertando no se puede evaluar.»

### Acto 6 · El público propone

Queda un prompt abierto. **Aquí es donde la demostración se gana o se pierde.**

Pide un gasto que una ONG animalista podría registrar. El modelo muestra la similitud contra las ocho categorías, ordenadas, y dice cuál elegiría.

---

## Cómo manejar el acto 6

### Si aciertas

No lo celebres de más. Lo útil es señalar **por qué**:

> «Fíjense que esa palabra no está en ninguna descripción. Lo que midió es la cercanía de significado.»

### Si falla

**Esto es una oportunidad, no un accidente.** Tienes la respuesta preparada:

> «Ahí se equivocó, y conviene ver por qué. Medimos esto: en el umbral actual el modelo deja pasar cerca de una de cada ocho categorizaciones erróneas. Por eso esta señal **resta puntos y deriva a una persona**, en vez de decidir sola. Un bloqueo con esa tasa sería inaceptable; una derivación a revisión con esa tasa es útil.»

Que falle delante de todos y tengas el número a la mano es **más convincente** que una ronda de aciertos.

### Si alguien propone algo fuera de dominio

Cosas como «compra de un satélite» o «pago a un abogado espacial». El modelo dará similitudes bajas en todas.

> «No tiene ninguna categoría cerca, y eso también es información: la organización no registra gastos así.»

---

## Si quieren ver más

### Dónde falla, sistemáticamente

```bash
python probar.py limites
```

Una batería de 13 casos difíciles a propósito. Hoy acierta 11.

> «No elegí los casos fáciles. Estos están puestos para que falle, y los dos que falla están documentados.»

### El lector, con otros números

```bash
python probar.py boleta --impreso 158 --monto 185
```

Cambia los dos importes y se repite el acto 1 con el caso que quieras. `--impreso` es lo que se dibuja en el papel; `--monto`, lo que se declara. Si los pones iguales, el cotejo confirma los cuatro campos y el gasto sale ALTO — útil para mostrar que el lector no está buscando problemas donde no hay.

No hace falta tener una imagen a mano ni servirla: el subcomando dibuja la boleta, la publica en un puerto local, la analiza y apaga el servidor. El modelo hace exactamente lo que hace en producción, porque el lector solo acepta URLs `http(s)` — darle rutas del disco sería dejarle abrir cualquier archivo a quien llame.

### Un gasto completo, con las tres señales

```bash
python probar.py gasto --monto 480 --proveedor-nuevo --gastos-recientes 5
```

Muestra el veredicto con los motivos de las tres señales: documental, visual y de anomalía. Útil si preguntan por el Isolation Forest.

Prueba a cambiar un parámetro a la vez y ver cómo se mueve el puntaje de anomalía: es la forma más clara de mostrar que **la combinación pesa más que cada señal suelta**.

### Un concepto suelto, contra todas las categorías

```bash
python probar.py concepto "reparacion del techo del albergue"
```

---

## Las preguntas que van a salir, con su respuesta

**«¿Cómo sabe el modelo qué significa cada categoría?»**
Cada categoría tiene una descripción en palabras, y se compara el concepto contra ella. No contra el código `ATENCION_VETERINARIA`, que no tiene significado para el modelo, sino contra «atención veterinaria clínica consulta cirugía esterilización».

**«¿Y si cambio la descripción?»**
Cambia el comportamiento, y está medido cómo. Descripciones más largas resultaron **peores**: el vector es el promedio de sus palabras, y cada término genérico acerca una categoría a las demás.

**«¿Qué tan bueno es?»**
Medido sobre 25 conceptos reales contra las ocho categorías: en el umbral actual rechaza cerca del 15 % de los conceptos correctos y acepta cerca del 13 % de los equivocados. Las clases se solapan y ningún umbral las separa limpio. Por eso la señal deriva en vez de decidir.

**«¿Qué tan bien lee las boletas?»**
Hay cinco pruebas automatizadas que degradan una boleta —borrosa, a media escala, inclinada 7°, oscurecida, con contraste bajo— y exigen que siga leyendo el importe y el RUC. Pero todas esas boletas las generamos nosotros. **Papel térmico real, arrugado y fotografiado de lado no se ha probado**, y eso es justo lo que llega del campo — así que la cifra de precisión en producción todavía no existe. Lo que sí está resuelto es qué pasa cuando no puede leer: lo declara y **no penaliza**, porque castigar una foto mala sería castigar al operador por su cámara.

**«¿Y si el operador se equivocó sin mala intención?»**
Es el caso más probable, y el sistema está construido asumiéndolo. Una discrepancia resta puntos y deriva a revisión humana; no bloquea ni acusa. Hay una prueba automatizada que falla si el texto de la alerta usa palabras como «fraude».

**«¿Por qué no usaron ChatGPT?»**
Porque el sistema trata datos de beneficiarios de programas sociales, categoría sensible bajo la Ley N.° 29733. Con un modelo propio las evidencias no salen de la infraestructura del proyecto. Y no hay clave que custodiar ni cuota que se agote a mitad de una demostración.

---

## Si algo falla

| Síntoma | Qué hacer |
|---|---|
| Tarda mucho al arrancar | Normal: carga el modelo de lenguaje (~5 s). Solo la primera vez |
| `ModuleNotFoundError` | `pip install -r requirements.txt` |
| `No se pudo medir` | El concepto no tiene sustantivos ni verbos reconocibles |
| Caracteres raros en pantalla | La consola es cp1252; el texto se lee igual |
| El acto 1 dice «no se pudo leer» | El lector está apagado: revisa que `AINI_OCR` no valga `0` |
| El acto 1 tarda más de 10 s | Primera lectura del proceso: carga los modelos ONNX. La segunda baja a ~3 s |

El banco de pruebas **no necesita** el backend, la base ni AIni corriendo. Si todo lo demás se cae, esto sigue funcionando.
