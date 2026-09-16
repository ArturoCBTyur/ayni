# ADR-0004 · Notificaciones in-app y por correo; push diferido

- **Estado:** aceptado
- **Fecha:** 2026-09-15

## Contexto

RF-12 pide notificaciones push, por correo y dentro de la app. La Tabla 15 asigna Firebase Cloud Messaging al Motor de Retorno. El indicador de la Tabla 3 mide el tiempo entre carga de evidencia y notificación al donante (10 minutos o menos en nivel ALTO), que cualquiera de los tres canales satisface.

FCM requiere crear un proyecto Firebase, registrar la aplicación web y gestionar tokens de dispositivo y permisos del navegador.

## Decisión

El MVP implementa **in-app** (tabla `notificaciones`, consultada por la app) y **correo** (nodemailer: Ethereal en desarrollo, Resend o SES en despliegue). Push por FCM queda para una fase posterior.

## Motivos

- El guion de demostración de la sección 8.1 se recorre completo con in-app y correo: el donante ve la narrativa de impacto con su evidencia anonimizada.
- La tabla `notificaciones` ya tiene la columna `canal`, así que agregar PUSH es una fila más, no un cambio de modelo.
- Las dos reglas de integridad que importan aquí (evidencia anonimizada y consentimiento vigente) se aplican en la base y son independientes del canal.

## Consecuencias

- La Fase 10 debe medir el indicador de tiempo evidencia a notificación sobre correo, no sobre push.
- El informe debe declarar push como diferido y no como implementado.
