import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ProblemDetailsFilter } from './common/problem-details.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // 14-api §1: "Base | /api/v1" and "Versioning | URL-versioned".
  app.setGlobalPrefix('api/v1');

  app.useGlobalPipes(
    new ValidationPipe({
      // Strip unknown properties AND reject them. forbidNonWhitelisted matters
      // more than it looks: silently dropping an unrecognised field means a
      // client that misspells `destructiveAllowed` gets a policy that quietly
      // denies destructive testing while they believe they enabled it.
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      // 14-api §1 shows validation failures as 422, not Nest's default 400.
      errorHttpStatusCode: 422,
    }),
  );

  app.useGlobalFilters(new ProblemDetailsFilter());

  // Lets Nest run onModuleDestroy, so PrismaService disconnects cleanly.
  app.enableShutdownHooks();

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
