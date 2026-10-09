-- RF-SO-08, D4 del ADR-0007: unidades de impacto opcionales en cada gasto.
-- Escrita a mano por la misma razon que las anteriores (campanas.busqueda).
ALTER TABLE "gastos" ADD COLUMN "unidades_impacto" INTEGER;

-- Cero unidades no es un impacto: es no haberlo declarado.
ALTER TABLE gastos
  ADD CONSTRAINT ck_gastos_unidades_impacto_positivas
    CHECK (unidades_impacto IS NULL OR unidades_impacto > 0);
