import { AuditCancellationService } from './audit-cancellation.service';

describe('orchestrator cancellation', () => {
  const actor = { type: 'user' as const, id: 'usr_1' };
  let tx: any;
  let prisma: any;
  let queues: any;
  let events: any;
  let trail: any;

  beforeEach(() => {
    const audit = { id: 'aud_1', projectId: 'prj_1', status: 'running', jobs: [
      { id: 'job_wait', kind: 'semgrep', status: 'queued' },
      { id: 'job_run', kind: 'http', status: 'running' },
    ] };
    tx = {
      $queryRawUnsafe: jest.fn(),
      audit: { findUnique: jest.fn().mockResolvedValue(audit), update: jest.fn().mockResolvedValue({ ...audit, status: 'cancelled' }) },
      auditJob: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    };
    prisma = { $transaction: jest.fn((fn) => fn(tx)) };
    queues = { removePending: jest.fn(), publishCancellation: jest.fn(), wakeScheduler: jest.fn() };
    events = { append: jest.fn() };
    trail = { record: jest.fn() };
  });

  it('atomically cancels pending jobs, removes queue work, and signals workers', async () => {
    const service = new AuditCancellationService(prisma, queues, events, trail);
    await service.cancel('aud_1', actor);
    expect(tx.auditJob.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { auditId: 'aud_1', status: { in: ['queued', 'waiting'] } } }));
    expect(queues.removePending).toHaveBeenCalledWith('semgrep', 'job_wait');
    expect(queues.publishCancellation).toHaveBeenCalledWith('aud_1');
    expect(queues.wakeScheduler).toHaveBeenCalledWith({ auditId: 'aud_1', auditJobId: 'job_wait', projectId: 'prj_1' });
    expect(tx.audit.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.not.objectContaining({ status: 'cancelled' }) }));
    expect(events.append).toHaveBeenCalledWith('aud_1', 'audit.cancel', expect.anything());
  });

  it('is idempotent after cancellation and rejects other terminal states', async () => {
    const service = new AuditCancellationService(prisma, queues, events, trail);
    tx.audit.findUnique.mockResolvedValue({ id: 'aud_1', status: 'cancelled', jobs: [] });
    await service.cancel('aud_1', actor);
    expect(queues.publishCancellation).not.toHaveBeenCalled();
    tx.audit.findUnique.mockResolvedValue({ id: 'aud_1', status: 'completed', jobs: [] });
    await expect(service.cancel('aud_1', actor)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('does not duplicate cancellation side effects while a running job is stopping', async () => {
    const service = new AuditCancellationService(prisma, queues, events, trail);
    tx.audit.findUnique.mockResolvedValue({
      id: 'aud_1', projectId: 'prj_1', status: 'running', cancellationRequestedAt: new Date(), jobs: [{ id: 'job_run', status: 'running' }],
    });
    await service.cancel('aud_1', actor);
    expect(queues.publishCancellation).not.toHaveBeenCalled();
    expect(events.append).not.toHaveBeenCalled();
  });
});
