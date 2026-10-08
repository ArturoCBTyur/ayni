# Ayni · guion de demostración — 10 minutos

> Este es el guion de 10 minutos del Entregable 2. Para demostrar en vivo con el
> lector de comprobantes, usa [presentacion-aplicativo.md](presentacion-aplicativo.md).

Recorrido completo del ciclo de confianza, con las cinco cuentas de la Tabla 20. Sigue la sección 8.1 del Entregable 2.

> **Para una exposición en local**, use [chuleta-exposicion.md](chuleta-exposicion.md): trae los comandos de PowerShell, el segundo factor ya enrolado y cuatro gastos sembrados —uno aprobado, uno esperando al auditor y uno observado por evidencia reciclada—. Este documento describe el recorrido sobre el despliegue.

**Antes de empezar:**

```bash
cd apps/api
```

```bash
npx tsx prisma/seed-demo.ts
```

Deja tres donaciones confirmadas y retenidas, y un gasto de S/ 118.00 esperando al motor. Arranca la API y el trabajador lo resuelve en segundos. Después, `npm run demo:preparar` enrola el segundo factor y añade los casos que el auditor necesita ver.

Si la demostración es sobre Render con plan gratuito, **abre la URL cinco minutos antes**: el servicio se suspende por inactividad y el primer acceso tarda hasta un minuto en despertar.

---

## Cuentas (Tabla 20)

Clave común: `Demo.2026!tr`

| Rol | Correo | Segundo factor |
|---|---|---|
| Donante | `donante@demo.pe` | No |
| Administradora de ONG | `ong.admin@demo.pe` | **Sí** |
| Operador de campo | `ong.operador@demo.pe` | **Sí** |
| Auditor | `auditor@demo.pe` | **Sí** |
| Administrador de plataforma | `admin@demo.pe` | **Sí** |

**Los cuatro roles con segundo factor lo configuran la primera vez que entran.** La aplicación muestra el código QR y la clave escrita; hay que escanearla con Google Authenticator o Authy antes de poder seguir. Conviene **enrolar las cuatro cuentas antes de la demostración**, no durante: son dos minutos que no se quieren gastar delante de nadie.

En local, `npm run demo:preparar` lo hace de una vez y `npm run demo:codigos` imprime los códigos del momento, sin necesidad de aplicación de autenticación.

---

## Minuto 0–2 · El donante encuentra una causa verificada

Entra con `donante@demo.pe`. Cada cuenta entra a su **Inicio**: el del donante resume lo aportado, lo ya gastado con respaldo y lo que sigue esperando evidencia.

1. **Causas.** Dos campañas de «Huellas del Ande», ambas con sello de organización verificada y su puntaje de confianza a la vista.
2. Abre **«Esterilización comunitaria»**. Muestra el desglose del puntaje: no es una estrella inventada, son tres componentes con su detalle. Bajo cada fondo, **«En qué se usó»** lista los gastos ya aprobados con su foto: lo ejecutado se ve antes de donar, no solo después.
3. **Lo que conviene decir aquí:** el donante no elige una ONG, elige un **fondo** con una categoría de gasto concreta. Ese es el primer acto de trazabilidad, antes de que entre un sol.

## Minuto 2–4 · Dona, y el dinero queda retenido

4. Dona **S/ 50** al fondo «Atención veterinaria». Tres pasos, con la opción de aporte anónimo.
5. La confirmación dice **«Retenido: esperando evidencia»**, no «gracias por tu donación».
6. Ve a **Mis aportes**: la línea de tiempo muestra Donado → **Retenido** → En verificación → Ejecutado.

> **El punto central del proyecto.** El dinero entró pero la ONG todavía no puede usarlo. Se liberará cuando alguien demuestre en qué se gastó. Tres asientos contables quedaron escritos —ingreso, comisión y retención—, encadenados por hash, y el libro no admite que se editen ni se borren.

## Minuto 4–6 · La ONG registra un gasto

7. Sal y entra con `ong.operador@demo.pe` (pide el código del segundo factor).
8. **Fondos**: se ve el saldo retenido disponible.
9. **Gastos**: el gasto sembrado de **S/ 118.00**, «atención veterinaria de urgencia de tres perros rescatados», boleta B001-004521 de Clínica Veterinaria San Roque, ya analizado por el motor.
10. Abre el detalle: **puntaje, nivel y los motivos en español**, el comprobante y las fotos tal como las verá el donante. Cada motivo dice qué regla se evaluó, cómo salió y con qué valor. Si una foto tiene personas, desde aquí se marcan los rostros para difuminarlos: hasta entonces el donante no la ve.

> **Si alguien pregunta por la IA:** hay dos motores detrás de la misma interfaz y se conmutan con una variable de entorno. Este gasto lo resolvió el determinista —dígito verificador del RUC, aritmética del IGV, huella perceptual contra todo el histórico, desviación del monto—. Los gastos de **S/ 145** y **S/ 185** los resolvió **AIni**, que corre en `apps/aini`: lee el comprobante con OCR, mide la coherencia del concepto con spaCy y perfila el gasto con Isolation Forest. Cada análisis guarda cuál de los dos decidió y con qué regla de umbrales, así que dos años después se sabe con qué criterio se aprobó.
>
> La demostración del lector en vivo está en [presentacion-aplicativo.md](presentacion-aplicativo.md). Y cada decisión del auditor queda guardada: **es la etiqueta con la que se reentrena el modelo.**

## Minuto 6–8 · El auditor decide

11. Entra con `auditor@demo.pe`.
12. **Auditoría**: la bandeja ordenada por antigüedad o por monto, con el plazo de 48 horas hábiles a la vista.
13. Abre el caso: comprobante, evidencia, datos declarados y señales del motor, lado a lado.
14. Aprueba con **comentario obligatorio**.

