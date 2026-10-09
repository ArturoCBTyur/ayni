-- ===========================================================================
--  Encuestas de SOC-1 y PSI-1 (RF-SO-05, RF-DE-06; Fase 4 del plan).
--
--  Escrita a mano y no por `migrate diff`, por la misma razon que las
--  anteriores: el diff vuelve a proponer quitar el default de la columna
--  generada `campanas.busqueda`.
-- ===========================================================================

CREATE TYPE "MomentoEncuesta" AS ENUM ('LINEA_BASE', 'SEGUIMIENTO', 'UNICA');

CREATE TABLE "instrumentos_encuesta" (
    "id" UUID NOT NULL,
    "codigo" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "indicador" TEXT NOT NULL,
    "contenido" TEXT NOT NULL,
    "hash_contenido" CHAR(64) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "instrumentos_encuesta_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "respuestas_encuesta" (
    "id" UUID NOT NULL,
    "instrumento_id" UUID NOT NULL,
    "momento" "MomentoEncuesta" NOT NULL,
    "seudonimo" CHAR(64) NOT NULL,
    "rol" TEXT NOT NULL,
    "valores" JSONB NOT NULL,
    "puntaje" DECIMAL(6,2) NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "respuestas_encuesta_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "instrumentos_encuesta_codigo_version_key" ON "instrumentos_encuesta"("codigo", "version");
CREATE INDEX "respuestas_encuesta_instrumento_id_momento_idx" ON "respuestas_encuesta"("instrumento_id", "momento");
CREATE UNIQUE INDEX "respuestas_encuesta_instrumento_id_momento_seudonimo_key" ON "respuestas_encuesta"("instrumento_id", "momento", "seudonimo");

ALTER TABLE "respuestas_encuesta" ADD CONSTRAINT "respuestas_encuesta_instrumento_id_fkey" FOREIGN KEY ("instrumento_id") REFERENCES "instrumentos_encuesta"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 1. Un instrumento publicado no cambia. El hash es el de su contenido y el
--    contenido dice que instrumento y que version es. Si hace falta otro
--    item, es otra version: las respuestas de antes siguen siendo de la
--    anterior y no se mezclan.                                     [SOC PSI]
-- ---------------------------------------------------------------------------
ALTER TABLE instrumentos_encuesta
  ADD CONSTRAINT ck_instrumentos_hash_del_contenido
    CHECK (hash_contenido = encode(digest(contenido, 'sha256'), 'hex')),
  ADD CONSTRAINT ck_instrumentos_contenido_coherente
    CHECK (
          (contenido::jsonb ->> 'codigo')            = codigo
      AND (contenido::jsonb ->> 'version')::INTEGER  = version
      AND (contenido::jsonb ->> 'indicador')         = indicador
    );

-- Una sola version activa por instrumento.
CREATE UNIQUE INDEX ux_instrumentos_activo ON instrumentos_encuesta (codigo) WHERE activo;

CREATE OR REPLACE FUNCTION fn_instrumentos_inmutables() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Un instrumento publicado no se borra: retirelo con activo = false.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF NEW.codigo IS DISTINCT FROM OLD.codigo
     OR NEW.version IS DISTINCT FROM OLD.version
     OR NEW.indicador IS DISTINCT FROM OLD.indicador
     OR NEW.contenido IS DISTINCT FROM OLD.contenido
     OR NEW.hash_contenido IS DISTINCT FROM OLD.hash_contenido THEN
    RAISE EXCEPTION 'Un instrumento publicado no cambia: publique una version nueva.'
      USING ERRCODE = 'restrict_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_instrumentos_inmutables
  BEFORE UPDATE OR DELETE ON instrumentos_encuesta
  FOR EACH ROW EXECUTE FUNCTION fn_instrumentos_inmutables();


-- ---------------------------------------------------------------------------
-- 2. Una respuesta no se reescribe. Lo unico que puede cambiar es su
--    seudonimo, y solo para desvincularla de quien respondio cuando revoca
--    el consentimiento de investigacion (D6).                       [DER SOC]
-- ---------------------------------------------------------------------------
ALTER TABLE respuestas_encuesta
  ADD CONSTRAINT ck_respuestas_puntaje_rango CHECK (puntaje >= 0 AND puntaje <= 100),
  ADD CONSTRAINT ck_respuestas_valores_lista CHECK (jsonb_typeof(valores) = 'array');

CREATE OR REPLACE FUNCTION fn_respuestas_solo_seudonimo() RETURNS trigger AS $$
BEGIN
  IF NEW.instrumento_id IS DISTINCT FROM OLD.instrumento_id
     OR NEW.momento IS DISTINCT FROM OLD.momento
     OR NEW.rol IS DISTINCT FROM OLD.rol
     OR NEW.valores IS DISTINCT FROM OLD.valores
     OR NEW.puntaje IS DISTINCT FROM OLD.puntaje
     OR NEW.creado_en IS DISTINCT FROM OLD.creado_en THEN
    RAISE EXCEPTION 'Una respuesta de encuesta no se modifica; solo se puede desvincular.'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_respuestas_solo_seudonimo
  BEFORE UPDATE ON respuestas_encuesta
  FOR EACH ROW EXECUTE FUNCTION fn_respuestas_solo_seudonimo();
