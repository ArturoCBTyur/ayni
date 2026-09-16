-- Defaults para las columnas que asigna el trigger de encadenamiento.
--
-- La secuencia y el hash de cada movimiento los calcula
-- tg_movimientos_encadenar en BEFORE INSERT. Sin un default, Prisma obliga a
-- la aplicacion a enviar ambos valores, que el trigger va a descartar: eso
-- invita a que alguien crea que puede elegirlos.
--
-- Con estos defaults, el codigo inserta un movimiento sin conocer los
-- internos de la cadena y los valores enviados siguen siendo irrelevantes.
--
-- Escrita a mano y no por `migrate diff`: el diff intentaba ademas eliminar
-- la columna generada `campanas.busqueda` y su indice GIN, que Prisma no
-- modela. Ambos ya estan declarados en el esquema para evitar ese drift.

ALTER TABLE "movimientos_contables"
  ALTER COLUMN "secuencia" SET DEFAULT 0,
  ALTER COLUMN "hash_actual" SET DEFAULT '';
