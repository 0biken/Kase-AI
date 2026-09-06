import { firstValueFrom, take, toArray } from 'rxjs';
import { parseLastEventId } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';

describe('audit-events persisted resumable SSE', () => {
  it('allocates an ordered sequence while holding the audit lock', async () => {
    const tx = {
      $queryRawUnsafe: jest.fn(),
      auditEvent: {
        findFirst: jest.fn().mockResolvedValue({ sequence: 7 }),
        create: jest.fn(async ({ data }) => ({ ...data, createdAt: new Date() })),
      },
    };
    const prisma = { $transaction: jest.fn((fn) => fn(tx)) };
    const service = new AuditEventsService(prisma as never);
    const event = await service.append('aud_1', 'job.succeeded', { jobId: 'ajob_1' });
    expect(event.sequence).toBe(8);
    expect(tx.$queryRawUnsafe).toHaveBeenCalledWith(expect.stringContaining('FOR UPDATE'), 'aud_1');
  });

  it('replays only rows after Last-Event-ID in stable order', async () => {
    const rows = [
      { id: 'e3', auditId: 'a', sequence: 3, type: 'job.running', data: {}, createdAt: new Date() },
      { id: 'e4', auditId: 'a', sequence: 4, type: 'finding.created', data: {}, createdAt: new Date() },
    ];
    const prisma = { auditEvent: { findMany: jest.fn().mockResolvedValue(rows) } };
    const service = new AuditEventsService(prisma as never);
    const emitted = await firstValueFrom(service.stream('a', 2, 60_000).pipe(take(2), toArray()));
    expect(emitted.map((event) => event.id)).toEqual(['3', '4']);
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { auditId: 'a', sequence: { gt: 2 } }, orderBy: { sequence: 'asc' },
    }));
  });

  it('parses resumable cursor defensively', () => {
    expect(parseLastEventId('42')).toBe(42);
    expect(parseLastEventId('-1')).toBe(0);
    expect(parseLastEventId('not-a-number')).toBe(0);
  });
});
