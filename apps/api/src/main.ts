import 'reflect-metadata';

import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import { writeFileSync } from 'node:fs';

import { AppModule } from './app.module';
import type { Configuracion } from './config/configuracion';

async function arrancar(): Promise<void> {
  // rawBody: la firma del webhook se verifica sobre el cuerpo exacto que
  // envio la pasarela. Volver a serializar el JSON parseado cambiaria el
  // orden de las claves o el formato de los numeros y la firma no cuadraria.
  const app = await NestFactory.create(AppModule, { bufferLogs: true, rawBody: true });
  const config = app.get(ConfigService<Configuracion, true>);
  const logger = new Logger('Arranque');

  // RNF-03: cabeceras de seguridad.
  app.use(helmet());
  // El refresh token viaja en cookie httpOnly firmada (RNF-02).
  app.use(cookieParser(config.get('COOKIE_SECRET', { infer: true })));

  // Las subidas llegan como binario crudo a las URLs firmadas, no como
  // multipart: es lo que hace un PUT contra una URL prefirmada de S3.
  app.use(
    express.raw({ type: ['image/*', 'application/pdf', 'video/*', 'application/octet-stream'], limit: '25mb' }),
  );

  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }));

  const origenes = config.get('corsOrigenes', { infer: true });
  // Un comodin con credentials:true deja que cualquier sitio haga peticiones
  // autenticadas con la cookie de la victima. Los navegadores lo prohiben,
  // pero un cliente que no sea un navegador no, y el error seria silencioso.
  if (origenes.includes('*')) {
    throw new Error(
      'CORS_ORIGENES no puede contener "*": la API envia credenciales y un ' +
        'comodin permitiria que cualquier origen las use. Liste los origenes.',
    );
  }
  app.enableCors({ origin: origenes, credentials: true });

  // La validacion de entrada se hace con ZodPipe por ruta (ver
  // src/comun/validacion/zod.pipe.ts). No se registra el ValidationPipe de
  // NestJS porque depende de class-validator y de DTO decorados, y el
  // proyecto ya usa Zod para la configuracion y los contratos.

  // RF-IN-04: API documentada con OpenAPI para integraciones futuras.
  //
  // El documento se genera siempre, porque el archivo de docs/ forma parte del
  // entregable, pero la interfaz interactiva no se publica en produccion:
  // enumera cada ruta, cada parametro y cada esquema, que es el mapa que un
  // atacante armaria a mano.
  const esProduccion = config.get('NODE_ENV', { infer: true }) === 'production';
  const documento = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Ayni API')
      .setDescription(
        'Micro-mecenazgo dirigido con trazabilidad total. MVP v1 sin IA: ' +
          'la verificacion la produce el Motor de Reglas v0, que respeta el ' +
          'mismo contrato de datos que AIni.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  if (!esProduccion) SwaggerModule.setup('docs', app, documento);

  if (config.get('NODE_ENV', { infer: true }) === 'development') {
    writeFileSync('../../docs/openapi.json', JSON.stringify(documento, null, 2));
  }

  app.enableShutdownHooks();

  const puerto = config.get('PORT', { infer: true });
  await app.listen(puerto);

  logger.log(`API escuchando en http://localhost:${puerto}`);
  if (!esProduccion) logger.log(`OpenAPI en http://localhost:${puerto}/docs`);
  logger.log(`Motor de verificacion: ${config.get('VERIFICACION_DRIVER', { infer: true })}`);
}

void arrancar();
