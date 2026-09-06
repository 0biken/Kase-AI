import { CancellationSignalRegistry } from './cancellation-signal.registry';

describe('CancellationSignalRegistry', () => {
  it('reacts to the Redis acceleration signal and unregisters cleanly', () => {
    let listener: ((auditId: string) => void) | undefined;
    const bus = { onCancellation: jest.fn((value) => { listener = value; return jest.fn(); }) };
    const prisma = { audit: { findUnique: jest.fn().mockResolvedValue({ cancellationRequestedAt: null, status: 'running' }) } };
    const registry = new CancellationSignalRegistry(prisma as never, bus as never);
    registry.onModuleInit();
    const watch = registry.watch('aud_1', undefined, 60_000);
    listener?.('aud_1');
    expect(watch.signal.aborted).toBe(true);
    watch.close();
    registry.onApplicationShutdown();
  });

  it('uses PostgreSQL as the durable fallback for a missed message', async () => {
    const bus = { onCancellation: jest.fn(() => jest.fn()) };
    const prisma = { audit: { findUnique: jest.fn().mockResolvedValue({ cancellationRequestedAt: new Date(), status: 'running' }) } };
    const registry = new CancellationSignalRegistry(prisma as never, bus as never);
    registry.onModuleInit();
    const watch = registry.watch('aud_1', undefined, 60_000);
    await new Promise((resolve) => setImmediate(resolve));
    expect(watch.signal.aborted).toBe(true);
    watch.close();
  });
});
