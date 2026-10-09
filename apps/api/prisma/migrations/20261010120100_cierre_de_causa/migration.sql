-- ===========================================================================
--  Cierre de causa (RF-CF-11, RF-CF-12, RF-IN-05; Fase 3 del plan).
--
--  D2 del ADR-0007, propuesta sin firmar: al cerrar un fondo corre un plazo
--  para justificar lo retenido; al vencer, cada donante elige que pasa con
--  su parte. Escrita a mano por la misma razon que las anteriores: el diff
--  vuelve a proponer quitar el default de `campanas.busqueda`.
-- ===========================================================================

CREATE TYPE "EstadoCierreCausa" AS ENUM ('JUSTIFICANDO', 'ELIGIENDO', 'RESUELTO');

CREATE TYPE "DestinoRemanente" AS ENUM ('DEVOLUCION', 'REASIGNACION');

ALTER TABLE "donaciones" ADD COLUMN     "donacion_origen_id" UUID;

CREATE TABLE "cierres_causa" (
    "id" UUID NOT NULL,
    "fondo_id" UUID NOT NULL,
    "estado" "EstadoCierreCausa" NOT NULL DEFAULT 'JUSTIFICANDO',
    "iniciado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vence_justificacion_en" TIMESTAMPTZ(6) NOT NULL,
    "aviso_ong_en" TIMESTAMPTZ(6),
    "vence_eleccion_en" TIMESTAMPTZ(6),
    "remanente_total" DECIMAL(12,2),
    "resuelto_en" TIMESTAMPTZ(6),
    "observacion" TEXT,

    CONSTRAINT "cierres_causa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "remanentes_donacion" (
    "id" UUID NOT NULL,
    "cierre_id" UUID NOT NULL,
    "donacion_id" UUID NOT NULL,
    "monto" DECIMAL(12,2) NOT NULL,
    "destino" "DestinoRemanente",
    "fondo_destino_id" UUID,
    "elegido_por" TEXT,
    "elegido_en" TIMESTAMPTZ(6),
    "resuelto_en" TIMESTAMPTZ(6),
    "donacion_destino_id" UUID,
    "reembolso_referencia" TEXT,
    "reembolsado_en" TIMESTAMPTZ(6),
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remanentes_donacion_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "informes_cierre" (
    "id" UUID NOT NULL,
    "cierre_id" UUID NOT NULL,
    "fondo_id" UUID NOT NULL,
    "contenido" TEXT NOT NULL,
    "hash_contenido" CHAR(64) NOT NULL,
    "creado_en" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "informes_cierre_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cierres_causa_fondo_id_key" ON "cierres_causa"("fondo_id");

CREATE INDEX "cierres_causa_estado_idx" ON "cierres_causa"("estado");

CREATE UNIQUE INDEX "remanentes_donacion_donacion_id_key" ON "remanentes_donacion"("donacion_id");

CREATE UNIQUE INDEX "remanentes_donacion_donacion_destino_id_key" ON "remanentes_donacion"("donacion_destino_id");

CREATE INDEX "remanentes_donacion_cierre_id_idx" ON "remanentes_donacion"("cierre_id");

CREATE UNIQUE INDEX "informes_cierre_cierre_id_key" ON "informes_cierre"("cierre_id");

ALTER TABLE "cierres_causa" ADD CONSTRAINT "cierres_causa_fondo_id_fkey" FOREIGN KEY ("fondo_id") REFERENCES "fondos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "remanentes_donacion" ADD CONSTRAINT "remanentes_donacion_cierre_id_fkey" FOREIGN KEY ("cierre_id") REFERENCES "cierres_causa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "remanentes_donacion" ADD CONSTRAINT "remanentes_donacion_donacion_id_fkey" FOREIGN KEY ("donacion_id") REFERENCES "donaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "remanentes_donacion" ADD CONSTRAINT "remanentes_donacion_fondo_destino_id_fkey" FOREIGN KEY ("fondo_destino_id") REFERENCES "fondos"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "remanentes_donacion" ADD CONSTRAINT "remanentes_donacion_donacion_destino_id_fkey" FOREIGN KEY ("donacion_destino_id") REFERENCES "donaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "informes_cierre" ADD CONSTRAINT "informes_cierre_cierre_id_fkey" FOREIGN KEY ("cierre_id") REFERENCES "cierres_causa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "donaciones" ADD CONSTRAINT "donaciones_donacion_origen_id_fkey" FOREIGN KEY ("donacion_origen_id") REFERENCES "donaciones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- 1. Saldos del fondo con los movimientos del cierre. Sin estas ramas, el
--    CASE del trigger no encuentra el tipo y el asiento falla.        [CYF]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_movimiento_aplicar_saldos() RETURNS trigger AS $$
BEGIN
  CASE NEW.tipo
    WHEN 'INGRESO' THEN
      UPDATE fondos SET saldo_recaudado = saldo_recaudado + NEW.monto
       WHERE id = NEW.fondo_id;

    WHEN 'COMISION' THEN
      UPDATE fondos SET saldo_recaudado = saldo_recaudado - NEW.monto
       WHERE id = NEW.fondo_id;

    WHEN 'RETENCION' THEN
      UPDATE fondos SET saldo_retenido = saldo_retenido + NEW.monto
       WHERE id = NEW.fondo_id;

    WHEN 'EJECUCION' THEN
      UPDATE fondos
         SET saldo_retenido  = saldo_retenido - NEW.monto,
             saldo_ejecutado = saldo_ejecutado + NEW.monto
       WHERE id = NEW.fondo_id;

    WHEN 'REVERSO' THEN
      -- Un reverso devuelve el importe al estado retenido.
      UPDATE fondos
         SET saldo_retenido  = saldo_retenido + NEW.monto,
             saldo_ejecutado = GREATEST(saldo_ejecutado - NEW.monto, 0)
       WHERE id = NEW.fondo_id;

    WHEN 'REASIGNACION' THEN
      UPDATE fondos SET saldo_retenido = saldo_retenido - NEW.monto
       WHERE id = NEW.fondo_id;

    -- El remanente sale del fondo, devuelto al donante o hacia otro fondo:
    -- ya no es dinero recaudado por esta causa. Lo retenido ya bajo con la
    -- REASIGNACION que lo precede.
    WHEN 'DEVOLUCION', 'TRASLADO_SALIDA' THEN
      UPDATE fondos SET saldo_recaudado = saldo_recaudado - NEW.monto
       WHERE id = NEW.fondo_id;

    -- Y entra al fondo de destino, donde una RETENCION lo vuelve a condicionar.
    WHEN 'TRASLADO_ENTRADA' THEN
      UPDATE fondos SET saldo_recaudado = saldo_recaudado + NEW.monto
       WHERE id = NEW.fondo_id;
  END CASE;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 2. Un remanente tiene monto, y si va a otro fondo, dice a cual y no es el
--    mismo. Resuelto implica destino elegido.                     [CYF DER]
-- ---------------------------------------------------------------------------
ALTER TABLE remanentes_donacion
  ADD CONSTRAINT ck_remanentes_monto_positivo CHECK (monto > 0),
  ADD CONSTRAINT ck_remanentes_destino_completo
    CHECK (destino IS DISTINCT FROM 'REASIGNACION' OR fondo_destino_id IS NOT NULL),
  ADD CONSTRAINT ck_remanentes_resuelto_con_destino
    CHECK (resuelto_en IS NULL OR destino IS NOT NULL);

CREATE OR REPLACE FUNCTION fn_remanente_otro_fondo() RETURNS trigger AS $$
BEGIN
  IF NEW.fondo_destino_id IS NOT NULL AND NEW.fondo_destino_id = (
       SELECT fondo_id FROM cierres_causa WHERE id = NEW.cierre_id) THEN
    RAISE EXCEPTION 'Un remanente no se reasigna al mismo fondo que se cierra.'
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_remanente_otro_fondo
  BEFORE INSERT OR UPDATE ON remanentes_donacion
  FOR EACH ROW EXECUTE FUNCTION fn_remanente_otro_fondo();


-- ---------------------------------------------------------------------------
-- 3. El informe de cierre, como un cierre mensual: el hash es el de su
--    contenido, el contenido dice de que fondo y que cierre es, y no se
--    modifica ni se borra. La pagina publica de verificacion depende de
--    que esto sea cierto.                                        [CYF INF]
-- ---------------------------------------------------------------------------
ALTER TABLE informes_cierre
  ADD CONSTRAINT ck_informes_hash_del_contenido
    CHECK (hash_contenido = encode(digest(contenido, 'sha256'), 'hex')),
  ADD CONSTRAINT ck_informes_contenido_coherente
    CHECK (
          (contenido::jsonb #>> '{fondo,id}')  = fondo_id::text
      AND (contenido::jsonb #>> '{cierre,id}') = cierre_id::text
    );

CREATE OR REPLACE FUNCTION fn_informes_solo_insercion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Los informes de cierre son de solo insercion: % no esta permitido sobre informes_cierre.',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_informes_no_update
  BEFORE UPDATE ON informes_cierre
  FOR EACH ROW EXECUTE FUNCTION fn_informes_solo_insercion();

CREATE TRIGGER tg_informes_no_delete
  BEFORE DELETE ON informes_cierre
  FOR EACH ROW EXECUTE FUNCTION fn_informes_solo_insercion();
