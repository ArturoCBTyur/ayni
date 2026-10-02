# Ayni · cómo presentar el MVP con IA

Guion de 12 minutos. Lo que hay que enseñar, en qué orden, y qué decir en cada punto.

**La idea que organiza todo:** no presentes «un sistema que usa IA». Presenta un sistema que ya funcionaba, y muestra **exactamente qué empezó a ver cuando se le puso el modelo**. Eso es demostrable en vivo y no se puede fingir.

---

## Antes de empezar

### Tres ventanas de PowerShell

> PowerShell 5.1 **no acepta `&&`**. Cada comando va por separado; el `cd` solo hace falta una vez por ventana.

**Ventana 1 — AIni.** Primero, porque tarda unos segundos en cargar el modelo de lenguaje.

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\aini
```

```bash
python -m uvicorn aini.main:app --host 127.0.0.1 --port 8000
```

Espera a ver `AIni lista: aini-0.1-sklearn`.

**Ventana 2 — el backend.**

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\api
```

```bash
npm run start:prod
```

**Ventana 3 — para los comandos de la demostración.**

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\api
```

### Dos cosas que revisar cinco minutos antes

El motor activo tiene que ser AIni. En `apps/api/.env`:

```
VERIFICACION_DRIVER=aini
AINI_URL=http://127.0.0.1:8000
```

Y comprobar que los dos respondan:

```bash
curl http://127.0.0.1:8000/salud
```

```bash
curl http://localhost:3000/api/v1/salud
```

El segundo debe decir `"motorVerificacion":"aini"`. Si dice `reglas-v0`, el `.env` no se guardó o el backend arrancó antes de cambiarlo.

### Si vas a mostrar también la interfaz

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\app\build\web
```

```bash
python -m http.server 5000
```

Queda en **http://localhost:5000**. Los códigos del segundo factor, en la ventana 3: `npm run demo:codigos`

---

## Minuto 0–2 · El problema, en una frase

> «Cuando usted dona a una ONG, no tiene forma de saber en qué se gastó su dinero. Y la ONG honesta no tiene forma barata de demostrarlo. Ayni retiene cada sol hasta que alguien demuestre el gasto con comprobante y evidencia.»

No entres todavía a la IA. El sistema tiene que entenderse sin ella, porque la IA es una pieza, no el proyecto.

---

## Minuto 2–5 · El momento fuerte: qué ve la IA que las reglas no

**Este es el comando que hay que correr delante de todos.** Ventana 3:

```bash
npm run demo:comparar
```

Pasa los mismos cinco gastos por los dos motores y muestra los veredictos lado a lado.

### Qué señalar, caso por caso

| # | Caso | reglas-v0 | AIni | Qué decir |
|---|---|---|---|---|
| 1 | Gasto normal | ALTO | ALTO | «Coinciden. Aquí la IA no hacía falta.» |
| 2 | RUC con dígito verificador malo | MEDIO | MEDIO | «También coinciden. Esto es aritmética: módulo 11. **Someterlo a un modelo sería peor**, menos exacto y menos explicable.» |
| **3** | **Alquiler de oficina en el fondo veterinario** | **ALTO** | **MEDIO** | **Deténte aquí.** |
| 4 | Perfil anómalo combinado | MEDIO | MEDIO | «Los dos lo marcan, pero miren el puntaje de anomalía: 40 contra 14.3.» |
| 5 | Evidencia reutilizada | BAJO | BAJO | «Bloqueo duro, lo detecta el hash perceptual. Tampoco es IA.» |

### El caso 3, que es el que justifica el módulo

> «Este comprobante tiene el RUC válido, el IGV exacto y las fechas correctas. **El motor de reglas lo aprueba automáticamente: ALTO, 100 sobre 100.** Lo único que está mal es que es un alquiler de oficina cargado al fondo de atención veterinaria. Es dinero que alguien donó para curar animales y se está yendo a pagar una renta.
>
> Ninguna regla aritmética puede ver eso. La IA sí: mide la similitud semántica entre el concepto y la categoría del fondo, da 0.40 donde lo normal es 0.76, y lo deriva a una persona.»

Y el remate honesto:

> «Noten que coinciden en cuatro de cinco. **La IA no reemplazó nada**: agregó la señal que faltaba.»

---

## Minuto 5–8 · El modelo de anomalías, y por qué un modelo

Enseña el caso 4 del comando anterior y explica la diferencia de puntaje:

> «Aquí hay cuatro señales a la vez: el monto está alto, el proveedor es nuevo, es el quinto gasto de la semana, y consume el 98 % del saldo. **Ninguna de las cuatro, por separado, basta para desconfiar.** Las cuatro juntas sí.
>
> Eso es lo que un Isolation Forest hace y una regla no: aísla puntos raros en el espacio completo de características, sin que nadie tenga que escribir la combinación.»

Si quieres el número que lo prueba, está medido y está en el código:

| Perfil | `score_samples` |
|---|---|
| Gastos normales (mediana) | −0.443 |
| Monto muy atípico, solo | −0.605 |
| Consume todo el saldo, solo | −0.607 |
| **Las cuatro juntas** | **−0.774** |

> «Ninguna señal suelta baja de −0.61. Las cuatro juntas llegan a −0.77. Esa brecha es todo el argumento.»

---

## Minuto 8–10 · La explicabilidad, que es donde está el criterio

Vuelve al caso 3 y señala la línea del resumen:

