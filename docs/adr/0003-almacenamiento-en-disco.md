# ADR-0003 · StorageAdapter con implementación en disco local

- **Estado:** aceptado
- **Fecha:** 2026-09-15

## Contexto

La sección 6.1 establece que comprobantes y evidencias viven cifrados en Amazon S3 y que la base solo guarda la URL, el hash SHA-256 y el hash perceptual. El flujo de la sección 7.5 usa URLs prefirmadas para que el cliente suba directamente al almacenamiento.

Usar S3 desde el primer día obligaría a tener cuenta de AWS y credenciales antes de poder registrar un solo gasto.

## Decisión

Se define una interfaz `StorageAdapter` con dos implementaciones: `AlmacenamientoDisco` (desarrollo, por defecto) y `AlmacenamientoS3` (despliegue), seleccionadas por la variable `STORAGE_DRIVER`.

La implementación en disco emite URLs de subida y descarga con token HMAC y expiración, imitando el contrato de las URLs prefirmadas de S3.

## Motivos

- El código de dominio nunca conoce el proveedor: pide una URL de subida y recibe una, sin importar quién la firma.
- Que las URLs caduquen y estén firmadas desde el principio obliga a que el control de acceso a evidencias sea correcto en desarrollo, no algo que se arregla al desplegar.

## Consecuencias

- La carpeta `storage/` queda fuera del control de versiones.
- El cifrado en reposo en disco local se implementa a nivel de archivo; en S3 se delega en SSE-S3, que es lo que exige RNF-01.
- Cambiar a S3 en la Fase 11 es una variable de entorno más la migración de los archivos existentes.
