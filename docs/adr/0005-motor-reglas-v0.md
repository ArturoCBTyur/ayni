# ADR-0005 · Motor de Reglas v0 en el lugar de AIni

- **Estado:** aceptado
- **Fecha:** 2026-09-15

## Contexto

Esta primera versión se construye deliberadamente **sin ningún componente de inteligencia artificial**; AIni básica se incorpora en una sesión posterior.

Pero el ciclo de confianza no se puede demostrar sin la etapa de verificación: un gasto tiene que poder pasar de `EN_ANALISIS` a `APROBADO`, y la regla de umbrales ALTO/MEDIO/BAJO (RF-IA-07) es la que decide si hay aprobación automática, revisión humana o bloqueo.

Se consideró mandar todos los gastos a revisión humana. Eso habría dejado fuera la rama automática, el panel comparativo y buena parte del guion de demostración.

## Decisión

Toda la verificación pasa por una única interfaz `MotorVerificacion`, con el contrato de datos literal de la sección 7.4 del Entregable 2. En esta versión la implementa `MotorReglasV0`, determinista y sin IA. En la sesión de IA se agrega `MotorAIni` contra la misma interfaz, conmutable por la variable `VERIFICACION_DRIVER`.

## Cómo se produce el puntaje sin IA

`score_final = 0.45 documental + 0.25 visual + 0.30 anomalia`, con pesos y umbrales configurables en `reglas_confianza`.

- **Documental:** RUC válido por dígito verificador módulo 11, formato de serie y número, fecha no futura, subtotal más IGV igual al total, monto no mayor al saldo retenido.
- **Visual:** novedad del dHash perceptual (distancia de Hamming contra todo el histórico), frescura de la fecha EXIF, resolución y nitidez por varianza del laplaciano. Convolución clásica, sin modelos.
- **Anomalía:** monto fuera de dos desviaciones estándar de la media histórica de la categoría, proveedor nunca visto, fraccionamiento, desfase de fechas.
- **Bloqueos duros a BAJO:** hash SHA-256 repetido, comprobante repetido, saldo insuficiente, dHash a distancia menor que 5 de una evidencia previa.

## Consecuencias

- Las capacidades que exigen IA se sustituyen explícitamente: el difuminado de rostros pasa a ser manual y la extracción OCR pasa a captura manual con validación de formato. Ambas quedan declaradas como diferidas.
- RF-IA-05, 07, 08, 09, 11 y 12 quedan **implementados de verdad**, porque ninguno requiere aprendizaje automático. La narrativa por plantillas es lo que el propio entregable especifica (Jinja2), no un modelo generativo.
- Cada análisis se guarda con `version_modelo = reglas-v0` y cada decisión de auditor en `revisiones_auditoria`. **Esta versión genera el dataset etiquetado que AIni necesitará**, que es justamente la condición de avance que la Tabla 18 exige para pasar de la Fase 1 a la Fase 2 de la hoja de ruta.
- Sustituir el motor no toca la base de datos, el core contable ni el frontend.
