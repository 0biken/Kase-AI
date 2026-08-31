import { InjectQueue } from '@nestjs/bullmq';
import { Injectable } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_RECON } from '../queue/queue.constants';
import { ProblemException } from '../common/problem-details';
import { isHostAllowed } from '../common/host-pattern';
import { newId } from '../common/ids';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import type { Actor } from '../projects/projects.service';
import type { CreateAuditDto } from './dto/create-audit.dto';
import type { ReconAuditJobPayload } from './audit-job.payload';

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrailService,
    @InjectQueue(QUEUE_RECON) private readonly reconQueue: Queue<ReconAuditJobPayload>,
  ) {}

  async dispatch(projectId: string, dto: CreateAuditDto, idempotencyKey: string, actor: Actor) {
    if (!idempotencyKey?.trim()) {
      throw new ProblemException('IDEMPOTENCY_KEY_REQUIRED');
    }

    const existing = await this.prisma.audit.findFirst({
      where: { projectId, idempotencyKey },
      include: { jobs: true },
    });
    if (existing) return existing;

    const target = await this.prisma.target.findFirst({
      where: { id: dto.targetId, projectId },
    });
    if (!target) throw new ProblemException('NOT_FOUND', 'Target does not belong to this project');

    const policy = await this.prisma.scopePolicy.findFirst({
      where: { projectId },
      orderBy: { authorizationAttestedAt: 'desc' },
    });
    if (!policy) throw new ProblemException('ATTESTATION_REQUIRED', 'An attested scope policy is required');

    const host = new URL(target.baseUrl).hostname.toLowerCase();
    if (!isHostAllowed(host, policy.allowedHosts)) {
      await this.trail.record({
        projectId,
        actorType: actor.type,
        actorId: actor.id,
        action: 'scope.denied',
        resourceType: 'Target',
        resourceId: target.id,
        metadata: { host, reason: 'host_not_allowed', source: 'audit.dispatch' },
        outcome: 'denied',
      });
      throw new ProblemException('SCOPE_VIOLATION', `Target host "${host}" is not allowlisted`);
    }

    if (target.authCredentialId) {
      const usable = await this.prisma.secret.count({
        where: { id: target.authCredentialId, projectId, revokedAt: null },
      });
      if (usable !== 1) {
        throw new ProblemException('VALIDATION_FAILED', 'Target credential is missing or revoked');
      }
    }

    const auditId = newId('audit');
    const auditJobId = newId('auditJob');
    const audit = await this.prisma.$transaction(async (tx) => {
      await tx.audit.create({
        data: {
          id: auditId,
          projectId,
          targetId: target.id,
          idempotencyKey,
          mode: dto.mode,
          status: 'queued',
          degradationReasons: [],
          requestedCategories: [dto.category],
          executedCategories: [],
          notExecutedCategories: [],
        },
      });
      await tx.auditJob.create({
        data: {
          id: auditJobId,
          auditId,
          kind: 'recon',
          category: dto.category,
          status: 'queued',
          dependsOn: [],
        },
      });
      return tx.audit.findUniqueOrThrow({ where: { id: auditId }, include: { jobs: true } });
    });

    try {
      await this.reconQueue.add(
        'fixture-health',
        { auditId, auditJobId, projectId },
        { jobId: auditJobId },
      );
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.auditJob.update({
          where: { id: auditJobId },
          data: { status: 'failed', error: 'Queue dispatch failed', finishedAt: new Date() },
        }),
        this.prisma.audit.update({
          where: { id: auditId },
          data: { status: 'failed', completedAt: new Date() },
        }),
      ]);
      throw new ProblemException('INTERNAL', `Audit could not be queued: ${safeError(error)}`);
    }

    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'audit.dispatch',
      resourceType: 'Audit',
      resourceId: auditId,
      metadata: { targetId: target.id, mode: dto.mode, category: dto.category },
      outcome: 'allowed',
    });
    return audit;
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
