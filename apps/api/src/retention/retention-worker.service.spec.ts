import { HttpStatus } from '@nestjs/common';
import {
  EvidenceExpiredException,
  RETENTION_BATCH_LIMIT,
  RetentionWorkerService,
} from './retention-worker.service';
import { parseS3Uri } from './retention-object-store.service';

describe('retention-worker bounded deletion', () => {
  it('claims no more than 100 rows through SKIP LOCKED and deletes outside the claim', async () => {
    const { worker, prisma, objects, events } = fixture([candidate('ev_1')]);
    await expect(worker.runBatch(new Date('2026-09-01T00:00:00Z'))).resolves.toEqual({
      claimed: 1,
      tombstoned: 1,
      failed: 0,
    });

    const claimArgs = prisma.$queryRawUnsafe.mock.calls[0];
    expect(claimArgs[0]).toContain('FOR UPDATE OF e SKIP LOCKED');
    expect(claimArgs[0]).toContain('LIMIT $4');
    expect(claimArgs[4]).toBe(RETENTION_BATCH_LIMIT);
    expect(events).toEqual(['claim', 'object-delete', 'tombstone']);
    expect(prisma.evidence.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ artifactUri: null, deletionLeaseId: null }),
      }),
    );
  });

  it('treats an already absent S3 object as successful idempotent deletion', async () => {
    const { worker, objects } = fixture([candidate('ev_missing')]);
    // S3 DeleteObject resolves for an absent key; no preflight existence check.
    objects.deleteArtifact.mockResolvedValue(undefined);
    await expect(worker.runBatch()).resolves.toMatchObject({ tombstoned: 1, failed: 0 });
  });

  it('releases its lease after object-store failure without tombstoning', async () => {
    const { worker, objects, prisma } = fixture([candidate('ev_retry')]);
    objects.deleteArtifact.mockRejectedValue(new Error('temporary S3 outage'));
    await expect(worker.runBatch()).resolves.toEqual({ claimed: 1, tombstoned: 0, failed: 1 });
    expect(prisma.evidence.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ id: 'ev_retry', tombstonedAt: null }),
      data: { deletionLeaseId: null, deletionLeaseExpiresAt: null },
    });
  });

  it('returns the exact 410 exception for tombstoned download/replay access', async () => {
    const { worker, prisma } = fixture([]);
    prisma.evidence.findUnique.mockResolvedValue({ artifactUri: null, tombstonedAt: new Date() });
    await expect(worker.requireLiveArtifact('ev_expired')).rejects.toBeInstanceOf(
      EvidenceExpiredException,
    );
    try {
      await worker.requireLiveArtifact('ev_expired');
    } catch (error) {
      const exception = error as EvidenceExpiredException;
      expect(exception.getStatus()).toBe(HttpStatus.GONE);
      expect(exception.getResponse()).toMatchObject({
        type: 'https://kase.dev/errors/evidence-expired',
        code: 'EVIDENCE_EXPIRED',
        status: 410,
      });
    }
  });

  it('parses content-addressed S3 URIs without losing nested keys', () => {
    expect(parseS3Uri('s3://kase-evidence/prj/aud/hash')).toEqual({
      bucket: 'kase-evidence',
      key: 'prj/aud/hash',
    });
    expect(() => parseS3Uri('https://example.test/object')).toThrow('not an s3 URI');
  });
});

function candidate(id: string) {
  return {
    id,
    projectId: 'prj_1',
    artifactUri: `s3://kase-evidence/prj_1/aud_1/${id}`,
    sha256: 'a'.repeat(64),
  };
}
function fixture(candidates: ReturnType<typeof candidate>[]) {
  const events: string[] = [];
  const prisma = {
    $queryRawUnsafe: jest.fn().mockImplementation(async () => {
      events.push('claim');
      return candidates;
    }),
    evidence: {
      updateMany: jest.fn().mockImplementation(async (args) => {
        events.push(args.data.artifactUri === null ? 'tombstone' : 'lease-release');
        return { count: 1 };
      }),
      findUnique: jest.fn(),
    },
  };
  const objects = {
    deleteArtifact: jest.fn().mockImplementation(async () => {
      events.push('object-delete');
    }),
  };
  const trail = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    worker: new RetentionWorkerService(prisma as never, objects as never, trail as never),
    prisma,
    objects,
    trail,
    events,
  };
}
