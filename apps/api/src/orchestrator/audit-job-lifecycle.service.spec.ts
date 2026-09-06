import { AuditJobLifecycleService } from './audit-job-lifecycle.service';

describe('AuditJobLifecycleService', () => {
  const payload = { auditId: 'aud_1', auditJobId: 'job_1', projectId: 'prj_1' };

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

  it('re-enqueues a transient smoke retry without requiring the M2 scheduler', async () => {
    jest.useFakeTimers();
    try {
      const prisma: any = {
        auditJob: {
          findFirst: jest.fn().mockResolvedValue({
            id: 'job_1', kind: 'recon', status: 'running', attempts: 1, maxRetries: 2, timeoutMs: 600_000,
          }),
          update: jest.fn().mockResolvedValue(undefined),
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
});
