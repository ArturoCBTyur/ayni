-- ===========================================================================
--  Limpieza de datos dejados por las pruebas automatizadas.
--
--  Las primeras versiones de integridad.spec.ts colgaban sus fondos de la
--  campaña del seed. Como el libro contable no admite DELETE, cada corrida
--  dejaba fondos huerfanos alli de forma permanente. Los datos de
--  demostracion tienen que poder mostrarse tal cual, asi que se retiran.
--
--  Es quirurgico a proposito: no borra la base ni usa TRUNCATE. Solo toca
--  filas con marcas inequivocas de haber sido creadas por una prueba, y
--  deja intacto todo lo que sembro prisma/seed.ts.
--
--  Para una base de desarrollo desde cero existe `npm run db:reset`, que es
--  destructivo y por eso lo ejecuta una persona, no un agente.
-- ===========================================================================

BEGIN;

-- Conjuntos a retirar, definidos una sola vez.
CREATE TEMP TABLE _ongs_prueba ON COMMIT DROP AS
  SELECT id FROM ongs
   WHERE razon_social LIKE 'Asociacion de Prueba%'
      OR razon_social LIKE 'ONG de pruebas%';

CREATE TEMP TABLE _fondos_prueba ON COMMIT DROP AS
  SELECT f.id FROM fondos f
    JOIN campanas c ON c.id = f.campana_id
   WHERE c.ong_id IN (SELECT id FROM _ongs_prueba)
      -- Fondos intrusos dentro de las campañas legitimas del seed.
      OR (c.slug IN ('rescate-invierno-2026', 'esterilizacion-comunitaria')
          AND f.nombre NOT IN (
            'Alimentos para rescate animal',
            'Atencion veterinaria',
            'Jornadas de esterilizacion',
            'Medicamentos post operatorios'
          ));

CREATE TEMP TABLE _usuarios_prueba ON COMMIT DROP AS
  SELECT id FROM usuarios WHERE correo LIKE '%@prueba.pe';

-- El libro es de solo insercion por diseño; se abre solo para esta limpieza.
ALTER TABLE movimientos_contables DISABLE TRIGGER tg_movimientos_no_delete;
ALTER TABLE cierres_mensuales DISABLE TRIGGER tg_cierres_no_delete;
ALTER TABLE informes_cierre DISABLE TRIGGER tg_informes_no_delete;

-- De adentro hacia afuera, respetando las claves foraneas.
DELETE FROM notificaciones     WHERE gasto_id IN (SELECT id FROM gastos WHERE fondo_id IN (SELECT id FROM _fondos_prueba))
                                  OR usuario_id IN (SELECT id FROM _usuarios_prueba);
DELETE FROM feedback_donante   WHERE gasto_id IN (SELECT id FROM gastos WHERE fondo_id IN (SELECT id FROM _fondos_prueba));
DELETE FROM revisiones_auditoria WHERE gasto_id IN (SELECT id FROM gastos WHERE fondo_id IN (SELECT id FROM _fondos_prueba));
DELETE FROM alertas            WHERE gasto_id IN (SELECT id FROM gastos WHERE fondo_id IN (SELECT id FROM _fondos_prueba))
                                  OR ong_id IN (SELECT id FROM _ongs_prueba);
DELETE FROM analisis_aini      WHERE gasto_id IN (SELECT id FROM gastos WHERE fondo_id IN (SELECT id FROM _fondos_prueba));
DELETE FROM evidencias         WHERE gasto_id IN (SELECT id FROM gastos WHERE fondo_id IN (SELECT id FROM _fondos_prueba));
DELETE FROM comprobantes       WHERE gasto_id IN (SELECT id FROM gastos WHERE fondo_id IN (SELECT id FROM _fondos_prueba));
DELETE FROM aplicaciones_donacion WHERE gasto_id IN (SELECT id FROM gastos WHERE fondo_id IN (SELECT id FROM _fondos_prueba));
DELETE FROM trabajos_verificacion WHERE gasto_id IN (SELECT id FROM gastos WHERE fondo_id IN (SELECT id FROM _fondos_prueba));
DELETE FROM cierres_mensuales     WHERE fondo_id IN (SELECT id FROM _fondos_prueba);
DELETE FROM informes_cierre       WHERE fondo_id IN (SELECT id FROM _fondos_prueba);
DELETE FROM remanentes_donacion   WHERE cierre_id IN (SELECT id FROM cierres_causa WHERE fondo_id IN (SELECT id FROM _fondos_prueba))
                                     OR fondo_destino_id IN (SELECT id FROM _fondos_prueba);
