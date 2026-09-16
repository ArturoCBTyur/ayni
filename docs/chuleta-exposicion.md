# Chuleta de exposición — versión local

Ten esto abierto en otra ventana. Una página, nada más.

---

## Arrancar (si algo se cayó)

Tres terminales. **La API primero**, que el worker de verificación vive ahí.

```bash
cd apps/api && npm run start:prod
```

```bash
cd apps/app/build/web && python -m http.server 5000
```

```bash
cd apps/api && npm run demo:codigos
```

La aplicación queda en **http://localhost:5000**

Si la base quedara vacía: `npx tsx prisma/seed-demo.ts` y después `npm run demo:preparar`.

---

## Cuentas · clave común `Demo.2026!tr`

| Rol | Correo | Segundo factor |
|---|---|---|
| Donante | `donante@demo.pe` | no pide |
| Operador de campo | `ong.operador@demo.pe` | **sí** |
| Auditor | `auditor@demo.pe` | **sí** |
| Administradora de ONG | `ong.admin@demo.pe` | **sí** |
| Administrador | `admin@demo.pe` | **sí** |

**Los códigos del segundo factor ya están enrolados.** Para verlos:

```bash
cd apps/api && npm run demo:codigos
```

Cambian cada 30 segundos. El comando dice cuántos quedan; si estás por debajo de 10, vuelve a correrlo antes de teclear.

---

## Qué hay preparado

Cuatro gastos, uno por cada cosa que quieres enseñar:

| Monto | Estado | Nivel | Qué demuestra |
|---|---|---|---|
| S/ 118 | Aprobado | **ALTO** 97 | El camino feliz: el motor resolvió solo y el donante ya recibió su narrativa |
| S/ 189 | **En revisión** | MEDIO 79 | **El auditor decide.** El motor no se atrevió: el dígito verificador del RUC no cuadra |
| S/ 64 | Aprobado | ALTO 100 | Segundo caso automático |
| S/ 72 | **Observado** | **BAJO** 0 | **Lo mejor que tienes.** Evidencia reciclada, detectada a distancia 1 de 64 bits con un SHA-256 distinto |

Fondo «Atención veterinaria»: recaudado S/ 335.96 · **retenido S/ 217.96** · ejecutado S/ 118.

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

**3 · Auditor** (`auditor@demo.pe` + código)
Auditoría → el caso de **S/ 189** → comprobante, evidencia y señales lado a lado → aprueba con comentario.

> «El motor no decide esto. Decide una persona, y su comentario queda guardado: **es la etiqueta con la que se entrenará AIni.**»

**4 · Donante otra vez** → Impacto
La narrativa nombra **su monto exacto aplicado**, no el total del gasto.

**5 · Administrador** (`admin@demo.pe` + código) → Tablero
Arriba: **«El libro contable cuadra»**. Abajo: los indicadores, y los que dicen **«Sin medir» con su motivo**.

> «Un tablero que solo muestra lo que sabe medir sugiere que eso era todo lo que había que medir.»

---

## Si te sobra tiempo

El CSV del libro incluye `hash_previo` y `hash_actual` de cada movimiento: **un tercero puede recalcular la cadena por su cuenta, sin confiar en que el sistema diga la verdad sobre sí mismo.**

Y las cuatro cosas que la base de datos no deja hacer, ni siquiera con un bug del backend: editar el libro, repetir un comprobante, aprobar más de lo retenido, notificar una evidencia sin anonimizar.

---

## Las tres preguntas que te van a hacer

**«¿Esto usa IA?»**
No, y es a propósito. El puntaje sale de reglas deterministas: dígito verificador del RUC, aritmética del IGV, huella perceptual, desviación del monto. **El contrato de datos es exactamente el que consumirá AIni** — cambiar una variable de entorno conmuta el motor sin tocar la base, la contabilidad ni la aplicación. Y cada decisión del auditor ya se está guardando: esta versión sin IA está generando el conjunto etiquetado que AIni necesitará.

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

**No cierres la terminal de la API durante la exposición.**
