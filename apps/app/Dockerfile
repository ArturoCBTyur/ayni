# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Aplicación web de Trazabilidad Radical (Flutter Web).
#
# El resultado es un sitio estático: no hay servidor de aplicación, solo
# archivos servidos por nginx. Por eso el despliegue puede ir a Firebase
# Hosting, Netlify o cualquier CDN sin cambiar nada del código.
# ---------------------------------------------------------------------------

# El SDK va en su propia etapa para poder usarlo sin compilar la aplicación:
# `docker build --target sdk` deja una imagen con la versión exacta de Flutter
# con la que correr `flutter analyze` y `flutter test` en una máquina que tenga
# otra versión instalada, o ninguna.
FROM debian:bookworm-slim AS sdk

# La versión se fija a propósito. Flutter Web cambia lo suficiente entre
# versiones como para que "stable" signifique cosas distintas en dos fechas, y
# un entregable que no se puede reconstruir igual no es reproducible.
ARG FLUTTER_VERSION=3.47.4

RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates unzip xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git /flutter
ENV PATH="/flutter/bin:/flutter/bin/cache/dart-sdk/bin:${PATH}"
RUN git config --global --add safe.directory /flutter \
  && flutter config --enable-web --no-analytics \
  && flutter precache --web


FROM sdk AS build
ARG API_BASE_URL=http://localhost:3000/api/v1

WORKDIR /app
# pubspec.lock se versiona: es una aplicación, no un paquete, y sin el archivo
# cada construcción resolvería las dependencias del día en que se construye.
COPY pubspec.yaml pubspec.lock ./
RUN flutter pub get --enforce-lockfile

COPY . .
RUN flutter build web --release --dart-define=API_BASE_URL=${API_BASE_URL}


FROM nginx:1.27-alpine AS produccion
COPY --from=build /app/build/web /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
