import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * The Prisma client, owned by Nest's lifecycle.
 *
 * Connects eagerly in onModuleInit rather than lazily on first query: a bad
 * DATABASE_URL should fail at boot, where it is obvious, not on the first
 * request that happens to touch the database.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({
      datasources: { db: { url: resolveDatabaseUrl() } },
      log: process.env.NODE_ENV === 'production' ? ['warn', 'error'] : ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}

/**
 * DATABASE_URL currently lives in packages/db/.env, which nothing loads into
 * the API process. Rather than silently connecting to a default that happens
 * to be wrong, fail with the actual fix.
 */
export function resolveDatabaseUrl(): string {
  const url = process.env.KASE_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is not set. The API does not read packages/db/.env — export it ' +
        'in your shell or pass --env-file. See apps/api/.env.example.',
    );
  }
  return url;
}
