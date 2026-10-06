# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# API de Trazabilidad Radical.
#
# Se usa la imagen Debian slim y no Alpine: sharp y @node-rs/argon2 traen
# binarios precompilados contra glibc, y en Alpine (musl) o no hay binario o
# hay que compilarlo. El ahorro de tamaño no compensa una imagen que a veces
# construye y a veces no.
# ---------------------------------------------------------------------------

FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
# Sin scripts en esta capa: lo unico que se necesita aqui es el arbol de
# dependencias. Los binarios nativos se resuelven en la capa de produccion.
RUN npm ci


FROM node:22-bookworm-slim AS build
WORKDIR /app

# Prisma elige el motor de consultas segun la version de OpenSSL que detecta al
# generar el cliente. Sin openssl en esta etapa no detecta ninguna, genera para
# openssl-1.1.x, y la etapa de produccion -que trae OpenSSL 3- no lo puede
# cargar: la API se caia al arrancar ("Prisma Client was generated for
# debian-openssl-1.1.x, but the actual deployment required
# debian-openssl-3.0.x"). Las migraciones corren sobre esta etapa y lo
# necesitan igual.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY --from=deps /app/node_modules ./node_modules
COPY . .
# El cliente de Prisma se genera desde el esquema; sin esto, el build de
# TypeScript no encuentra los tipos.
RUN npx prisma generate && npm run build


FROM node:22-bookworm-slim AS produccion
ENV NODE_ENV=production
WORKDIR /app

# openssl lo necesita el motor de consultas de Prisma.
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/node_modules/@prisma ./node_modules/@prisma
# El esquema y las migraciones viajan con la imagen para poder aplicar
# `prisma migrate deploy` desde el mismo contenedor que corre la API.
COPY prisma ./prisma

# Usuario sin privilegios: la imagen de Node ya trae `node`.
RUN mkdir -p /app/storage && chown -R node:node /app/storage
USER node

EXPOSE 3000

# Las migraciones NO se aplican al arrancar. Un contenedor que migra al
# levantarse convierte cada reinicio y cada replica en una carrera sobre el
# esquema, y sobre un libro contable eso no es aceptable. Se aplican como paso
# explicito del despliegue: `npx prisma migrate deploy`.
CMD ["node", "dist/main.js"]
