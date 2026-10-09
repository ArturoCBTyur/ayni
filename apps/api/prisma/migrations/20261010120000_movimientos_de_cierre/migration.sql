-- D2 del ADR-0007: al cerrar una causa, el remanente de cada donante se le
-- devuelve o se traslada a otro fondo. El libro no tenia como decirlo:
-- REVERSO solo deshace una ejecucion y REASIGNACION deja el dinero en 20.1
-- del mismo fondo, sin salida.
--
-- En su propia migracion: un valor nuevo de un enum no se puede usar dentro
-- de la misma transaccion que lo crea.
ALTER TYPE "TipoMovimiento" ADD VALUE IF NOT EXISTS 'DEVOLUCION';
ALTER TYPE "TipoMovimiento" ADD VALUE IF NOT EXISTS 'TRASLADO_SALIDA';
ALTER TYPE "TipoMovimiento" ADD VALUE IF NOT EXISTS 'TRASLADO_ENTRADA';
