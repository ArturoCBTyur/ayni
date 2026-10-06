# Respaldo y recuperación — RNF-13

Un respaldo que nunca se restauró es una hipótesis. Por eso este procedimiento termina en una restauración que **demuestra** que lo restaurado es el mismo libro contable, no solo una base que arranca.

Dos scripts en [`apps/api/scripts/respaldo/`](../apps/api/scripts/respaldo):

| Script | Qué hace |
|---|---|
| `respaldar.sh` | `pg_dump` de la base, copia de los archivos, las **cabezas de la cadena** de cada fondo y un `SHA256SUMS` de todo |
| `restaurar.sh` | Comprueba el respaldo, lo restaura en una base **vacía** y verifica seis cosas; sale con error si una falla |

## Qué se verifica al restaurar

`pg_restore` termina bien con el volcado de cualquier base. Lo que distingue a este respaldo es lo que se comprueba después:

1. **El respaldo no cambió desde que se hizo.** `SHA256SUMS`, antes de tocar nada.
2. **La misma versión del esquema.** La última migración aplicada coincide.
3. **El libro sigue siendo de solo inserción.** Los tres triggers de `movimientos_contables` existen y están activos. Un respaldo que vuelve sin ellos devuelve los datos sin la garantía que el proyecto promete.
4. **Cada cadena de hashes está íntegra.** `fn_verificar_cadena` la recalcula, fondo por fondo, dentro de la base restaurada.
5. **Es el mismo libro.** Cada cabeza registrada al respaldar —último movimiento de cada fondo, con su secuencia y su hash— existe en lo restaurado. Una cadena íntegra pero distinta pasa el punto 4 y no este.
6. **Volvieron todos los archivos**, y cuántos necesitan la clave de cifrado para leerse.

## La clave de cifrado no va en el respaldo

Las evidencias están cifradas en disco (RNF-01) y viajan así. La `CIFRADO_CLAVE` **no** se incluye, a propósito: un respaldo con la clave al lado no está cifrado, y un respaldo es justamente lo que se copia, se sube a otro lugar y se pierde.

La consecuencia hay que tenerla clara: **sin la clave, restaurar devuelve la base completa y las evidencias ilegibles.** La clave se custodia aparte, en el gestor de contraseñas del equipo además del gestor de secretos del proveedor. El manifiesto de cada respaldo dice cuántos archivos están cifrados, para saber de antemano si restaurarlos la exige.

## Con Docker

El servicio `respaldo` usa la imagen de PostgreSQL 18 porque `pg_dump` tiene que ser de la misma versión mayor que el servidor o más nueva. No arranca con `up`: se invoca.

Respaldar:

```bash
docker compose --profile respaldo run --rm respaldo
```

Queda en `./respaldos/respaldo-<fecha>/`. Con `RETENER=7` además borra los más antiguos y deja los últimos siete.

Restaurar en una base de simulacro, nunca en la de trabajo:

```bash
docker compose exec base createdb -U tr_app trazabilidad_simulacro
```

```bash
docker compose --profile respaldo run --rm -e ARCHIVOS_DIR_DESTINO=/respaldos/simulacro-archivos respaldo /scripts/restaurar.sh /respaldos/respaldo-<fecha>
```

`restaurar.sh` se niega a escribir sobre una base con tablas o una carpeta con archivos. `--sobrescribir` lo permite y borra lo que haya: es la opción para la recuperación real, y por eso no es la opción por defecto.

## Sin Docker

Con un `pg_dump` 18 instalado:

```bash
DATABASE_URL=postgresql://... ARCHIVOS_DIR=./storage bash apps/api/scripts/respaldo/respaldar.sh ./respaldos
```

```bash
DATABASE_URL_DESTINO=postgresql://.../simulacro ARCHIVOS_DIR_DESTINO=./simulacro bash apps/api/scripts/respaldo/restaurar.sh ./respaldos/respaldo-<fecha>
```

## En el despliegue

Neon guarda su propio historial y permite restaurar a un punto en el tiempo; eso cubre la base frente a un borrado accidental. No cubre lo que este procedimiento sí: los archivos, una copia fuera del proveedor, y la verificación de que lo recuperado es el mismo libro. Lo razonable es las dos cosas: el historial de Neon para el día a día y `respaldar.sh` programado (un cron del anfitrión o un job programado de Render) hacia un almacenamiento distinto.

## Rotar la clave de cifrado

1. Generar la nueva: `openssl rand -base64 32`.
2. Poner la nueva en `CIFRADO_CLAVE` y la anterior en `CIFRADO_CLAVES_ANTERIORES`, y reiniciar la API. Desde ese momento lo nuevo se cifra con la nueva y lo anterior se sigue leyendo.
3. Volver a sellar todo con la nueva: `npm run cifrado:migrar` (con Docker, `docker compose run --rm migraciones npx tsx scripts/cifrar-existentes.ts`). Con `-- --revisar` solo cuenta.
4. Cuando `--revisar` diga `0 por sellar`, retirar la anterior de `CIFRADO_CLAVES_ANTERIORES`.

Los respaldos hechos antes de la rotación siguen necesitando la clave anterior: no se destruye mientras exista uno de ellos.

El mismo comando sirve para activar el cifrado en una instalación que ya tenía evidencias en claro: la API las lee igual mientras tanto, pero hasta correrlo siguen en claro en el disco.