> «Isolation Forest devuelve un número y nada más. Un número sin motivo no sirve: la ONG no sabe qué corregir y el auditor no sabe qué revisar.
>
> Por eso **el modelo decide cuánto y las reglas de lectura explican por qué**. Ninguna respuesta de AIni sale sin motivos legibles en español, y hay una prueba que lo recorre regla por regla.»

Si tienes la interfaz abierta, aquí es el momento: entra como operador de ONG y abre un gasto observado. Los motivos aparecen en pantalla tal cual.

---

## Minuto 10–12 · Qué sabe el modelo y qué no

**Dilo tú antes de que lo pregunten.** Es lo que separa un proyecto serio de una demo.

> «El detector de anomalías se entrenó con 600 gastos sintéticos, porque la base real tiene cuatro. Con cuatro muestras un modelo no aprende: memoriza.
>
> Eso significa que **reconoce lo que esa distribución considera raro, no lo que esta organización considera raro.** Son cosas distintas. Está escrito en el README, en la ficha que viaja junto al modelo, y por eso AIni está registrada como `EN_PRUEBAS` y no como `ACTIVO`: declararla activa sin haberla evaluado sería afirmar algo que nadie midió.
>
> El camino para cerrarlo ya está: `entrenar --real` suma los gastos aprobados reales. Y como cada decisión de auditor se guarda con el nivel que el motor propuso, el sistema lleva meses generando el conjunto etiquetado con el que se podrá comparar.»

Cierra con la resiliencia, que además vuelve a demostrar lo del caso 3. Sin tocar la ventana de AIni, apunta la comparación a un puerto donde no hay nada:

```bash
npm run demo:comparar -- --url=http://127.0.0.1:9999
```

Cada caso aparece marcado `<- servicio caido, respondio el respaldo`, y pasa algo que vale la pena señalar:

> «Fíjense en el caso 3. Con AIni caída, **el alquiler de oficina vuelve a aprobarse automáticamente: ALTO, 100 sobre 100**. Eso es exactamente lo que la IA estaba aportando, visto al revés.
>
> Y lo importante: el gasto **no quedó sin verificar**. Lo resolvió el motor determinista, y queda anotado en la explicación para que un auditor sepa que ese caso no lo decidió el modelo. Una ONG esperando que se libere su dinero no puede quedar bloqueada porque un proceso de Python se cayó.»

Es un buen cierre: demuestra que pensaste en el fallo, no solo en el camino feliz. Y es más seguro que bajar el servicio en vivo, porque no tienes que volver a levantarlo si alguien pregunta algo después.

---

## Si preguntan

**«¿Por qué no usaron GPT o Gemini?»**
Porque el sistema trata datos de beneficiarios de programas sociales, categoría sensible bajo la Ley N.° 29733. Con un servicio propio las evidencias no salen de la infraestructura del proyecto. Además no hay clave que custodiar ni cuota que se agote a mitad de una demostración. El seam acepta las dos: conectar un proveedor comercial sería una segunda implementación de la misma interfaz.

**«¿Qué tan bueno es el modelo?»**
No lo sabemos todavía, y eso es parte de la respuesta honesta. No hay conjunto de validación etiquetado por humanos: hay 600 muestras sintéticas de entrenamiento y cuatro gastos reales. Lo que sí está medido y documentado es el comportamiento en los casos de prueba, y el mecanismo para evaluarlo cuando haya datos.

**«¿Lee el comprobante?»**
No. Los campos los captura el operador, y el análisis lo **declara**: guarda `fuente: "declarado"` en vez de afirmar `"ocr"`. El día que haya lectura automática se sabrá exactamente qué análisis la tuvieron y cuáles no.

**«¿Y si la ONG sube una foto de otro gasto?»**
Se detecta, y no por IA: hash SHA-256 más huella perceptual de 64 bits. Una foto reciclada se reconoce aunque la hayan recortado y recomprimido. Lo detectamos a distancia 1 de 64 bits con un archivo completamente distinto.

---

## Resumen de comandos

| Para qué | Comando |
|---|---|
| Levantar AIni | `python -m uvicorn aini.main:app --port 8000` |
| Levantar el backend | `npm run start:prod` |
| Levantar la interfaz | `python -m http.server 5000` (en `apps/app/build/web`) |
| **Comparar los dos motores** | `npm run demo:comparar` |
| Códigos del segundo factor | `npm run demo:codigos` |
| Reentrenar el modelo | `python -m entrenamiento.entrenar` |
| Reentrenar con datos reales | `python -m entrenamiento.entrenar --real` |
| Pruebas del backend | `npm test` |
| Pruebas del modelo | `python -m pytest pruebas/ -q` |

---

## Módulos y dónde está cada cosa

| Qué quieres mostrar | Dónde |
|---|---|
| Coherencia semántica (spaCy) | `apps/aini/aini/documental.py` |
| Detección de anomalías (scikit-learn) | `apps/aini/aini/anomalia.py` |
| Entrenamiento y su limitación declarada | `apps/aini/entrenamiento/entrenar.py` |
| El seam: cómo entra la IA sin tocar nada | `apps/api/src/modules/verificacion/puertos/motor-verificacion.port.ts` |
| El cliente y su respaldo | `apps/api/src/modules/verificacion/motores/aini.motor.ts` |
| Contrato de datos (§7.4) | `apps/api/src/modules/verificacion/contrato/analisis.contrato.ts` |
| Qué sabe el modelo y qué no | `apps/aini/README.md` y `apps/aini/modelos/anomalia.ficha.json` |

Si te piden ver código, el mejor archivo para abrir es **`anomalia.py`**: tiene el modelo, la traducción a motivos legibles y, en el encabezado, el argumento de por qué un modelo y no más reglas, con los números que lo respaldan.
