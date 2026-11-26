import { createHash } from 'crypto';
import type { NormalizedSastFinding } from './sast-normalizer';
import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/** Minimal structural contract keeps this domain service independently testable. */
export interface FindingPrisma {
  findingIdentity: { upsert(args: unknown): Promise<{ id: string }>; update(args: unknown): Promise<unknown> };
  finding: { findUnique(args: unknown): Promise<{ id: string } | null>; upsert(args: unknown): Promise<{ id: string }> };
  sourceLocation: { upsert(args: unknown): Promise<unknown> };
  findingEvidence: { upsert(args: unknown): Promise<unknown> };
}

export type FindingOccurrenceDb = Pick<FindingPrisma, 'findingIdentity' | 'finding'>;

/**
 * Upserts the project-scoped identity and this audit's occurrence of it. The
 * identity's `occurrences` counter is incremented only when this audit's
 * finding row is new, so retries and re-imports never double count. `create`
 * holds the finding columns beyond id/auditId/identityId.
 */
export async function upsertFindingOccurrence(db: FindingOccurrenceDb, input: {
  projectId: string; auditId: string; fingerprint: string; severity: string;
  create: Record<string, unknown>; update?: Record<string, unknown>;
}): Promise<{ identityId: string; findingId: string; created: boolean }> {
  const { projectId, auditId, fingerprint, severity } = input;
  const identity = await db.findingIdentity.upsert({
    where: { projectId_fingerprint: { projectId, fingerprint } },
    create: { id: deterministicId('findingIdentity', `${projectId}:${fingerprint}`), projectId, fingerprint, status: 'new',
      firstSeenAuditId: auditId, lastSeenAuditId: auditId, occurrences: 0, currentSeverity: severity },
    update: { lastSeenAuditId: auditId, currentSeverity: severity },
  });
  const findingId = deterministicId('finding', `${auditId}:${identity.id}`);
  const existingOccurrence = await db.finding.findUnique({ where: { auditId_identityId: { auditId, identityId: identity.id } } });
  await db.finding.upsert({
    where: { auditId_identityId: { auditId, identityId: identity.id } },
    create: { id: findingId, auditId, identityId: identity.id, ...input.create },
    update: input.update ?? {},
  });
  if (!existingOccurrence) await db.findingIdentity.update({ where: { id: identity.id }, data: { occurrences: { increment: 1 } } });
  return { identityId: identity.id, findingId, created: !existingOccurrence };
}

@Injectable()
export class FindingPersistenceService {
  constructor(@Inject(PrismaService) private readonly db: FindingPrisma) {}

  async persist(projectId: string, auditId: string, evidenceId: string, finding: NormalizedSastFinding) {
    const { identityId, findingId } = await upsertFindingOccurrence(this.db, {
      projectId, auditId, fingerprint: finding.fingerprint, severity: finding.severity,
      create: { origin: 'tool', category: finding.category,
        ruleId: finding.ruleId, cwe: finding.cwe, title: finding.title, severity: finding.severity,
        severitySource: finding.severitySource, affectedTarget: finding.affectedTarget, description: finding.description,
        reproduction: { kind: 'source_location' }, impact: 'Unauthorized access to another principal\'s object may be possible.',
        rootCause: 'Object lookup lacks an ownership predicate.', fix: 'Include the authenticated owner identifier in the database predicate.',
        confidenceBand: finding.confidenceBand, aiGenerated: false, gateEligible: finding.gateEligible },
      update: { severity: finding.severity, severitySource: finding.severitySource, description: finding.description },
    });
    const locationId = deterministicId('sourceLocation', `${findingId}:${finding.sourceLocation.file}:${finding.sourceLocation.line}`);
    await this.db.sourceLocation.upsert({ where: { id: locationId }, create: { id: locationId, findingId, ...finding.sourceLocation }, update: finding.sourceLocation });
    await this.db.findingEvidence.upsert({ where: { findingId_evidenceId: { findingId, evidenceId } },
      create: { findingId, evidenceId, role: 'primary' }, update: { role: 'primary' } });
    return { identityId, findingId };
  }
}

export function deterministicId(kind: string, material: string): string {
  return `${kind}_${createHash('sha256').update(material).digest('hex').slice(0, 26)}`;
}
