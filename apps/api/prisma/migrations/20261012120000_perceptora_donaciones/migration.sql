-- RF-DE-07 (T6.1): calificacion de la ONG como entidad perceptora de
-- donaciones ante SUNAT. La constancia de donacion depende de este dato.
-- Escrita a mano por la misma razon que las anteriores (campanas.busqueda).
ALTER TABLE "ongs"
  ADD COLUMN "perceptora_donaciones" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "perceptora_resolucion" TEXT,
  ADD COLUMN "perceptora_desde" DATE,
  ADD COLUMN "perceptora_hasta" DATE;

-- Calificada sin la resolucion que lo acredita no es un dato, es una
-- afirmacion; y una vigencia que termina antes de empezar no es vigencia.
ALTER TABLE ongs
  ADD CONSTRAINT ck_ongs_perceptora_acreditada
    CHECK (NOT perceptora_donaciones
           OR (perceptora_resolucion IS NOT NULL AND perceptora_desde IS NOT NULL)),
  ADD CONSTRAINT ck_ongs_perceptora_vigencia
    CHECK (perceptora_hasta IS NULL OR perceptora_desde IS NULL
           OR perceptora_hasta >= perceptora_desde);
