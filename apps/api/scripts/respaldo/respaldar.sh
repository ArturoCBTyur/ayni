#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# RNF-13 · Respaldo de la base y de los archivos, con manifiesto verificable.
#
#   DATABASE_URL=... ARCHIVOS_DIR=/ruta/storage bash respaldar.sh [destino]
#
# Con Docker, que trae el pg_dump de la misma version que el servidor:
#
#   docker compose --profile respaldo run --rm respaldo
#
# Deja en <destino>/respaldo-<fecha>/:
#
#   base.dump        pg_dump en formato custom (pg_restore lo lee)
#   archivos.tar.gz  el contenido de STORAGE_DIR, tal como esta en disco
#   cabezas.json     ultimo movimiento de cada fondo: secuencia y hash
#   manifiesto.txt   que se respaldo, de donde, y con que version del esquema
#   SHA256SUMS       huella de cada uno de los anteriores
#
# Las cabezas de la cadena son lo que distingue este respaldo de un pg_dump a
# secas: al restaurar se comprueba que cada una exista en lo restaurado, con
# el mismo hash. Un respaldo que restaura una base valida pero con otro libro
# contable no es un respaldo, es otra base.
#
# Los archivos ya estan cifrados en disco (RNF-01) y viajan asi. La clave de
# cifrado NO va en el respaldo, a proposito: guardarla junto a lo que protege
# anularia el cifrado. Sin ella, restaurar devuelve las fotos ilegibles; hay
# que custodiarla aparte (ver docs/respaldo.md).
# ---------------------------------------------------------------------------
set -euo pipefail

: "${DATABASE_URL:?Defina DATABASE_URL con la base a respaldar.}"
ARCHIVOS_DIR="${ARCHIVOS_DIR:-}"
DESTINO="${1:-./respaldos}"

# libpq no entiende el ?schema=public que Prisma agrega a la URL.
URL="${DATABASE_URL%%\?*}"

sello="$(date -u +%Y%m%dT%H%M%SZ)"
dir="$DESTINO/respaldo-$sello"

say() { printf '  %s\n' "$*"; }
falla() { printf '\n  ERROR: %s\n\n' "$*" >&2; exit 1; }

# pg_dump no puede respaldar un servidor de una version mayor que la suya, y el
# error que da es facil de malinterpretar. Se comprueba antes.
version_servidor="$(psql "$URL" -XAtc 'SHOW server_version_num')"
mayor_servidor=$((version_servidor / 10000))
mayor_cliente="$(pg_dump --version | sed -E 's/[^0-9]*([0-9]+).*/\1/')"
if [ "$mayor_cliente" -lt "$mayor_servidor" ]; then
  falla "pg_dump $mayor_cliente no puede respaldar PostgreSQL $mayor_servidor. Use el servicio 'respaldo' de docker compose."
fi

mkdir -p "$dir"
echo
echo "Respaldo $sello"

# Las cabezas se toman ANTES del volcado. Si entra un movimiento entre las dos
# cosas, el volcado tiene uno mas y la verificacion lo acepta: lo que exige es
# que la cadena restaurada contenga cada cabeza, no que termine en ella.
psql "$URL" -XAtq > "$dir/cabezas.json" <<'SQL'
SELECT COALESCE(json_agg(json_build_object(
         'fondo', fondo_id, 'secuencia', secuencia, 'hash', hash_actual)
         ORDER BY fondo_id), '[]'::json)
  FROM (SELECT DISTINCT ON (fondo_id) fondo_id, secuencia, hash_actual
          FROM movimientos_contables
         ORDER BY fondo_id, secuencia DESC) cabezas;
SQL
fondos="$(psql "$URL" -XAtc 'SELECT count(DISTINCT fondo_id) FROM movimientos_contables')"
movimientos="$(psql "$URL" -XAtc 'SELECT count(*) FROM movimientos_contables')"
migracion="$(psql "$URL" -XAtc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1")"
say "libro: $movimientos movimientos en $fondos fondos"

pg_dump "$URL" --format=custom --no-owner --no-privileges --file="$dir/base.dump"
say "base: $(du -h "$dir/base.dump" | cut -f1)"

archivos=0
sellados=0
if [ -n "$ARCHIVOS_DIR" ]; then
  [ -d "$ARCHIVOS_DIR" ] || falla "ARCHIVOS_DIR=$ARCHIVOS_DIR no es una carpeta."
  tar -C "$ARCHIVOS_DIR" -czf "$dir/archivos.tar.gz" .
  # Cuantos estan cifrados: dice de antemano si restaurarlos exige la clave.
  while IFS= read -r -d '' f; do
    archivos=$((archivos + 1))
    if [ "$(head -c 4 "$f")" = "AYNI" ]; then sellados=$((sellados + 1)); fi
  done < <(find "$ARCHIVOS_DIR" -type f -print0)
  say "archivos: $archivos ($sellados cifrados) · $(du -h "$dir/archivos.tar.gz" | cut -f1)"
else
  say "archivos: no se respaldan (ARCHIVOS_DIR vacio)"
fi

{
  echo "formato=1"
  echo "creado=$sello"
  echo "postgresql=$mayor_servidor"
  echo "migracion=$migracion"
  echo "movimientos=$movimientos"
  echo "fondos=$fondos"
  echo "archivos=$archivos"
  echo "archivos_cifrados=$sellados"
} > "$dir/manifiesto.txt"

(cd "$dir" && sha256sum -- * > SHA256SUMS)

# Con Docker esto corre como root sobre una carpeta del anfitrion, y el
# respaldo quedaria de root: el operador no podria ni borrarlo sin sudo. Se le
# entrega a quien es dueño de este script, que es quien clono el repositorio.
if [ "$(id -u)" = "0" ]; then
  dueno="$(stat -c '%u:%g' "$0")"
  chown -R "$dueno" "$dir"
  if [ "$(stat -c '%u' "$DESTINO")" = "0" ]; then chown "$dueno" "$DESTINO"; fi
fi

# Retencion opcional. Solo borra si se pide, y solo carpetas de este script.
if [ -n "${RETENER:-}" ]; then
  find "$DESTINO" -maxdepth 1 -type d -name 'respaldo-*' | sort -r | tail -n +"$((RETENER + 1))" |
    while IFS= read -r viejo; do
      rm -rf -- "$viejo"
      say "retencion: eliminado $(basename "$viejo")"
    done
fi

echo
echo "  Listo: $dir"
echo "  Un respaldo que nunca se restauro no esta probado. Verifiquelo con restaurar.sh."
echo
