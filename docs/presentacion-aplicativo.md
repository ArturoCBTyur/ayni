# Ayni · cómo presentar el aplicativo en uso

Recorrido de 12 minutos por la interfaz, con los cinco roles. Es el complemento de [presentacion-mvp.md](presentacion-mvp.md): aquella enseña la IA desde la terminal, esta la enseña dentro de la aplicación.

**La idea que organiza todo:** cada pantalla responde una pregunta que una persona real se hace. No recorras menús; recorre preguntas.

---

## Antes de empezar

### Cuatro ventanas de PowerShell

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

**4 · Códigos del segundo factor** — tenla a la vista todo el tiempo.

```bash
cd C:\Users\User\Desktop\repositories\trazabilidad-radical\apps\api
```

```bash
npm run demo:codigos
```

La aplicación queda en **http://localhost:5000**

### Comprobar cinco minutos antes

```bash
curl http://localhost:3000/api/v1/salud
```

Debe decir `"motorVerificacion":"aini"`. Si dice `reglas-v0`, en `apps/api/.env` falta `VERIFICACION_DRIVER=aini` o el backend arrancó antes del cambio.

**Y entra una vez con cada rol antes de presentar.** No para ensayar: para que los códigos del segundo factor ya estén probados y no descubras un problema con público delante.

---

## Las cinco cuentas · clave común `Demo.2026!tr`

| Rol | Correo | Segundo factor |
|---|---|---|
| Donante | `donante@demo.pe` | no pide |
| Operador de campo | `ong.operador@demo.pe` | **sí** |
| Auditor | `auditor@demo.pe` | **sí** |
| Administradora de ONG | `ong.admin@demo.pe` | **sí** |
| Administrador | `admin@demo.pe` | **sí** |

> **El ingreso con segundo factor es en dos pasos y conviene saberlo.** Escribes correo y contraseña, el primer intento «falla» a propósito —el servidor responde que falta el código— y recién ahí aparece el campo de 6 dígitos. No es un error: el campo aparece solo cuando se pide. Pero si no lo esperas, delante del público parece que la contraseña está mal.

---

## Lo que hay preparado

Cinco gastos, cada uno para enseñar algo distinto:

| Monto | Estado | Nivel | Motor | Para qué sirve |
|---|---|---|---|---|
| S/ 118 | Aprobado | ALTO 97 | reglas | El camino feliz: resolvió solo y el donante ya tiene su narrativa |
| S/ 64 | Aprobado | ALTO 100 | reglas | Segundo caso automático |
| S/ 189 | **En revisión** | MEDIO 79 | reglas | **El auditor decide.** El RUC no pasa el dígito verificador |
| S/ 72 | **Observado** | BAJO 0 | reglas | **Evidencia reciclada**, detectada a distancia 1 de 64 bits |
| **S/ 145** | **En revisión** | **MEDIO 76** | **AIni** | **El caso que solo la IA ve** |

Fondo «Atención veterinaria»: recaudado S/ 335.96 · **retenido S/ 153.96** · ejecutado S/ 182.

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

## Minuto 4–7 · La ONG registra, y el motor explica

**Sal y entra con `ong.operador@demo.pe`** (pide código).

**Fondos** → se ve el saldo retenido disponible. Luego **Gastos**.

Aquí está el corazón de la demostración. Cada tarjeta muestra el estado, el nivel, el puntaje **y los motivos en español**.

### Primero el de S/ 72 — evidencia reciclada

> «La evidencia coincide con una imagen ya presentada en otro gasto, aunque se haya recortado o vuelto a guardar.»

> «El archivo es distinto: otro nombre, otro tamaño, otro SHA-256. Lo que coincide es la imagen. Se detecta con una huella perceptual de 64 bits, y acá la distancia es 1.»

### Después el de S/ 145 — **el que justifica la IA**

> «El concepto "alquiler de oficina administrativa y mobiliario de escritorio" no parece corresponder a un gasto de la categoría del fondo. Verifique que el gasto se esté cargando al fondo correcto.»

**Deténte aquí.**

> «Este comprobante es impecable: el RUC pasa el dígito verificador, el IGV es exacto, las fechas son coherentes. **El motor de reglas lo habría aprobado automáticamente.**
>
> Lo único que está mal es que es un alquiler de oficina cargado al fondo de atención veterinaria. Es dinero que alguien donó para curar animales, yéndose a pagar una renta.
>
> Ninguna regla aritmética puede ver eso. El modelo de lenguaje sí: mide la similitud semántica entre el concepto y la categoría del fondo, da 0.40 donde lo normal es 0.76, y en vez de aprobarlo lo manda a que lo mire una persona.»

> «Y noten quién está leyendo esto: **la ONG**, que es quien tiene que corregirlo. La explicación no es para el auditor, es para que alguien pueda actuar.»

---

## Minuto 7–9 · El auditor decide

**Entra con `auditor@demo.pe`** (pide código).

**Auditoría** → la bandeja, ordenable por antigüedad o por monto, con el plazo de 48 horas hábiles a la vista.

Abre el caso de **S/ 145** —el de AIni—. La pantalla muestra, lado a lado: lo declarado, el comprobante, la evidencia, y **todos los motivos del motor con su señal y su valor**.

Aprueba u observa con **comentario obligatorio**.

