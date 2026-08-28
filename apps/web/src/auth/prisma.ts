import { PrismaClient } from '@prisma/client';

/**
 * Next.js dev-mode hot reload re-evaluates modules on every edit; without
 * stashing the client on globalThis each reload opens a new connection pool
 * until Postgres refuses new connections.
 */
const globalForPrisma = globalThis as unknown as { kasePrisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.kasePrisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.kasePrisma = prisma;
}