DELETE FROM cierres_causa         WHERE fondo_id IN (SELECT id FROM _fondos_prueba);
DELETE FROM movimientos_contables WHERE fondo_id IN (SELECT id FROM _fondos_prueba);
DELETE FROM gastos             WHERE fondo_id IN (SELECT id FROM _fondos_prueba);
DELETE FROM pagos              WHERE donacion_id IN (SELECT id FROM donaciones WHERE fondo_id IN (SELECT id FROM _fondos_prueba));
DELETE FROM donaciones         WHERE fondo_id IN (SELECT id FROM _fondos_prueba);
DELETE FROM suscripciones      WHERE fondo_id IN (SELECT id FROM _fondos_prueba)
                                  OR ong_id IN (SELECT id FROM _ongs_prueba);
DELETE FROM fondos             WHERE id IN (SELECT id FROM _fondos_prueba);
DELETE FROM campanas           WHERE ong_id IN (SELECT id FROM _ongs_prueba);
DELETE FROM ong_miembros       WHERE ong_id IN (SELECT id FROM _ongs_prueba)
                                  OR usuario_id IN (SELECT id FROM _usuarios_prueba);
UPDATE ongs SET verificada_por = NULL WHERE verificada_por IN (SELECT id FROM _usuarios_prueba);
DELETE FROM ongs               WHERE id IN (SELECT id FROM _ongs_prueba);

DELETE FROM bitacora_auditoria WHERE usuario_id IN (SELECT id FROM _usuarios_prueba);
DELETE FROM solicitudes_arco   WHERE usuario_id IN (SELECT id FROM _usuarios_prueba)
                                  OR atendido_por IN (SELECT id FROM _usuarios_prueba);
DELETE FROM consentimientos    WHERE usuario_id IN (SELECT id FROM _usuarios_prueba);
DELETE FROM sesiones           WHERE usuario_id IN (SELECT id FROM _usuarios_prueba);
DELETE FROM feedback_donante   WHERE donante_id IN (SELECT id FROM donantes WHERE usuario_id IN (SELECT id FROM _usuarios_prueba));
DELETE FROM donantes           WHERE usuario_id IN (SELECT id FROM _usuarios_prueba);
DELETE FROM usuario_roles      WHERE usuario_id IN (SELECT id FROM _usuarios_prueba)
                                  OR asignado_por IN (SELECT id FROM _usuarios_prueba);
DELETE FROM usuarios           WHERE id IN (SELECT id FROM _usuarios_prueba);

ALTER TABLE movimientos_contables ENABLE TRIGGER tg_movimientos_no_delete;
ALTER TABLE cierres_mensuales ENABLE TRIGGER tg_cierres_no_delete;
ALTER TABLE informes_cierre ENABLE TRIGGER tg_informes_no_delete;

-- Los saldos de los fondos que quedan se recalculan desde el libro, que
-- sigue siendo la unica fuente de verdad, con la misma aritmetica que
-- fn_movimiento_aplicar_saldos.
--
-- Cada suma va con su COALESCE. Sin el, un fondo sin ninguna EJECUCION daba
-- RETENCION - NULL = NULL, y el saldo retenido de un fondo de la demo que
-- todavia no habia gastado nada quedaba en cero: correr esta limpieza
-- descuadraba la base que debia dejar presentable.
UPDATE fondos f SET
  saldo_recaudado = m.recaudado,
  saldo_retenido  = m.retenido,
  saldo_ejecutado = m.ejecutado
FROM (
  SELECT fondo_id,
         COALESCE(SUM(monto) FILTER (WHERE tipo = 'INGRESO'), 0)
           - COALESCE(SUM(monto) FILTER (WHERE tipo = 'COMISION'), 0)
           + COALESCE(SUM(monto) FILTER (WHERE tipo = 'TRASLADO_ENTRADA'), 0)
           - COALESCE(SUM(monto) FILTER (WHERE tipo IN ('DEVOLUCION', 'TRASLADO_SALIDA')), 0)
                                                                            AS recaudado,
         COALESCE(SUM(monto) FILTER (WHERE tipo = 'RETENCION'), 0)
           - COALESCE(SUM(monto) FILTER (WHERE tipo = 'EJECUCION'), 0)
           + COALESCE(SUM(monto) FILTER (WHERE tipo = 'REVERSO'), 0)
           - COALESCE(SUM(monto) FILTER (WHERE tipo = 'REASIGNACION'), 0)   AS retenido,
         COALESCE(SUM(monto) FILTER (WHERE tipo = 'EJECUCION'), 0)
           - COALESCE(SUM(monto) FILTER (WHERE tipo = 'REVERSO'), 0)        AS ejecutado
    FROM movimientos_contables GROUP BY fondo_id
) m
WHERE m.fondo_id = f.id;

COMMIT;