> «El motor no decide esto. Decide una persona, y su comentario queda guardado en `revisiones_auditoria` junto al nivel que el motor había propuesto.
>
> Eso significa que **cada decisión que toma un auditor es una etiqueta supervisada**. El sistema está generando, con el uso, el conjunto de datos con el que se podrá evaluar si el modelo acierta.»

Si apruebas: la aplicación FIFO consume las donaciones más antiguas del fondo, escribe el asiento de ejecución con su hash y actualiza los saldos, todo en una transacción serializable.

---

## Minuto 9–11 · El donante ve qué hizo posible su dinero

**Vuelve a `donante@demo.pe`** → **Impacto**.

La narrativa nombra **su monto exacto aplicado**, no el total del gasto: el concepto, el proveedor, la fecha, el comprobante y la foto anonimizada.

> «Si tres personas financiaron un gasto de S/ 118, cada una recibe el mensaje con lo que puso ella. No "ayudamos a 300 familias": sus S/ 50 pagaron esta factura.»

Señala el botón de **reportar una inconsistencia**.

> «Y si algo no le cuadra, puede objetar. Eso abre un caso real de auditoría y devuelve el gasto a revisión.»

---

## Minuto 11–12 · El administrador comprueba que todo cuadra

**Entra con `admin@demo.pe`** (pide código) → **Tablero**.

**Arriba:** «El libro contable cuadra», con las cadenas de hashes íntegras.

> «Esto no se calcula desde una sola fuente. Compara los pagos de la pasarela contra los asientos del libro, los saldos de cada fondo contra la suma de sus movimientos, y las aplicaciones contra los montos aprobados. Si recalculara desde un solo lado, cuadraría siempre y no probaría nada.»

**El gráfico del movimiento del dinero:** cuánto entró, cuánto sigue **retenido esperando evidencia**, cuánto se ejecutó.

**Abajo, los indicadores por disciplina.** Señala los que dicen **«Sin medir» con su motivo**.

> «Tres no se pueden medir todavía: dos necesitan instrumentos externos —una encuesta y una prueba de usabilidad con personas— y uno depende de una capacidad que esta versión no tiene.
>
> Un tablero que solo muestra lo que sabe medir sugiere que eso era todo lo que había que medir. Declarar lo que falta es parte de lo que el proyecto propone.»

---

## Si te sobra tiempo

**Mis datos y privacidad** — en el menú de la cuenta, con cualquier rol.

> «Los tres permisos aparecen aunque no estén otorgados: ocultar uno que no se dio es ocultar que existe. Y cada uno explica qué deja de pasar si se revoca, no solo que se revoca.»

Con `admin@demo.pe`, **Solicitudes**: la bandeja ARCO ordenada por plazo, no por fecha de llegada.

> «Lo que decide a cuál entrar primero es cuánto queda para incumplir. Una rectificación de ayer vence antes que un acceso de hace dos semanas, porque la Ley N.° 29733 les da plazos distintos: 10 días hábiles y 20.»

---

## Las preguntas que van a salir

**«¿Los pagos son reales?»**
No. La pasarela está simulada, con webhook firmado e idempotente. Culqi implementa la misma interfaz cuando haya cuenta de comercio.

**«¿Consultan a SUNAT?»**
No, y el sistema **lo dice** en vez de simularlo: el resultado declara que no pudo confirmar la existencia del comprobante. Se valida el RUC por módulo 11, la serie y la aritmética del IGV. La consulta real necesita credenciales SOL.

**«¿La IA lee el comprobante?»**
No. Los campos los captura el operador, y el análisis guarda `fuente: "declarado"` en vez de afirmar `"ocr"`. El día que haya lectura automática se sabrá qué análisis la tuvieron.

**«¿Por qué el difuminado de rostros es manual?»**
Porque el reconocimiento automático necesita visión por computadora y no está en esta versión. Pero la restricción que protege al beneficiario —no se puede notificar una evidencia sin anonimizar— **vive en la base de datos** y sigue activa igual. Cambia quién marca los rostros, no la garantía.

**«¿Qué pasa si se cae el servicio de IA?»**
El gasto no queda sin verificar: lo resuelve el motor determinista y queda anotado en la explicación. Se puede demostrar en vivo con `npm run demo:comparar -- --url=http://127.0.0.1:9999`.

---

## Si algo falla en vivo

| Síntoma | Qué hacer |
|---|---|
| «No se pudo contactar al servidor» | Se cayó el backend. Relanza `npm run start:prod` en la ventana 2 |
| El código del segundo factor no entra | Caducó. `npm run demo:codigos` otra vez; si quedan menos de 10 segundos, espera al siguiente |
| Pantalla en blanco | Ctrl+F5 |
| Un gasto sigue «en análisis» | El trabajador corre cada 5 segundos. Espera y recarga |
| Un gasto nuevo sale analizado por reglas | AIni no está corriendo o `.env` dice `reglas-v0` |

**No cierres las ventanas 1 y 2 durante la presentación.**

---

## Dos cosas que esta versión no muestra

Dichas acá para que no te sorprendan en vivo:

- **La bandeja del auditor solo lista los casos en revisión**, no los observados. Un gasto bloqueado —como el de S/ 72— lo ve la ONG en su lista, con su motivo, y se resuelve por el flujo de subsanación. No lo busques en la bandeja.
- **La aplicación no tiene pantalla de administración de umbrales.** Se pueden cambiar por la API, y el cambio queda en bitácora, pero no hay interfaz. Si te preguntan por CU18, es más honesto decir eso que improvisar.
