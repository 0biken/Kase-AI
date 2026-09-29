import { AuditJobLifecycleService } from './audit-job-lifecycle.service';

describe('AuditJobLifecycleService', () => {
  const payload = { auditId: 'aud_1', auditJobId: 'job_1', projectId: 'prj_1' };

  it('keeps lease generations monotonic across child suspensions', async () => {
    const tx: any = { $queryRawUnsafe: jest.fn(), auditJob: {
      findFirst: jest.fn().mockResolvedValue({ id: 'child' }),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    } };
    const db: any = { $transaction: async fn => fn(tx) };
    const lifecycle = new AuditJobLifecycleService(db, { wakeScheduler: jest.fn() } as any, {} as any);
    await lifecycle.waitForChild(payload, 'child', 7);
    const update = tx.auditJob.updateMany.mock.calls[0][0];
    expect(update.where.attempts).toBe(7);
    expect(update.data).toMatchObject({ status: 'waiting', continuations: { increment: 1 } });
    expect(update.data).not.toHaveProperty('attempts');
  });

  it('does not spend the failure retry allowance on successful continuations', async () => {
    const db: any = {
      auditJob: { findFirst: async () => ({ id: 'job_1', status: 'running', attempts: 8, continuations: 7, maxRetries: 1, timeoutMs: 60000 }), updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
    };
    const lifecycle = new AuditJobLifecycleService(db, {} as any, {} as any);
    await lifecycle.fail(payload, new Error('temporary transport failure'), 8);
    expect(db.auditJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'job_1', status: 'running', attempts: 8 }, data: expect.objectContaining({ status: 'queued' }) }));
  });

  it('does not execute an adapter again when a stale queue delivery finds a succeeded job', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn(),
      audit: { findFirst: jest.fn().mockResolvedValue({ id: 'aud_1', projectId: 'prj_1', status: 'running' }) },
      auditJob: { findFirst: jest.fn().mockResolvedValue({ id: 'job_1', status: 'succeeded' }), update: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((work) => work(tx)) };
    const lifecycle = new AuditJobLifecycleService(prisma, {} as never, {} as never);
    await expect(lifecycle.claim(payload)).resolves.toBeNull();
    expect(tx.auditJob.update).not.toHaveBeenCalled();
  });

  it('does not emit a completed status when cancellation wins the smoke completion race', async () => {
    const prisma: any = {
      auditJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      audit: {
        findUnique: jest.fn().mockResolvedValue({ mode: 'smoke' }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    };
    const events = { append: jest.fn() };
    const lifecycle = new AuditJobLifecycleService(prisma, {} as never, events as never);
    await lifecycle.succeed(payload);
    expect(events.append).toHaveBeenCalledWith('aud_1', 'job.succeeded', { jobId: 'job_1' });
    expect(events.append).not.toHaveBeenCalledWith('aud_1', 'audit.status', expect.anything());
  });

  it('fences stale attempts from renewing or completing a newer retry', async () => {
    const prisma: any = {
      auditJob: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
      audit: { findUnique: jest.fn().mockResolvedValue({ mode: 'full' }) },
    };
    const lifecycle = new AuditJobLifecycleService(prisma, { wakeScheduler: jest.fn() } as never, { append: jest.fn() } as never);
    await expect(lifecycle.heartbeat('job_1', 60_000, 1)).resolves.toBe(false);
    await lifecycle.succeed(payload, 1);
    expect(prisma.auditJob.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({ where: { id: 'job_1', status: 'running', attempts: 1 } }));
    expect(prisma.auditJob.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({ where: { id: 'job_1', auditId: 'aud_1', status: 'running', attempts: 1 } }));
  });

  it('re-enqueues a transient smoke retry without requiring the M2 scheduler', async () => {
    jest.useFakeTimers();
    try {
      const prisma: any = {
        auditJob: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'job_1', kind: 'recon', status: 'running', attempts: 1, maxRetries: 2, timeoutMs: 600_000,
          }),
          updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        },
        audit: { findUnique: jest.fn().mockResolvedValue({ mode: 'smoke' }) },
      };
      const queues = { enqueue: jest.fn().mockResolvedValue(undefined), wakeScheduler: jest.fn() };
      const events = { append: jest.fn().mockResolvedValue(undefined) };
      const lifecycle = new AuditJobLifecycleService(prisma, queues as never, events as never);
      await lifecycle.fail(payload, new Error('temporary network error'));
      expect(queues.wakeScheduler).not.toHaveBeenCalled();
      await jest.advanceTimersByTimeAsync(1_000);
      expect(queues.enqueue).toHaveBeenCalledWith('recon', payload);
    } finally {
      jest.useRealTimers();
    }
  });

  it('does not let a stale failure overwrite a newer attempt', async () => {
    const prisma: any = {
      auditJob: {
        findFirst: jest.fn().mockResolvedValue({ id: 'job_1', kind: 'katana_discover', status: 'running', attempts: 1, maxRetries: 2, timeoutMs: 600_000 }),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      audit: { findUnique: jest.fn().mockResolvedValue({ mode: 'full' }) },
    };
    const queues = { wakeScheduler: jest.fn() };
    const events = { append: jest.fn() };
    const lifecycle = new AuditJobLifecycleService(prisma, queues as never, events as never);

    await lifecycle.fail(payload, new Error('temporary network error'), 1);

    expect(prisma.auditJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'job_1', status: 'running', attempts: 1 },
    }));
    expect(events.append).not.toHaveBeenCalled();
    expect(queues.wakeScheduler).not.toHaveBeenCalled();
  });
});
