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

@Injectable()
export class FindingPersistenceService {
  constructor(@Inject(PrismaService) private readonly db: FindingPrisma) {}

  async persist(projectId: string, auditId: string, evidenceId: string, finding: NormalizedSastFinding) {
    const identityId = deterministicId('findingIdentity', `${projectId}:${finding.fingerprint}`);
    const identity = await this.db.findingIdentity.upsert({
      where: { projectId_fingerprint: { projectId, fingerprint: finding.fingerprint } },
      create: { id: identityId, projectId, fingerprint: finding.fingerprint, status: 'new', firstSeenAuditId: auditId,
        lastSeenAuditId: auditId, occurrences: 0, currentSeverity: finding.severity },
      update: { lastSeenAuditId: auditId, currentSeverity: finding.severity },
    });
    const findingId = deterministicId('finding', `${auditId}:${identity.id}`);
    const existingOccurrence = await this.db.finding.findUnique({ where: { auditId_identityId: { auditId, identityId: identity.id } } });
    await this.db.finding.upsert({
      where: { auditId_identityId: { auditId, identityId: identity.id } },
      create: { id: findingId, auditId, identityId: identity.id, origin: 'tool', category: finding.category,
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
    if (!existingOccurrence) await this.db.findingIdentity.update({ where: { id: identity.id }, data: { occurrences: { increment: 1 } } });
    return { identityId: identity.id, findingId };
  }
}

export function deterministicId(kind: string, material: string): string {
  return `${kind}_${createHash('sha256').update(material).digest('hex').slice(0, 26)}`;
}