> Al aprobar, la aplicación FIFO consume las donaciones más antiguas del fondo, escribe el movimiento de ejecución con su hash y actualiza los saldos, todo en una transacción serializable. El comentario del auditor queda como etiqueta.

## Minuto 8–9 · El donante ve qué hizo posible su dinero

15. Vuelve a `donante@demo.pe` → **Impacto**.
16. La narrativa nombra **su monto exacto aplicado**, no el total del gasto: el concepto, el proveedor, la fecha, el comprobante y la foto anonimizada.
    Si el gasto lo resolvió **AIni**, trae un párrafo más que cuenta *cómo* se verificó: qué leyó del papel y qué comprobaciones pasaron. Lo redacta AIni por reglas, sin modelo generativo, y la API lo revisa antes de usarlo: lenguaje prohibido, marcado y **toda cifra tiene que estar en los datos del gasto**. Si no pasa, el donante recibe la plantilla sola y la bitácora anota por qué. La notificación queda firmada `impacto.…@1.0+aini`.
17. Muestra el botón de **reportar una inconsistencia**: abre un caso real de auditoría y devuelve el gasto a revisión.

> **Lo que se está enseñando:** el donante no recibe un agradecimiento genérico. Recibe la cuenta de sus soles, con el respaldo documental, y tiene cómo objetar.

## Minuto 9–10 · El administrador comprueba que todo cuadra

18. Entra con `admin@demo.pe` → **Tablero**.
19. Arriba: **«El libro contable cuadra»**, con las cadenas de hashes íntegras.
20. El movimiento del dinero: cuánto entró, cuánto sigue retenido esperando evidencia y cuánto se ejecutó.
21. Abajo, los indicadores de la Tabla 3 por disciplina. **Señala los que dicen «Sin medir» con su motivo**: tres necesitan una encuesta, una prueba de usabilidad con personas o una capacidad que esta versión no tiene.

> **Vale la pena detenerse aquí.** Un tablero que solo muestra lo que sabe medir sugiere que eso era todo lo que había que medir. Declarar lo que falta, y por qué, es parte de la honestidad que el proyecto propone.

---

## Si sobra tiempo: lo que cada rol puede hacer ahora

Cada uno se muestra en menos de un minuto:

- **Administradora de ONG** → **Campañas**: crea una campaña en borrador; la app explica que para publicarla necesita un fondo activo y, si la ONG no estuviera verificada, que no puede publicarla. Desde el menú de cuenta, **Equipo de la organización**: agrega a una persona por correo como operadora.
- **Donante** → al donar, **«Cada mes»**: la confirmación dice la fecha exacta del primer cobro. En **Mis aportes**, cada aporte se abre y muestra en qué gasto se usó, con su foto; la donación mensual se pausa o cancela en un toque.
- **Auditor** → **Auditoría**, pestaña **Organizaciones**: el expediente completo de una ONG que pidió verificación, y la decisión con motivo. En la revisión de un gasto, el ícono de informe abre el **informe de auditoría de la ONG**, con la integridad del libro de cada fondo y su extracto en CSV.
- **Operador u otro rol que no dona** → el botón «Donar» no aparece: la ficha de la causa se ve en modo consulta y lo dice.

## Si sobra tiempo: intentar romperlo

Lo más convincente de la demostración no es lo que funciona, sino lo que se defiende. Los cuatro fallan:

| Intento | Qué pasa |
|---|---|
| `UPDATE` sobre `movimientos_contables` | La base lo rechaza: el libro es de solo inserción |
| Registrar dos veces el mismo comprobante | Restricción única sobre RUC, tipo, serie y número |
| Aprobar un gasto mayor al saldo retenido | «No se puede gastar lo que aún no se ha recaudado» |
| Notificar una evidencia sin anonimizar | Un trigger lo impide, no una validación de la aplicación |

Y la prueba que más impresiona a un auditor. Desde la aplicación, en el informe de la ONG o en el tablero; o desde la terminal:

```bash
curl https://<tu-api>/api/v1/analitica/exportar/libro/<fondo-id> -H "Authorization: Bearer <token>"
```

El CSV incluye `hash_previo` y `hash_actual` de cada movimiento: **un tercero puede recalcular la cadena por su cuenta, sin confiar en que el sistema diga la verdad sobre sí mismo.** Esa es la diferencia entre un reporte y una prueba.

---

## Preguntas que suelen aparecer

**¿Los pagos son reales?** No. `FakeGateway` simula la pasarela con webhook firmado e idempotente. Culqi implementa la misma interfaz cuando haya cuenta de comercio.

**¿Consultan de verdad a SUNAT?** No, y el sistema **lo declara** en vez de simularlo: `existeEnSunat: null`. Se valida el RUC por módulo 11, el formato de la serie y la aritmética del IGV. La consulta real necesita credenciales SOL.

**¿Y si la ONG sube una foto de otro gasto?** Se detecta. Cada evidencia guarda su SHA-256 y una huella perceptual de 64 bits; una foto reciclada se reconoce aunque la hayan recortado y recomprimido.

**¿Por qué el difuminado es manual?** Porque el reconocimiento automático de rostros es parte de AIni y esta versión no la incluye. La restricción que protege al beneficiario —no se puede notificar una evidencia sin anonimizar— **está en la base de datos y sigue activa igual**. Cambia quién marca los rostros, no la garantía.

**¿Cuánto falta para la IA?** El seam está construido y probado. Entra creando el servicio de análisis, implementando la misma interfaz y cambiando una variable de entorno. Ni la base de datos, ni el núcleo contable, ni el frontend cambian.
