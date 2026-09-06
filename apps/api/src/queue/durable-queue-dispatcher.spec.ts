import { assertIdentifierOnlyPayload, DurableQueueDispatcher } from './durable-queue-dispatcher';

describe('orchestrator identifier-only queue contract', () => {
  it('accepts exactly three identifiers', () => {
    expect(() => assertIdentifierOnlyPayload({ auditId: 'a', auditJobId: 'j', projectId: 'p' })).not.toThrow();
  });
  it('rejects target, URL, credential, and other material', () => {
    expect(() => assertIdentifierOnlyPayload({
      auditId: 'a', auditJobId: 'j', projectId: 'p', targetUrl: 'https://example.test',
    } as never)).toThrow(/only/i);
  });

  it('does not deduplicate scheduler wakes that can race an active advancement', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const dispatcher = new DurableQueueDispatcher({} as never);
    (dispatcher as any).queue = jest.fn().mockReturnValue(queue);
    const payload = { auditId: 'a', auditJobId: 'j', projectId: 'p' };
    await dispatcher.wakeScheduler(payload);
    await dispatcher.wakeScheduler(payload);
    expect(queue.add).toHaveBeenCalledTimes(2);
    expect(queue.add).toHaveBeenCalledWith('advance', payload, expect.not.objectContaining({ jobId: expect.anything() }));
  });
});
