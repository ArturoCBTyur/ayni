-- D6 del ADR-0007: una finalidad de consentimiento separada para usar las
-- respuestas de las encuestas (SOC-1, PSI-1).
--
-- En su propia migracion: un valor nuevo de un enum no se puede usar dentro
-- de la misma transaccion que lo crea.
ALTER TYPE "FinalidadConsentimiento" ADD VALUE IF NOT EXISTS 'INVESTIGACION';
