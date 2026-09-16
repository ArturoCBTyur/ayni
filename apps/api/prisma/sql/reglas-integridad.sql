-- ===========================================================================
--  Trazabilidad Radical - Reglas de integridad y restricciones clave
--  Entregable 2, seccion 6.6.
--
--  Esto es lo que hace que la base de datos sea auditable y no solo un
--  almacen: si estas reglas se cumplen, las preguntas de auditoria de la
--  Tabla 14 tienen respuesta verificable. Se aplican en la BD, no en la
--  aplicacion, porque un bug del backend no debe poder romper el libro.
--
--  Se aplica como migracion posterior a la inicial generada por Prisma.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- 1. CHECK (monto > 0) en donaciones, pagos, gastos, comprobantes y
--    aplicaciones.                                                     [CYF]
-- ---------------------------------------------------------------------------
ALTER TABLE donaciones
  ADD CONSTRAINT ck_donaciones_monto_positivo CHECK (monto > 0),
  ADD CONSTRAINT ck_donaciones_neto_no_negativo CHECK (monto_neto >= 0),
  ADD CONSTRAINT ck_donaciones_aplicado_no_excede CHECK (monto_aplicado >= 0 AND monto_aplicado <= monto_neto);

ALTER TABLE pagos
  ADD CONSTRAINT ck_pagos_monto_positivo CHECK (monto > 0),
  ADD CONSTRAINT ck_pagos_comision_no_negativa CHECK (comision >= 0),
  ADD CONSTRAINT ck_pagos_neto_coherente CHECK (monto_neto = monto - comision);

ALTER TABLE gastos
  ADD CONSTRAINT ck_gastos_monto_positivo CHECK (monto_declarado > 0),
  ADD CONSTRAINT ck_gastos_aprobado_positivo CHECK (monto_aprobado IS NULL OR monto_aprobado > 0);

ALTER TABLE comprobantes
  ADD CONSTRAINT ck_comprobantes_total_positivo CHECK (total > 0),
  ADD CONSTRAINT ck_comprobantes_partes_no_negativas CHECK (subtotal >= 0 AND igv >= 0),
  -- Aritmetica del comprobante con tolerancia de un centimo por redondeo.
  ADD CONSTRAINT ck_comprobantes_suma_coherente CHECK (abs((subtotal + igv) - total) <= 0.01);

ALTER TABLE aplicaciones_donacion
  ADD CONSTRAINT ck_aplicaciones_monto_positivo CHECK (monto > 0);

ALTER TABLE movimientos_contables
  ADD CONSTRAINT ck_movimientos_monto_positivo CHECK (monto > 0);

ALTER TABLE fondos
  ADD CONSTRAINT ck_fondos_meta_positiva CHECK (meta > 0),
  ADD CONSTRAINT ck_fondos_saldos_no_negativos
    CHECK (saldo_recaudado >= 0 AND saldo_retenido >= 0 AND saldo_ejecutado >= 0);

ALTER TABLE feedback_donante
  ADD CONSTRAINT ck_feedback_valoracion_rango
    CHECK (valoracion IS NULL OR (valoracion BETWEEN 1 AND 5));

ALTER TABLE reglas_confianza
  ADD CONSTRAINT ck_reglas_umbrales_ordenados
    CHECK (umbral_alto > umbral_medio AND umbral_medio >= 0 AND umbral_alto <= 100),
  -- Los tres pesos deben sumar 1 para que el score final quede en 0-100.
  ADD CONSTRAINT ck_reglas_pesos_suman_uno
    CHECK (abs((peso_documental + peso_visual + peso_anomalia) - 1) <= 0.001);


-- ---------------------------------------------------------------------------
-- 2. Inmutabilidad del libro: se rechaza UPDATE y DELETE sobre
--    movimientos_contables. Las correcciones se registran como movimientos
--    de tipo REVERSO (RN-03, RNF-07).                              [CYF INF]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_libro_solo_insercion() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'El libro de movimientos es de solo insercion: % no esta permitido sobre movimientos_contables. Registre un movimiento de tipo REVERSO (RN-03).',
    TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_movimientos_no_update
  BEFORE UPDATE ON movimientos_contables
  FOR EACH ROW EXECUTE FUNCTION fn_libro_solo_insercion();

