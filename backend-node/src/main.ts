import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api');

  // Capturas y reportes que dejan los runners de Playwright. Tiene que apuntar
  // al mismo directorio fisico donde escriben los scripts: la raiz del repo,
  // un nivel arriba de backend-node (ver outputDir en scripts/run-qa-*.mjs).
  app.useStaticAssets(join(__dirname, '..', '..', 'outputs'), {
    prefix: '/api/outputs/',
  });

  app.enableCors({ origin: true, credentials: true });
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  await app.listen(Number(process.env.PORT ?? 8001));
}

void bootstrap();
