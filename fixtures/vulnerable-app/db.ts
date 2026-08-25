/**
 * In-memory stand-in for PrismaClient.
 *
 * Deliberately mirrors the Prisma call shape (`findUnique({ where })`,
 * `findFirst({ where })`) so the white-box AST rule in src/sast.ts matches
 * exactly what it would match against a real Prisma codebase. The spike
 * proves the correlation path, not the database layer.
 */

export interface Invoice {
  id: string;
  ownerId: string;
  amountCents: number;
  reference: string;
}

export interface User {
  id: string;
  email: string;
  token: string;
}

const users: User[] = [
  { id: 'user_alice', email: 'alice@example.com', token: 'tok_alice' },
  { id: 'user_bob', email: 'bob@example.com', token: 'tok_bob' },
];

const invoices: Invoice[] = [
  { id: 'inv_1001', ownerId: 'user_alice', amountCents: 480000, reference: 'ACME-2026-0001' },
  { id: 'inv_1002', ownerId: 'user_bob', amountCents: 125000, reference: 'HOOLI-2026-0044' },
];

function matches(row: Record<string, unknown>, where: Record<string, unknown>): boolean {
  return Object.entries(where).every(([key, value]) => row[key] === value);
}

export const prisma = {
  invoice: {
    async findUnique({ where }: { where: Record<string, unknown> }): Promise<Invoice | null> {
      return invoices.find((row) => matches(row as never, where)) ?? null;
    },
    async findFirst({ where }: { where: Record<string, unknown> }): Promise<Invoice | null> {
      return invoices.find((row) => matches(row as never, where)) ?? null;
    },
  },
  user: {
    async findByToken(token: string): Promise<User | null> {
      return users.find((row) => row.token === token) ?? null;
    },
  },
};

export const seed = { users, invoices };
