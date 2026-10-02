-- Crea el rol y la base de datos del proyecto.
-- Ejecutar UNA vez como superusuario postgres.
--
-- Copie este archivo a `00-crear-base.sql` --que esta en .gitignore-- y ponga
-- una contraseña propia. La real no se versiona: un repositorio publico con la
-- contraseña de la base dentro deja de protegerla aunque la base sea local.
--
--   cp prisma/sql/00-crear-base.example.sql prisma/sql/00-crear-base.sql
--   psql -U postgres -h localhost -p 5433 -f prisma/sql/00-crear-base.sql
--
-- La misma contraseña va en `DATABASE_URL` dentro de apps/api/.env. Y ojo con
-- el puerto: este proyecto se desarrollo contra PostgreSQL en el 5433, no en
-- el 5432 por defecto.
CREATE ROLE tr_app WITH LOGIN PASSWORD 'ponga-aqui-una-contrasena';
CREATE DATABASE trazabilidad_radical WITH OWNER tr_app ENCODING 'UTF8';
\connect trazabilidad_radical
CREATE EXTENSION IF NOT EXISTS pgcrypto;
GRANT ALL ON SCHEMA public TO tr_app;
