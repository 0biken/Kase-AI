import { ReconBudgetService } from './recon-budget.service';

describe('ReconBudgetService', () => {
  it('atomically caps reservations and settles only within the durable limit', async () => {
    const row = { auditId: 'aud_1', maxRequests: 100, reconLimit: 40, reserved: 0, consumed: 0 };
    const tx: any = {
      $queryRawUnsafe: jest.fn(),
      reconRequestBudget: {
        findUniqueOrThrow: jest.fn(() => ({ ...row })),
        update: jest.fn(({ data }) => {
          row.reserved += data.reserved?.increment ?? -(data.reserved?.decrement ?? 0);
          row.consumed += data.consumed?.increment ?? 0;
        }),
      },
    };
    const prisma: any = { $transaction: jest.fn((callback) => callback(tx)) };
    const service = new ReconBudgetService(prisma);
    await expect(service.reserve('aud_1', 500)).resolves.toBe(40);
    expect(row.reserved).toBe(40);
    await service.settle('aud_1', 40, 12);
    expect(row).toMatchObject({ reserved: 0, consumed: 12 });
    await expect(service.reserve('aud_1', 100)).resolves.toBe(28);
    await expect(service.settle('aud_1', 28, 29)).rejects.toThrow(/fit the reservation/u);
  });
});
