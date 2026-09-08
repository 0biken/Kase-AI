import { ReconBudgetService } from './recon-budget.service';

describe('ReconBudgetService', () => {
  it('caps a durable stage reservation, settles it, and reuses the same identity after recovery', async () => {
    const row = { auditId: 'aud_1', maxRequests: 100, reconLimit: 40, reserved: 0, consumed: 0 };
    let reservation: any;
    const tx: any = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([]),
      reconRequestBudget: {
        findUniqueOrThrow: jest.fn(() => ({ ...row })),
        update: jest.fn(({ data }) => {
          row.reserved += data.reserved?.increment ?? -(data.reserved?.decrement ?? 0);
          row.consumed += data.consumed?.increment ?? 0;
        }),
      },
      reconRequestReservation: {
        findUnique: jest.fn(() => reservation),
        findUniqueOrThrow: jest.fn(() => reservation),
        upsert: jest.fn(({ create, update }) => { reservation = reservation ? { ...reservation, ...update } : { ...create }; }),
        update: jest.fn(({ data }) => { reservation = { ...reservation, ...data }; }),
        updateMany: jest.fn(),
      },
    };
    const prisma: any = { $transaction: jest.fn((callback) => callback(tx)), reconRequestReservation: { updateMany: jest.fn() } };
    const service = new ReconBudgetService(prisma);
    const lease = new Date(Date.now() + 60_000);
    const first = await service.reserve({ auditId: 'aud_1', auditJobId: 'job_1', stage: 'katana', requested: 500, leaseExpiresAt: lease });
    expect(first.granted).toBe(40);
    expect(row.reserved).toBe(40);
    await service.settle(first, 12);
    expect(row).toMatchObject({ reserved: 0, consumed: 12 });
    expect(reservation).toMatchObject({ status: 'settled', consumedCount: 12 });
    const retry = await service.reserve({ auditId: 'aud_1', auditJobId: 'job_1', stage: 'katana', requested: 100, leaseExpiresAt: lease });
    expect(retry.id).toBe(first.id);
    expect(retry.granted).toBe(28);
  });

  it('reclaims expired active reservations before the scheduler requeues their job', async () => {
    const tx: any = {
      $queryRawUnsafe: jest.fn().mockResolvedValue([{ id: 'rr_1', auditId: 'aud_1', reservedCount: 10 }]),
      reconRequestBudget: { update: jest.fn() },
      reconRequestReservation: { update: jest.fn(), updateMany: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((callback) => callback(tx)), reconRequestReservation: { updateMany: jest.fn() } };
    const now = new Date('2026-09-08T00:00:00Z');
    await expect(new ReconBudgetService(prisma).reclaimExpired(now)).resolves.toBe(1);
    expect(tx.reconRequestBudget.update).toHaveBeenCalledWith({ where: { auditId: 'aud_1' }, data: { reserved: { decrement: 10 }, consumed: { increment: 10 } } });
    expect(tx.reconRequestReservation.update).toHaveBeenCalledWith({ where: { id: 'rr_1' }, data: { status: 'reclaimed', consumedCount: 10, leaseExpiresAt: now } });
  });
});
