import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { RetentionWorkerModule } from './retention/retention-worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(RetentionWorkerModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
}

void bootstrap();
