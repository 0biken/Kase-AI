import { OrchestratorService } from './orchestrator.service';

describe('OrchestratorService M1 dispatch', () => {
  const actor = { type: 'token' as const, id: 'tok_1' };
  let prisma: any;
  let queue: { add: jest.Mock };
  let trail: { record: jest.Mock };
  let service: OrchestratorService;

  beforeEach(() => {
    const target = {
      id: 'tgt_1', projectId: 'prj_1', baseUrl: 'http://fixture:3000', authCredentialId: null,
    };
    const audit = { id: 'aud_1', projectId: 'prj_1', status: 'queued', jobs: [] };
    prisma = {
      audit: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue(audit),
        findUniqueOrThrow: jest.fn().mockResolvedValue(audit),
        update: jest.fn(),
      },
      auditJob: { create: jest.fn(), update: jest.fn() },
      target: { findFirst: jest.fn().mockResolvedValue(target) },
      scopePolicy: {
        findFirst: jest.fn().mockResolvedValue({ allowedHosts: ['fixture'], authorizationAttestedAt: new Date() }),
      },
      secret: { count: jest.fn().mockResolvedValue(1) },
      $transaction: jest.fn(async (value) =>
        typeof value === 'function' ? value(prisma) : Promise.all(value)),
    };
    queue = { add: jest.fn().mockResolvedValue({ id: 'ajob_1' }) };
    trail = { record: jest.fn().mockResolvedValue(undefined) };
    service = new OrchestratorService(prisma, trail as never, queue as never);
  });

  it('queues identifiers only, with no URL or credential material', async () => {
    await service.dispatch(
      'prj_1',
      { targetId: 'tgt_1', mode: 'smoke', category: 'fixture_health' },
      'request-1',
      actor,
    );
    const payload = queue.add.mock.calls[0][1];
    expect(Object.keys(payload).sort()).toEqual(['auditId', 'auditJobId', 'projectId']);
    expect(JSON.stringify(payload)).not.toContain('fixture');
    expect(JSON.stringify(payload).toLowerCase()).not.toContain('credential');
  });

  it('returns the existing audit for a repeated idempotency key', async () => {
    const existing = { id: 'aud_existing', jobs: [{ id: 'ajob_existing' }] };
    prisma.audit.findFirst.mockResolvedValue(existing);
    await expect(service.dispatch(
      'prj_1',
      { targetId: 'tgt_1', mode: 'smoke', category: 'fixture_health' },
      'same-key',
      actor,
    )).resolves.toBe(existing);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('fails before persistence when the target host is not allowlisted', async () => {
    prisma.scopePolicy.findFirst.mockResolvedValue({
      allowedHosts: ['staging.example.com'], authorizationAttestedAt: new Date(),
    });
    await expect(service.dispatch(
      'prj_1',
      { targetId: 'tgt_1', mode: 'smoke', category: 'fixture_health' },
      'request-2',
      actor,
    )).rejects.toMatchObject({ code: 'SCOPE_VIOLATION' });
    expect(prisma.audit.create).not.toHaveBeenCalled();
    expect(trail.record).toHaveBeenCalledWith(expect.objectContaining({
      action: 'scope.denied', outcome: 'denied',
    }));
  });

  it('requires an idempotency key', async () => {
    await expect(service.dispatch(
      'prj_1',
      { targetId: 'tgt_1', mode: 'smoke', category: 'fixture_health' },
      '',
      actor,
    )).rejects.toMatchObject({ code: 'IDEMPOTENCY_KEY_REQUIRED' });
  });
});