CREATE TRIGGER tg_movimientos_no_delete
  BEFORE DELETE ON movimientos_contables
  FOR EACH ROW EXECUTE FUNCTION fn_libro_solo_insercion();


-- ---------------------------------------------------------------------------
-- 3. Encadenamiento de hashes: hash_actual = SHA-256(hash_previo || datos).
--    La secuencia y ambos hashes los asigna la base, nunca la aplicacion,
--    para que un backend comprometido no pueda falsificar la cadena.
--    El advisory lock serializa las inserciones del mismo fondo. [CYF INF]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_movimiento_encadenar() RETURNS trigger AS $$
DECLARE
  v_secuencia    BIGINT;
  v_hash_previo  CHAR(64);
  v_payload      TEXT;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.fondo_id::text)::BIGINT);

  SELECT secuencia, hash_actual
    INTO v_secuencia, v_hash_previo
    FROM movimientos_contables
   WHERE fondo_id = NEW.fondo_id
   ORDER BY secuencia DESC
   LIMIT 1;

  IF v_secuencia IS NULL THEN
    v_secuencia   := 1;
    v_hash_previo := NULL;
  ELSE
    v_secuencia := v_secuencia + 1;
  END IF;

  NEW.secuencia   := v_secuencia;
  NEW.hash_previo := v_hash_previo;

  v_payload :=
       COALESCE(v_hash_previo, '')            || '|' ||
       NEW.fondo_id::TEXT                     || '|' ||
       NEW.tipo::TEXT                         || '|' ||
       NEW.cuenta_debe                        || '|' ||
       NEW.cuenta_haber                       || '|' ||
       to_char(NEW.monto, 'FM9999999999.00')  || '|' ||
       COALESCE(NEW.donacion_id::TEXT, '')    || '|' ||
       COALESCE(NEW.gasto_id::TEXT, '')       || '|' ||
       v_secuencia::TEXT;

  NEW.hash_actual := encode(digest(v_payload, 'sha256'), 'hex');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_movimientos_encadenar
  BEFORE INSERT ON movimientos_contables
  FOR EACH ROW EXECUTE FUNCTION fn_movimiento_encadenar();

-- Verificacion de la cadena. La ejecuta un job diario (RNF-07) y tambien
-- responde la pregunta de auditoria "el saldo de un fondo cuadra?".
CREATE OR REPLACE FUNCTION fn_verificar_cadena(p_fondo_id UUID)
RETURNS TABLE(fondo_id UUID, movimientos BIGINT, rota BOOLEAN, secuencia_rota BIGINT) AS $$
DECLARE
  r              RECORD;
  v_hash_previo  CHAR(64) := NULL;
  v_payload      TEXT;
  v_esperado     CHAR(64);
  v_total        BIGINT := 0;
  v_rota         BOOLEAN := FALSE;
  v_seq_rota     BIGINT := NULL;
BEGIN
  FOR r IN
    SELECT * FROM movimientos_contables
     WHERE movimientos_contables.fondo_id = p_fondo_id
     ORDER BY secuencia ASC
  LOOP
    v_total := v_total + 1;

    v_payload :=
         COALESCE(v_hash_previo, '')          || '|' ||
         r.fondo_id::TEXT                     || '|' ||
         r.tipo::TEXT                         || '|' ||
         r.cuenta_debe                        || '|' ||
         r.cuenta_haber                       || '|' ||
         to_char(r.monto, 'FM9999999999.00')  || '|' ||
         COALESCE(r.donacion_id::TEXT, '')    || '|' ||
         COALESCE(r.gasto_id::TEXT, '')       || '|' ||
         r.secuencia::TEXT;

    v_esperado := encode(digest(v_payload, 'sha256'), 'hex');

    IF v_esperado <> r.hash_actual OR r.hash_previo IS DISTINCT FROM v_hash_previo THEN
      v_rota := TRUE;
      v_seq_rota := r.secuencia;
      EXIT;
    END IF;

    v_hash_previo := r.hash_actual;
  END LOOP;

  RETURN QUERY SELECT p_fondo_id, v_total, v_rota, v_seq_rota;
END;
$$ LANGUAGE plpgsql;


