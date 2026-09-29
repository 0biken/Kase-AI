import { NestFactory } from '@nestjs/core';
import { AgentWorkerModule } from './agent-runtime/agent-worker.module';
import { Logger } from '@nestjs/common';

async function bootstrap() {
  const logger = new Logger('AgentWorker');
  try {
    const app = await NestFactory.createApplicationContext(AgentWorkerModule);
    app.enableShutdownHooks();
    logger.log('Agent worker started successfully');
  } catch (error) {
    logger.error(`Failed to start agent worker: ${error}`);
    process.exit(1);
  }
}

bootstrap();
