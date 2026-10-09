# Protocolo de la sesión de usabilidad (PSI-1, RNF-14)

T4.3 del [plan transdisciplinario](plan-transdisciplinario.md). El cuestionario SUS ya está dentro de la aplicación y PSI-1 se calcula solo; lo que este documento ordena es la **sesión con usuarios reales** que el plan exige además, y su acta.

**Estado:** sin realizar. Ni el protocolo ni el instrumento están firmados por Psicología (D3 del [ADR-0007](adr/0007-decisiones-transdisciplinarias.md)).

## Por qué una sesión y no solo el cuestionario

El SUS dice *cuánto* le costó a la persona; no dice *dónde*. Una sesión observada encuentra el paso en que alguien se detiene, que un puntaje de 62 nunca va a señalar. Las dos cosas se reportan juntas.

## Participantes

- **Cinco por rol como mínimo**, que es el umbral de publicación de D6 y el número habitual para encontrar la mayoría de los problemas de una interfaz: donantes, operadores de campo y administradores de ONG. Los auditores, si hay tiempo.
- Personas que **no participaron en el desarrollo** y no conocen el guion de la demo.
- Consentimiento informado firmado antes de empezar, con la finalidad INVESTIGACION otorgada en su cuenta de prueba.

## Tareas

Cada participante hace las de su rol, sin ayuda, en la versión desplegada:

| Rol | Tarea | Se considera lograda cuando |
|---|---|---|
| Donante | Encontrar una causa de esterilización y donar S/ 20 | Ve la confirmación con el monto retenido |
| Donante | Averiguar en qué se usó un aporte anterior | Abre el detalle y ve el gasto con su foto |
| Operador | Registrar un gasto con comprobante y foto | El gasto queda en análisis |
| Operador | Responder una observación del auditor | La alerta pasa a subsanación |
| Administrador de ONG | Crear un fondo y publicar la campaña | La campaña aparece en el buscador |
| Administrador de ONG | Descargar el estado mensual de un fondo en PDF | El archivo se abre |

Al terminar sus tareas, la persona responde el SUS **desde la aplicación**, que es como se mide en producción.

## Qué se registra

Por participante y por tarea: si la logró, el tiempo, las veces que pidió ayuda o retrocedió, y lo que dijo en voz alta (protocolo de pensamiento en voz alta). Sin grabar la cara ni la voz; solo la pantalla, si la persona lo autoriza.

## Acta

Una por sesión, con este formato:

```
Fecha y lugar:
Moderador y observador:
Versión de la aplicación (commit):
Participantes: n por rol (sin nombres; código P01, P02...)

Por tarea:  lograda / no lograda · tiempo · ayudas · comentario textual relevante

Puntaje SUS: media por rol y n (del tablero, no calculado a mano)
Problemas encontrados, por gravedad:
  1. (bloquea la tarea)
  2. (la demora)
  3. (cosmético)
Decisiones tomadas:
Firma de Psicología:
```

El acta se guarda en `docs/actas/` y su conclusión pasa a la matriz de trazabilidad, en RF-PS-06 y RNF-14.
