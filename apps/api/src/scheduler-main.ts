import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SchedulerModule } from './orchestrator/scheduler.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SchedulerModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
}

void bootstrap();
