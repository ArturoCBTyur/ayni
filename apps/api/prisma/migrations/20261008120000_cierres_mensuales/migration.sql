-- ===========================================================================
--  Cierre mensual de cada fondo (RF-CF-09, T2.3 del plan transdisciplinario).
--
--  Un cierre congela el estado de un fondo en un mes para que el informe de
--  ese mes no cambie despues. Las reglas viven en la base, como las del libro:
--  un error del backend no tiene que poder guardar un cierre que no se
--  sostenga ni alterar uno ya guardado.
--
--  Escrita a mano y no por `migrate diff`: el diff vuelve a proponer quitar
--  el default de la columna generada `campanas.busqueda`, igual que en
--  20260915120002_defaults_cadena.
-- ===========================================================================

CREATE TABLE "cierres_mensuales" (
    "id" UUID NOT NULL,
    "fondo_id" UUID NOT NULL,
    "periodo" CHAR(7) NOT NULL,
    "contenido" TEXT NOT NULL,
    "hash_contenido" CHAR(64) NOT NULL,
    "hash_anterior" CHAR(64),
    "version_formato" INTEGER NOT NULL DEFAULT 1,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cierres_mensuales_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cierres_mensuales_fondo_id_periodo_key" ON "cierres_mensuales"("fondo_id", "periodo");

ALTER TABLE "cierres_mensuales" ADD CONSTRAINT "cierres_mensuales_fondo_id_fkey" FOREIGN KEY ("fondo_id") REFERENCES "fondos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 1. El hash es el del contenido, y el contenido dice de que fondo y de que
--    mes es. contenido es TEXT y no JSONB a proposito: JSONB reordena las
--    claves y normaliza espacios, y el hash dejaria de ser el del texto que
--    se entrega. Cualquiera recalcula SHA-256 sobre lo que recibe.  [CYF INF]
-- ---------------------------------------------------------------------------
ALTER TABLE cierres_mensuales
  ADD CONSTRAINT ck_cierres_periodo_valido
    CHECK (periodo ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  ADD CONSTRAINT ck_cierres_hash_del_contenido
    CHECK (hash_contenido = encode(digest(contenido, 'sha256'), 'hex')),
  ADD CONSTRAINT ck_cierres_contenido_coherente
    CHECK (
          (contenido::jsonb #>> '{fondo,id}')        = fondo_id::text
      AND (contenido::jsonb #>> '{periodo,codigo}')  = periodo
      AND (contenido::jsonb #>> '{cierreAnterior,hash}') IS NOT DISTINCT FROM hash_anterior
    );


-- ---------------------------------------------------------------------------
-- 2. Inmutabilidad: un cierre no se corrige, se explica. Si el libro de un
--    mes cerrado cambia, el cierre sigue diciendo lo que habia, y la
--    diferencia es justamente lo que hay que investigar.             [CYF]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cierres_solo_insercion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Los cierres mensuales son de solo insercion: % no esta permitido sobre cierres_mensuales.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_cierres_no_update
  BEFORE UPDATE ON cierres_mensuales
  FOR EACH ROW EXECUTE FUNCTION fn_cierres_solo_insercion();

CREATE TRIGGER tg_cierres_no_delete
  BEFORE DELETE ON cierres_mensuales
  FOR EACH ROW EXECUTE FUNCTION fn_cierres_solo_insercion();


-- ---------------------------------------------------------------------------
-- 3. Encadenamiento: cada cierre apunta al ultimo del fondo, y los meses se
--    cierran en orden. Asi no se puede intercalar un mes "olvidado" entre
--    dos cierres ya publicados, ni reemplazar la historia con otra cadena.
--    El advisory lock serializa los cierres del mismo fondo.         [CYF INF]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_cierres_encadenar() RETURNS trigger AS $$
DECLARE
  v_periodo CHAR(7);
  v_hash    CHAR(64);
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('cierre:' || NEW.fondo_id::text)::BIGINT);

  SELECT periodo, hash_contenido INTO v_periodo, v_hash
    FROM cierres_mensuales
   WHERE fondo_id = NEW.fondo_id
   ORDER BY periodo DESC
   LIMIT 1;

  IF v_periodo IS NOT NULL AND NEW.periodo <= v_periodo THEN
    RAISE EXCEPTION
      'El fondo % ya tiene cerrado %: no se puede cerrar % despues.',
      NEW.fondo_id, v_periodo, NEW.periodo
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.hash_anterior IS DISTINCT FROM v_hash THEN
    RAISE EXCEPTION
      'El cierre % del fondo % no apunta al cierre anterior (%).',
      NEW.periodo, NEW.fondo_id, COALESCE(v_periodo, 'ninguno')
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_cierres_encadenar
  BEFORE INSERT ON cierres_mensuales
  FOR EACH ROW EXECUTE FUNCTION fn_cierres_encadenar();
