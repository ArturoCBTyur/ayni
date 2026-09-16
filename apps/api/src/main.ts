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
  app.enableCors({
    origin: config.get('corsOrigenes', { infer: true }),
    credentials: true,
  });

  // La validacion de entrada se hace con ZodPipe por ruta (ver
  // src/comun/validacion/zod.pipe.ts). No se registra el ValidationPipe de
  // NestJS porque depende de class-validator y de DTO decorados, y el
  // proyecto ya usa Zod para la configuracion y los contratos.

  // RF-IN-04: API documentada con OpenAPI para integraciones futuras.
  const documento = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('Trazabilidad Radical API')
      .setDescription(
        'Micro-mecenazgo dirigido con trazabilidad total. MVP v1 sin IA: ' +
          'la verificacion la produce el Motor de Reglas v0, que respeta el ' +
          'mismo contrato de datos que AIni.',
      )
      .setVersion('0.1.0')
      .addBearerAuth()
      .build(),
  );
  SwaggerModule.setup('docs', app, documento);

  if (config.get('NODE_ENV', { infer: true }) === 'development') {
    writeFileSync('../../docs/openapi.json', JSON.stringify(documento, null, 2));
  }

  app.enableShutdownHooks();

  const puerto = config.get('PORT', { infer: true });
  await app.listen(puerto);

  logger.log(`API escuchando en http://localhost:${puerto}`);
  logger.log(`OpenAPI en http://localhost:${puerto}/docs`);
  logger.log(`Motor de verificacion: ${config.get('VERIFICACION_DRIVER', { infer: true })}`);
}

void arrancar();
