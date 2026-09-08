import { AuditSchedulerService } from './audit-scheduler.service';
import { AuditJobLifecycleService } from './audit-job-lifecycle.service';

describe('orchestrator durable scheduler', () => {
  it('enqueues only dependency-ready work and snapshots identifier-only payload', async () => {
    const jobs = [
      { id: 'prov', auditId: 'aud', kind: 'build_provenance', status: 'succeeded', dependsOn: [], attempts: 1, maxRetries: 2, timeoutMs: 300_000 },
      { id: 'sast', auditId: 'aud', kind: 'semgrep', status: 'queued', dependsOn: ['prov'], attempts: 0, maxRetries: 2, timeoutMs: 600_000, enqueuedAt: null },
      { id: 'norm', auditId: 'aud', kind: 'normalize_severity', status: 'queued', dependsOn: ['sast'], attempts: 0, maxRetries: 2, timeoutMs: 120_000, enqueuedAt: null },
    ];
    const tx = {
      $queryRawUnsafe: jest.fn(),
      audit: { findUnique: jest.fn().mockResolvedValue({ id: 'aud', projectId: 'prj', status: 'running', degradationReasons: [] }) },
      auditJob: { findMany: jest.fn().mockResolvedValue(jobs), update: jest.fn() },
    };
    const prisma: any = { $transaction: jest.fn((fn) => fn(tx)), auditJob: { update: jest.fn() } };
    const queues = { enqueue: jest.fn() };
    const scheduler = new AuditSchedulerService(prisma, queues as never, { reclaimExpired: jest.fn() } as never);
    await scheduler.advance('aud');
    expect(queues.enqueue).toHaveBeenCalledWith('semgrep', {
      auditId: 'aud', auditJobId: 'sast', projectId: 'prj',
    });
    expect(queues.enqueue).toHaveBeenCalledTimes(1);
  });

  it('claims once, increments attempts, and establishes a renewable lease', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn(),
      audit: {
        findFirst: jest.fn().mockResolvedValue({ id: 'aud', projectId: 'prj', status: 'queued', cancellationRequestedAt: null }),
        update: jest.fn(),
      },
      auditJob: {
        findFirst: jest.fn().mockResolvedValue({ id: 'job', status: 'queued', startedAt: null }),
        update: jest.fn().mockImplementation(({ data }) => ({ id: 'job', ...data, attempts: 1 })),
      },
    };
    const prisma: any = { $transaction: jest.fn((fn) => fn(tx)) };
    const lifecycle = new AuditJobLifecycleService(prisma, {} as never, {} as never);
    await lifecycle.claim({ auditId: 'aud', auditJobId: 'job', projectId: 'prj' }, 5_000);
    expect(tx.auditJob.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      status: 'running', attempts: { increment: 1 }, heartbeatAt: expect.any(Date), leaseExpiresAt: expect.any(Date),
    }) }));
    expect(tx.audit.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: 'running' }) }));
  });

  it('reclaims expired leases and advances every non-terminal audit', async () => {
    const prisma: any = {
      auditJob: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'retry', status: 'running', attempts: 2, maxRetries: 2 },
          { id: 'exhausted', status: 'running', attempts: 3, maxRetries: 2 },
        ]),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
      audit: { findMany: jest.fn().mockResolvedValue([{ id: 'a1' }, { id: 'a2' }]) },
    };
    const budgets = { reclaimExpired: jest.fn().mockResolvedValue(1) };
    const scheduler = new AuditSchedulerService(prisma, {} as never, budgets as never);
    jest.spyOn(scheduler, 'advance').mockResolvedValue();
    const now = new Date('2026-01-01T00:00:00Z');
    await scheduler.recover(now);
    expect(budgets.reclaimExpired).toHaveBeenCalledWith(now);
    expect(prisma.auditJob.updateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { id: 'retry', status: 'running', leaseExpiresAt: { lt: now } },
      data: expect.objectContaining({ status: 'queued', leaseExpiresAt: null }),
    }));
    expect(prisma.auditJob.updateMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { id: 'exhausted', status: 'running', leaseExpiresAt: { lt: now } },
      data: expect.objectContaining({ status: 'failed', finishedAt: now }),
    }));
    expect(scheduler.advance).toHaveBeenCalledTimes(2);
  });
});
