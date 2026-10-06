#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# RNF-13 · Restaura un respaldo de respaldar.sh y demuestra que es el mismo.
#
#   DATABASE_URL_DESTINO=... [ARCHIVOS_DIR_DESTINO=...] \
#     bash restaurar.sh <carpeta-del-respaldo> [--sobrescribir]
#
# Con Docker, sobre una base vacia creada para el simulacro:
#
#   docker compose --profile respaldo run --rm respaldo \
#     /scripts/restaurar.sh /respaldos/respaldo-<fecha>
#
# Por defecto se niega a escribir sobre una base o una carpeta con contenido:
# restaurar encima de produccion por un error de tipeo no tiene vuelta atras.
# --sobrescribir lo permite, y entonces borra lo que haya.
#
# Restaurar sin error no prueba nada: pg_restore termina bien con un volcado
# de cualquier otra base. Lo que se verifica despues es lo que importa:
#
#   1. Que los archivos del respaldo no cambiaron (SHA256SUMS).
#   2. Que la base restaurada tiene la misma ultima migracion.
#   3. Que los triggers que hacen inmutable el libro existen y estan activos.
#      Un respaldo que vuelve sin ellos devuelve los datos sin la garantia.
#   4. Que la cadena de hashes de cada fondo esta integra.
#   5. Que cada cabeza registrada al respaldar esta en lo restaurado, con el
#      mismo hash: es el mismo libro, no solo un libro valido.
#   6. Que volvieron todos los archivos.
# ---------------------------------------------------------------------------
set -euo pipefail

dir="${1:?Indique la carpeta del respaldo (respaldo-<fecha>).}"
sobrescribir="${2:-}"
: "${DATABASE_URL_DESTINO:?Defina DATABASE_URL_DESTINO con la base donde restaurar.}"
ARCHIVOS_DIR_DESTINO="${ARCHIVOS_DIR_DESTINO:-}"
URL="${DATABASE_URL_DESTINO%%\?*}"

fallas=0
ok() { printf '  \033[32mOK\033[0m     %s\n' "$*"; }
mal() { printf '  \033[31mFALLA\033[0m  %s\n' "$*"; fallas=$((fallas + 1)); }
falla() { printf '\n  ERROR: %s\n\n' "$*" >&2; exit 1; }
dato() { grep -E "^$1=" "$dir/manifiesto.txt" | cut -d= -f2-; }

[ -f "$dir/manifiesto.txt" ] || falla "$dir no parece un respaldo: falta manifiesto.txt."

echo
echo "Restauracion de $(basename "$dir")"

# 1. Integridad del respaldo, antes de tocar nada.
if (cd "$dir" && sha256sum --quiet -c SHA256SUMS); then
  ok "los archivos del respaldo coinciden con SHA256SUMS"
else
  falla "el respaldo fue alterado o esta incompleto. No se restaura."
fi

tablas="$(psql "$URL" -XAtc "SELECT count(*) FROM pg_tables WHERE schemaname = 'public'")"
if [ "$tablas" != "0" ] && [ "$sobrescribir" != "--sobrescribir" ]; then
  falla "la base destino tiene $tablas tablas. Use una base vacia, o --sobrescribir si de verdad quiere reemplazarla."
fi

opciones=(--no-owner --no-privileges --exit-on-error)
if [ "$sobrescribir" = "--sobrescribir" ]; then opciones+=(--clean --if-exists); fi
pg_restore "${opciones[@]}" --dbname="$URL" "$dir/base.dump"
ok "base restaurada"

