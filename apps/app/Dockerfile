# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Aplicación web de Trazabilidad Radical (Flutter Web).
#
# El resultado es un sitio estático: no hay servidor de aplicación, solo
# archivos servidos por nginx. Por eso el despliegue puede ir a Firebase
# Hosting, Netlify o cualquier CDN sin cambiar nada del código.
# ---------------------------------------------------------------------------

FROM debian:bookworm-slim AS build

# La versión se fija a propósito. Flutter Web cambia lo suficiente entre
# versiones como para que "stable" signifique cosas distintas en dos fechas, y
# un entregable que no se puede reconstruir igual no es reproducible.
ARG FLUTTER_VERSION=3.47.4
ARG API_BASE_URL=http://localhost:3000/api/v1

RUN apt-get update \
  && apt-get install -y --no-install-recommends git curl ca-certificates unzip xz-utils \
  && rm -rf /var/lib/apt/lists/*

RUN git clone --depth 1 --branch ${FLUTTER_VERSION} https://github.com/flutter/flutter.git /flutter
ENV PATH="/flutter/bin:/flutter/bin/cache/dart-sdk/bin:${PATH}"
RUN git config --global --add safe.directory /flutter && flutter config --enable-web

WORKDIR /app
COPY pubspec.yaml pubspec.lock ./
RUN flutter pub get

COPY . .
RUN flutter build web --release --dart-define=API_BASE_URL=${API_BASE_URL}


FROM nginx:1.27-alpine AS produccion
COPY --from=build /app/build/web /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
