import { BudgetService } from './budget.service';

function fixture() {
  const reservations = new Map<string, any>();
  const usage = new Map<string, any>();
  const events: any[] = [];
  const budget: any = {
    auditId: 'audit', totalTokensLimit: 100, totalCallsLimit: 10, contextBytesLimit: 100,
    totalTokensConsumed: 0, totalCallsConsumed: 0, contextBytesConsumed: 0,
    totalTokensReserved: 0, totalCallsReserved: 0,
    bbTokensConsumed: 0, bbCallsConsumed: 0, bbTokensReserved: 0, bbCallsReserved: 0,
    wbTokensConsumed: 0, wbCallsConsumed: 0, wbTokensReserved: 0, wbCallsReserved: 0,
    degradationState: 'green', deadlineAt: null,
  };
  const apply = (record: any, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value && 'increment' in value) record[key] += (value as any).increment;
      else if (typeof value === 'object' && value && 'decrement' in value) record[key] -= (value as any).decrement;
      else record[key] = value;
    }
    return { ...record };
  };
  const tx: any = {
    $queryRawUnsafe: jest.fn(),
    audit: { findUniqueOrThrow: jest.fn().mockResolvedValue({ id: 'audit', status: 'running', cancellationRequestedAt: null }), update: jest.fn().mockImplementation(({ data }) => apply((tx.audit.value ??= { degraded: false, degradationReasons: [] }), data)) },
    auditAiBudget: { findUniqueOrThrow: jest.fn().mockImplementation(async () => ({ ...budget })), update: jest.fn().mockImplementation(async ({ data }) => apply(budget, data)) },
    auditAiSnapshot: { findUniqueOrThrow: jest.fn().mockResolvedValue({ provider: 'openai', modelId: 'pinned', budgetBlackboxTokens: 100, budgetBlackboxCalls: 10, budgetWhiteboxTokens: 100, budgetWhiteboxCalls: 10 }) },
    aiBudgetReservation: {
      findUnique: jest.fn().mockImplementation(async ({ where }) => reservations.get(where.id) ?? null),
      findUniqueOrThrow: jest.fn().mockImplementation(async ({ where }) => reservations.get(where.id)),
      aggregate: jest.fn().mockImplementation(async () => ({ _sum: { contextBytes: [...reservations.values()].filter(row => row.status === 'active').reduce((sum, row) => sum + row.contextBytes, 0) } })),
      create: jest.fn().mockImplementation(async ({ data }) => { reservations.set(data.id, { ...data }); return data; }),
      update: jest.fn().mockImplementation(async ({ where, data }) => apply(reservations.get(where.id), data)),
      findMany: jest.fn().mockImplementation(async ({ where }) => [...reservations.values()].filter(row => row.auditId === where.auditId && row.agentRole === where.agentRole && row.status === where.status)),
    },
    agentRun: { findUnique: jest.fn().mockResolvedValue({ id: 'run' }) },
    aiUsage: { create: jest.fn().mockImplementation(async ({ data }) => { usage.set(data.id, data); return data; }) },
    auditEvent: { findFirst: jest.fn().mockResolvedValue(null), create: jest.fn().mockImplementation(async ({ data }) => { events.push(data); return data; }) },
  };
  const prisma: any = {
    $transaction: jest.fn((work: any) => work(tx)),
    aiBudgetReservation: {
      findUniqueOrThrow: jest.fn(async ({ where }) => reservations.get(where.id)),
      findMany: jest.fn(async ({ where }) => [...reservations.values()].filter(row => row.auditId === where.auditId && row.agentRole === where.agentRole && row.status === where.status)),
    },
  };
  return { budget, reservations, usage, events, tx, service: new BudgetService(prisma, {} as any) };
}

describe('M4 durable budget reservations', () => {
  it('locks one stable reservation, counts outstanding context, and settles usage once', async () => {
    const f = fixture();
    const first = await f.service.reserve('audit', 'blackbox', 0, '1', 30, 20, 20);
    expect(first).toMatchObject({ allowed: true, degradationState: 'yellow' });
    expect(f.budget).toMatchObject({ totalTokensReserved: 50, totalCallsReserved: 1, degradationState: 'yellow' });
    expect(f.tx.audit.value).toMatchObject({ degraded: true });

    const replay = await f.service.reserve('audit', 'blackbox', 0, '1', 30, 20, 20);
    expect(replay).toMatchObject({ reservationId: first.reservationId, allowed: false });
    expect(f.reservations.size).toBe(1);

    await f.service.settle({ reservationId: first.reservationId, actualInput: 20, actualOutput: 10, actualCached: 5 });
    await f.service.settle({ reservationId: first.reservationId, actualInput: 99, actualOutput: 99, actualCached: 0 });
    expect(f.budget).toMatchObject({ totalTokensConsumed: 30, totalTokensReserved: 0, contextBytesConsumed: 0, degradationState: 'yellow' });
    expect(f.usage.size).toBe(1);
  });

  it('denies a request before dispatch when outstanding reservations consume the allowance', async () => {
    const f = fixture();
    f.budget.totalTokensReserved = 90;
    await expect(f.service.reserve('audit', 'whitebox', 0, '1', 1, 10, 11)).resolves.toMatchObject({ allowed: false, degradationState: 'exceeded' });
    expect(f.reservations.size).toBe(0);
  });

  it('conservatively charges active calls during recovery', async () => {
    const f = fixture();
    const reserved = await f.service.reserve('audit', 'whitebox', 1, '2', 8, 12, 8);
    await f.service.recoverRun('audit', 'whitebox');
    expect(f.reservations.get(reserved.reservationId)).toMatchObject({ status: 'expired', settledInput: 8, settledOutput: 12 });
    expect(f.budget).toMatchObject({ totalTokensConsumed: 20, totalTokensReserved: 0, contextBytesConsumed: 0 });
  });
});