if [ -f "$dir/archivos.tar.gz" ] && [ -n "$ARCHIVOS_DIR_DESTINO" ]; then
  mkdir -p "$ARCHIVOS_DIR_DESTINO"
  if [ -n "$(ls -A "$ARCHIVOS_DIR_DESTINO")" ] && [ "$sobrescribir" != "--sobrescribir" ]; then
    falla "$ARCHIVOS_DIR_DESTINO no esta vacia. Use otra carpeta o --sobrescribir."
  fi
  # Como root, tar conserva el dueño original de cada archivo, que es el que la
  # API necesita. La carpeta creada aqui se le entrega al dueño del respaldo.
  tar -C "$ARCHIVOS_DIR_DESTINO" -xzf "$dir/archivos.tar.gz"
  if [ "$(id -u)" = "0" ]; then chown "$(stat -c '%u:%g' "$dir")" "$ARCHIVOS_DIR_DESTINO"; fi
  ok "archivos restaurados en $ARCHIVOS_DIR_DESTINO"
fi

echo
echo "Verificacion"

# 2. Esquema.
migracion="$(psql "$URL" -XAtc "SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL ORDER BY migration_name DESC LIMIT 1")"
if [ "$migracion" = "$(dato migracion)" ]; then
  ok "ultima migracion: $migracion"
else
  mal "ultima migracion $migracion; el respaldo dice $(dato migracion)"
fi

# 3. Los triggers del libro. tgenabled = 'O' es "activo en modo normal".
triggers="$(psql "$URL" -XAtq <<'SQL'
SELECT count(*) FROM pg_trigger
 WHERE tgrelid = 'movimientos_contables'::regclass
   AND tgname IN ('tg_movimientos_no_update', 'tg_movimientos_no_delete', 'tg_movimientos_encadenar')
   AND tgenabled = 'O';
SQL
)"
if [ "$triggers" = "3" ]; then
  ok "el libro sigue siendo de solo insercion (3 triggers activos)"
else
  mal "solo $triggers de 3 triggers de inmutabilidad estan activos"
fi

# 4. Cada cadena, recalculada por la propia base.
read -r fondos rotas movimientos < <(psql "$URL" -XAtF ' ' <<'SQL'
SELECT count(*), count(*) FILTER (WHERE v.rota), COALESCE(sum(v.movimientos), 0)
  FROM (SELECT DISTINCT fondo_id FROM movimientos_contables) f,
       LATERAL fn_verificar_cadena(f.fondo_id) v;
SQL
)
if [ "$rotas" = "0" ]; then
  ok "cadena de hashes integra en los $fondos fondos ($movimientos movimientos)"
else
  mal "$rotas de $fondos fondos tienen la cadena rota"
fi

# 5. Mismo libro: cada cabeza del respaldo esta, con su hash.
faltan="$(psql "$URL" -XAtq -v cabezas="$(cat "$dir/cabezas.json")" <<'SQL'
SELECT count(*)
  FROM json_to_recordset(:'cabezas'::json) AS c(fondo uuid, secuencia bigint, hash text)
 WHERE NOT EXISTS (
         SELECT 1 FROM movimientos_contables m
          WHERE m.fondo_id = c.fondo AND m.secuencia = c.secuencia AND m.hash_actual = c.hash);
SQL
)"
if [ "$faltan" = "0" ]; then
  ok "las $(dato fondos) cabezas registradas al respaldar estan, con el mismo hash"
else
  mal "$faltan cabezas de cadena del respaldo no aparecen en lo restaurado"
fi

# 6. Archivos.
if [ -f "$dir/archivos.tar.gz" ] && [ -n "$ARCHIVOS_DIR_DESTINO" ]; then
  restaurados="$(find "$ARCHIVOS_DIR_DESTINO" -type f | wc -l | tr -d ' ')"
  if [ "$restaurados" = "$(dato archivos)" ]; then
    ok "$restaurados archivos ($(dato archivos_cifrados) cifrados: necesitan la CIFRADO_CLAVE del origen)"
  else
    mal "$restaurados archivos restaurados; el respaldo tiene $(dato archivos)"
  fi
fi

echo
if [ "$fallas" -eq 0 ]; then
  echo "  El respaldo restaura el mismo libro contable, integro."
  echo
else
  echo "  $fallas verificacion(es) fallaron. Este respaldo NO es confiable."
  echo
  exit 1
fi
