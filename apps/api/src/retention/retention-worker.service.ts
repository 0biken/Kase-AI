import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { RetentionObjectStoreService } from './retention-object-store.service';

export const RETENTION_BATCH_LIMIT = 100;
export const RETENTION_LEASE_MS = 5 * 60 * 1000;

interface RetentionCandidate {
  id: string;
  projectId: string;
  artifactUri: string;
  sha256: string;
}

/** Carries the exact 410 contract; the shared filter needs EVIDENCE_EXPIRED
 * added by the integration owner so it preserves this code end-to-end. */
export class EvidenceExpiredException extends HttpException {
  constructor() {
    super(
      {
        type: 'https://kase.dev/errors/evidence-expired',
        title: 'Evidence artifact expired',
        status: HttpStatus.GONE,
        detail: 'The retained metadata is available, but the artifact bytes were deleted by policy.',
        code: 'EVIDENCE_EXPIRED',
      },
      HttpStatus.GONE,
    );
  }
}

@Injectable()
export class RetentionWorkerService {
  private readonly logger = new Logger(RetentionWorkerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly objects: RetentionObjectStoreService,
    private readonly trail: AuditTrailService,
  ) {}

  /**
   * Claims at most 100 rows in one short statement. Object I/O happens only
   * after PostgreSQL row locks have been released.
   */
  async runBatch(now = new Date()): Promise<{ claimed: number; tombstoned: number; failed: number }> {
    const leaseId = randomUUID();
    const leaseExpiresAt = new Date(now.getTime() + RETENTION_LEASE_MS);
    const candidates = await this.prisma.$queryRawUnsafe<RetentionCandidate[]>(
      CLAIM_SQL,
      now,
      leaseId,
      leaseExpiresAt,
      RETENTION_BATCH_LIMIT,
    );

    let tombstoned = 0;
    let failed = 0;
    for (const candidate of candidates) {
      try {
        await this.objects.deleteArtifact(candidate.artifactUri);
        const deletedAt = new Date();
        const result = await this.prisma.evidence.updateMany({
          where: { id: candidate.id, deletionLeaseId: leaseId, tombstonedAt: null },
          data: {
            artifactUri: null,
            objectDeletedAt: deletedAt,
            tombstonedAt: deletedAt,
            deletionLeaseId: null,
            deletionLeaseExpiresAt: null,
          },
        });
        if (result.count === 1) {
          tombstoned += 1;
          await this.trail.record({
            projectId: candidate.projectId,
            actorType: 'system',
            action: 'evidence.delete',
            resourceType: 'Evidence',
            resourceId: candidate.id,
            metadata: { sha256: candidate.sha256, reason: 'retention_expired' },
            outcome: 'allowed',
          });
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(`Retention delete failed for ${candidate.id}: ${String(error)}`);
        await this.prisma.evidence.updateMany({
          where: { id: candidate.id, deletionLeaseId: leaseId, tombstonedAt: null },
          data: { deletionLeaseId: null, deletionLeaseExpiresAt: null },
        });
      }
    }
    return { claimed: candidates.length, tombstoned, failed };
  }

  async requireLiveArtifact(evidenceId: string): Promise<{ artifactUri: string }> {
    const evidence = await this.prisma.evidence.findUnique({
      where: { id: evidenceId },
      select: { artifactUri: true, tombstonedAt: true },
    });
    if (!evidence) throw new HttpException('Evidence not found', HttpStatus.NOT_FOUND);
    if (evidence.tombstonedAt || !evidence.artifactUri) throw new EvidenceExpiredException();
    return { artifactUri: evidence.artifactUri };
  }
}

// The CTE locks only the selected Evidence rows, sets a lease, and commits.
// Concurrent workers skip those rows. Expired leases are reclaimable after a
// worker crash. LIMIT is a bound parameter capped by the service constant.
const CLAIM_SQL = `
WITH candidates AS (
  SELECT e."id", a."projectId"
  FROM "Evidence" e
  JOIN "Audit" a ON a."id" = e."auditId"
  WHERE e."tombstonedAt" IS NULL
    AND e."artifactUri" IS NOT NULL
    AND e."expiresAt" <= $1
    AND (e."deletionLeaseExpiresAt" IS NULL OR e."deletionLeaseExpiresAt" <= $1)
  ORDER BY e."expiresAt", e."id"
  LIMIT $4
  FOR UPDATE OF e SKIP LOCKED
)
UPDATE "Evidence" e
SET "deletionLeaseId" = $2, "deletionLeaseExpiresAt" = $3
FROM candidates c
WHERE e."id" = c."id"
RETURNING e."id", c."projectId", e."artifactUri", e."sha256"`;
