import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { S3Service } from '../storage/s3.service';
import { RetentionWorkerService } from '../retention/retention-worker.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import type { Actor } from '../projects/projects.service';

@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3Service,
    private readonly retention: RetentionWorkerService,
    private readonly trail: AuditTrailService,
  ) {}

  async list(projectId: string, auditId: string) {
    await this.assertAudit(projectId, auditId);
    return this.prisma.evidence.findMany({ where: { auditId }, orderBy: { capturedAt: 'asc' } });
  }

  async metadata(projectId: string, auditId: string, evidenceId: string) {
    await this.assertAudit(projectId, auditId);
    const evidence = await this.prisma.evidence.findFirst({ where: { id: evidenceId, auditId } });
    if (!evidence) throw new ProblemException('NOT_FOUND', 'Evidence does not belong to this audit');
    return evidence;
  }

  async download(projectId: string, auditId: string, evidenceId: string, actor: Actor): Promise<Buffer> {
    const evidence = await this.metadata(projectId, auditId, evidenceId);
    const live = await this.retention.requireLiveArtifact(evidenceId);
    const bytes = await this.storage.downloadEvidence(live.artifactUri);
    const actual = createHash('sha256').update(bytes).digest('hex');
    if (bytes.length !== evidence.sizeBytes || actual !== evidence.sha256) {
      throw new ProblemException('INTERNAL', 'Stored evidence failed integrity verification');
    }
    await this.trail.record({
      projectId, actorType: actor.type, actorId: actor.id, action: 'evidence.access',
      resourceType: 'Evidence', resourceId: evidenceId, outcome: 'allowed',
    });
    return bytes;
  }

  private async assertAudit(projectId: string, auditId: string): Promise<void> {
    const count = await this.prisma.audit.count({ where: { id: auditId, projectId } });
    if (count !== 1) throw new ProblemException('NOT_FOUND', 'Audit does not belong to this project');
  }
}