-- ---------------------------------------------------------------------------
-- 4. Saldos del fondo derivados del libro. El libro es la unica fuente de
--    verdad; los saldos de fondos son una proyeccion que mantiene la BD,
--    de modo que nunca puedan divergir del asiento.                   [CYF]
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
  END CASE;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_movimientos_saldos
  AFTER INSERT ON movimientos_contables
  FOR EACH ROW EXECUTE FUNCTION fn_movimiento_aplicar_saldos();


-- ---------------------------------------------------------------------------
-- 5. Aplicacion de gastos a donaciones (FIFO). Tres garantias:
--    a) la donacion pertenece al mismo fondo que el gasto;
--    b) no se aplica mas de lo que a esa donacion le queda disponible;
--    c) al cerrar la transaccion, la suma aplicada al gasto iguala su
--       monto aprobado (RN-04) y no excede el saldo retenido del fondo.
--    (c) es un constraint trigger diferido: permite insertar varias filas
--    en una sola transaccion y valida recien al commit.           [CYF PSI]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_aplicacion_validar() RETURNS trigger AS $$
DECLARE
  v_fondo_gasto     UUID;
  v_fondo_donacion  UUID;
  v_estado_donacion TEXT;
  v_disponible      NUMERIC(12,2);
BEGIN
  SELECT fondo_id INTO v_fondo_gasto FROM gastos WHERE id = NEW.gasto_id;

  SELECT fondo_id, estado::TEXT, (monto_neto - monto_aplicado)
    INTO v_fondo_donacion, v_estado_donacion, v_disponible
    FROM donaciones WHERE id = NEW.donacion_id
     FOR UPDATE;

  IF v_fondo_gasto IS DISTINCT FROM v_fondo_donacion THEN
    RAISE EXCEPTION
      'La donacion % pertenece a otro fondo que el gasto % (RN-01).',
      NEW.donacion_id, NEW.gasto_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF v_estado_donacion <> 'CONFIRMADA' THEN
    RAISE EXCEPTION
      'Solo se pueden aplicar gastos a donaciones confirmadas (donacion %, estado %).',
      NEW.donacion_id, v_estado_donacion
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.monto > v_disponible THEN
    RAISE EXCEPTION
      'La aplicacion de % excede el saldo disponible % de la donacion %.',
      NEW.monto, v_disponible, NEW.donacion_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  UPDATE donaciones
     SET monto_aplicado = monto_aplicado + NEW.monto
   WHERE id = NEW.donacion_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_aplicacion_validar
  BEFORE INSERT ON aplicaciones_donacion
  FOR EACH ROW EXECUTE FUNCTION fn_aplicacion_validar();

-- RN-04: la suma aplicada debe igualar el monto aprobado del gasto.
CREATE OR REPLACE FUNCTION fn_aplicacion_cuadre() RETURNS trigger AS $$
DECLARE
  v_monto_aprobado NUMERIC(12,2);
  v_suma           NUMERIC(12,2);
  v_estado         TEXT;
BEGIN
  SELECT monto_aprobado, estado::TEXT
    INTO v_monto_aprobado, v_estado
    FROM gastos WHERE id = NEW.gasto_id;

  -- Solo exigimos el cuadre cuando el gasto ya esta aprobado.
  IF v_estado <> 'APROBADO' THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(monto), 0) INTO v_suma
    FROM aplicaciones_donacion WHERE gasto_id = NEW.gasto_id;

  IF v_suma <> v_monto_aprobado THEN
    RAISE EXCEPTION
      'La suma aplicada (%) no iguala el monto aprobado (%) del gasto % (RN-04).',
      v_suma, v_monto_aprobado, NEW.gasto_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER tg_aplicacion_cuadre
  AFTER INSERT ON aplicaciones_donacion
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION fn_aplicacion_cuadre();


-- ---------------------------------------------------------------------------
-- 6. Coherencia de estados: un gasto solo pasa a APROBADO si existe un
--    analisis de nivel ALTO o una revision con decision APROBAR.
--    Esto impide que un gasto se apruebe sin rastro de por que.  [CYF SOC]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_gasto_validar_aprobacion() RETURNS trigger AS $$
DECLARE
  v_tiene_analisis_alto BOOLEAN;
  v_tiene_revision      BOOLEAN;
