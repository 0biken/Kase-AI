import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SastWorkerModule } from './worker/sast-worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SastWorkerModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
}

void bootstrap();