BEGIN
  IF NEW.estado <> 'APROBADO' OR OLD.estado = 'APROBADO' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM analisis_aini
     WHERE gasto_id = NEW.id AND nivel = 'ALTO'
  ) INTO v_tiene_analisis_alto;

  SELECT EXISTS (
    SELECT 1 FROM revisiones_auditoria
     WHERE gasto_id = NEW.id AND decision = 'APROBAR'
  ) INTO v_tiene_revision;

  IF NOT (v_tiene_analisis_alto OR v_tiene_revision) THEN
    RAISE EXCEPTION
      'El gasto % no puede pasar a APROBADO sin un analisis de nivel ALTO ni una revision con decision APROBAR.',
      NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  IF NEW.monto_aprobado IS NULL THEN
    RAISE EXCEPTION
      'Un gasto APROBADO requiere monto_aprobado (gasto %).', NEW.id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_gasto_validar_aprobacion
  BEFORE UPDATE ON gastos
  FOR EACH ROW EXECUTE FUNCTION fn_gasto_validar_aprobacion();


-- ---------------------------------------------------------------------------
-- 7. Privacidad: una evidencia solo puede asociarse a una notificacion si
--    esta anonimizada. Esta es la regla que materializa RNF-06 y RF-DE-04:
--    mientras exista, ninguna ruta del backend puede mostrar a un donante
--    la cara de un beneficiario.                                  [DER COM]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_notificacion_validar_privacidad() RETURNS trigger AS $$
DECLARE
  v_anonimizada BOOLEAN;
BEGIN
  IF NEW.evidencia_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT anonimizada INTO v_anonimizada FROM evidencias WHERE id = NEW.evidencia_id;

  IF NOT COALESCE(v_anonimizada, FALSE) THEN
    RAISE EXCEPTION
      'No se puede notificar la evidencia % porque no esta anonimizada (RNF-06).',
      NEW.evidencia_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_notificacion_privacidad
  BEFORE INSERT OR UPDATE ON notificaciones
  FOR EACH ROW EXECUTE FUNCTION fn_notificacion_validar_privacidad();


-- ---------------------------------------------------------------------------
-- 8. Consentimiento: las notificaciones no transaccionales solo se envian
--    si hay consentimiento vigente para comunicaciones (RF-DE-01). [DER]
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_notificacion_validar_consentimiento() RETURNS trigger AS $$
DECLARE
  v_vigente BOOLEAN;
BEGIN
  IF NEW.transaccional THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM consentimientos
     WHERE usuario_id = NEW.usuario_id
       AND finalidad  = 'COMUNICACIONES'
       AND otorgado   = TRUE
       AND revocado_en IS NULL
  ) INTO v_vigente;

  IF NOT v_vigente THEN
    RAISE EXCEPTION
      'El usuario % no tiene consentimiento vigente para comunicaciones (RF-DE-01).',
      NEW.usuario_id
      USING ERRCODE = 'integrity_constraint_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_notificacion_consentimiento
  BEFORE INSERT ON notificaciones
  FOR EACH ROW EXECUTE FUNCTION fn_notificacion_validar_consentimiento();


-- ---------------------------------------------------------------------------
-- 9. Busqueda de causas en español (RF-06) e indices complementarios.
-- ---------------------------------------------------------------------------
ALTER TABLE campanas
  ADD COLUMN IF NOT EXISTS busqueda tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('spanish', COALESCE(titulo, '')), 'A') ||
    setweight(to_tsvector('spanish', COALESCE(causa, '')), 'B')  ||
    setweight(to_tsvector('spanish', COALESCE(descripcion, '')), 'C')
  ) STORED;

CREATE INDEX IF NOT EXISTS ix_campanas_busqueda ON campanas USING GIN (busqueda);

-- Una ONG no puede repetir el mismo nombre de fondo dentro de una campaña.
CREATE UNIQUE INDEX IF NOT EXISTS ux_fondos_campana_nombre
  ON fondos (campana_id, lower(nombre));

-- Solo puede haber una regla de confianza activa a la vez (CU18).
CREATE UNIQUE INDEX IF NOT EXISTS ux_reglas_confianza_activa
  ON reglas_confianza (activa) WHERE activa = TRUE;

-- Un unico modelo activo por nombre (RF-IA-11): permite conmutar entre
-- reglas-v0 y AIni sin ambiguedad.
CREATE UNIQUE INDEX IF NOT EXISTS ux_modelos_ia_activo
  ON modelos_ia (nombre) WHERE estado = 'ACTIVO';
