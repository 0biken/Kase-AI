import { Injectable, Optional } from '@nestjs/common';
import { AiConfigurationService } from '../agent-runtime/ai-configuration.service';
import { PrismaService } from '../prisma/prisma.service';
import { ProblemException } from '../common/problem-details';
import { isHostAllowed } from '../common/host-pattern';
import { newId } from '../common/ids';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import type { Actor } from '../projects/projects.service';
import type { CreateAuditDto } from './dto/create-audit.dto';
import { graphTemplate } from './job-graph';
import { DurableQueueDispatcher } from '../queue/durable-queue-dispatcher';

@Injectable()
export class OrchestratorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrailService,
    private readonly queues: DurableQueueDispatcher,
    @Optional() private readonly aiConfigurations?: AiConfigurationService,
  ) {}

  list(projectId: string) {
    return this.prisma.audit.findMany({
      where: { projectId }, orderBy: { startedAt: 'desc' }, take: 100,
      include: { jobs: true },
    });
  }

  async detail(projectId: string, auditId: string) {
    const audit = await this.prisma.audit.findFirst({
      where: { id: auditId, projectId },
      include: { jobs: true, endpointInventory: { select: { id: true, status: true, endpointCount: true, addedCount: true, removedCount: true, changedCount: true, generatedAt: true } } },
    });
    if (!audit) throw new ProblemException('NOT_FOUND', 'Audit does not belong to this project');
    return audit;
  }

  async jobs(projectId: string, auditId: string) {
    await this.detail(projectId, auditId);
    return this.prisma.auditJob.findMany({ where: { auditId }, orderBy: { id: 'asc' } });
  }

  async dispatch(projectId: string, dto: CreateAuditDto, idempotencyKey: string, actor: Actor) {
    if (!idempotencyKey?.trim()) {
      throw new ProblemException('IDEMPOTENCY_KEY_REQUIRED');
    }

    const existing = await this.prisma.audit.findFirst({
      where: { projectId, idempotencyKey },
      include: { jobs: true },
    });
    if (existing) return existing;

    const requestedCategories = dto.mode === 'smoke'
      ? [dto.category ?? dto.categories?.[0] ?? 'fixture_health']
      : [...new Set(dto.categories?.length ? dto.categories : dto.mode === 'full' ? ['sast', 'http'] : ['sast'])];
    const allowedCategories = dto.mode === 'smoke' ? ['fixture_health'] : dto.mode === 'security' ? ['sast'] : ['sast', 'http', 'blackbox', 'whitebox'];
    const unsupported = requestedCategories.filter((category) => !allowedCategories.includes(category));
    if (unsupported.length > 0) {
      throw new ProblemException('VALIDATION_FAILED', `Unsupported ${dto.mode} categories: ${unsupported.join(', ')}`);
    }
    if (!dto.targetId && !dto.repositoryId) {
      throw new ProblemException('VALIDATION_FAILED', 'targetId or repositoryId is required');
    }
    if (dto.mode === 'smoke' && !dto.targetId) {
      throw new ProblemException('VALIDATION_FAILED', 'Smoke audits require targetId');
    }
    if (dto.mode !== 'smoke' && !dto.repositoryId) {
      throw new ProblemException('VALIDATION_FAILED', 'Security audits require repositoryId');
    }
    if ((requestedCategories.includes('http') || requestedCategories.includes('blackbox')) && !dto.targetId) {
      throw new ProblemException('VALIDATION_FAILED', 'Full audits require targetId for the HTTP category');
    }

    const target = dto.targetId ? await this.prisma.target.findFirst({
      where: { id: dto.targetId, projectId },
    }) : null;
    if (dto.targetId && !target) throw new ProblemException('NOT_FOUND', 'Target does not belong to this project');
    const repository = dto.repositoryId ? await (this.prisma.repository as any).findFirst({
      where: { id: dto.repositoryId, projectId },
    }) : null;
    if (dto.repositoryId && !repository) throw new ProblemException('NOT_FOUND', 'Repository does not belong to this project');

    const policy = target ? await this.prisma.scopePolicy.findFirst({
      where: { projectId }, orderBy: { authorizationAttestedAt: 'desc' },
    }) : null;
    if (target && !policy) throw new ProblemException('ATTESTATION_REQUIRED', 'An attested scope policy is required');

    const host = target ? new URL(target.baseUrl).hostname.toLowerCase() : null;
    if (target && policy && !isHostAllowed(host!, policy.allowedHosts)) {
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

    if (target?.authCredentialId) {
      const usable = await this.prisma.secret.count({
        where: { id: target.authCredentialId, projectId, revokedAt: null },
      });
      if (usable !== 1) {
        throw new ProblemException('VALIDATION_FAILED', 'Target credential is missing or revoked');
      }
    }

    const aiRequested = requestedCategories.includes('blackbox') || requestedCategories.includes('whitebox');
    let aiConfig: any = null;
    if (aiRequested) {
      if (!this.aiConfigurations) throw new ProblemException('INTERNAL', 'AI configuration service unavailable');
      aiConfig = await this.aiConfigurations.snapshot(projectId);
    }

    const auditId = newId('audit');
    const templates = graphTemplate(
      dto.mode,
      dto.mode === 'smoke' ? undefined : requestedCategories as Array<'sast' | 'http' | 'blackbox' | 'whitebox'>,
    );
    const jobIds = new Map(templates.map((template) => [template.kind, newId('auditJob')]));
    const audit = await this.prisma.$transaction(async (tx) => {
      await tx.audit.create({
        data: {
          id: auditId,
          projectId,
          targetId: target?.id ?? null,
          repositoryId: repository?.id ?? null,
          requestedCommitSha: dto.commitSha ?? null,
          idempotencyKey,
          mode: dto.mode,
          status: 'queued',
          degradationReasons: [],
          requestedCategories,
          executedCategories: [],
          notExecutedCategories: [],
        },
      });
      if ((requestedCategories.includes('http') || requestedCategories.includes('blackbox')) && policy) {
        await tx.reconRequestBudget.create({ data: {
          auditId,
          maxRequests: policy.maxRequestsPerAudit,
          reconLimit: Math.max(1, Math.floor(policy.maxRequestsPerAudit * 0.4)),
        } });
      }
      if (aiRequested && aiConfig) {
        await tx.auditAiSnapshot.create({
          data: {
            auditId,
            ...aiConfig,
          },
        });
        await tx.auditAiBudget.create({
          data: {
            auditId,
            totalTokensLimit: aiConfig.budgetTotalTokens,
            totalCallsLimit: aiConfig.budgetMaxCalls,
            contextBytesLimit: aiConfig.budgetMaxContextBytes,
          },
        });
      }

      for (const template of templates) {
        await tx.auditJob.create({ data: {
          id: jobIds.get(template.kind)!, auditId, kind: template.kind,
          category: template.kind === 'recon' ? requestedCategories[0] : template.category,
          status: 'queued',
          dependsOn: template.dependsOnKinds.map((kind) => jobIds.get(kind)!),
          timeoutMs: Math.min(template.timeoutMs, dto.maxWallTimeMs ?? template.timeoutMs),
          maxRetries: template.maxRetries,
          required: template.required,
        } });
      }
      return tx.audit.findUniqueOrThrow({ where: { id: auditId }, include: { jobs: true } });
    });

    try {
      const first = templates[0];
      const auditJobId = jobIds.get(first.kind)!;
      const payload = { auditId, auditJobId, projectId };
      if (dto.mode === 'smoke') await this.queues.enqueue('recon', payload);
      else await this.queues.wakeScheduler(payload);
    } catch (error) {
      await this.prisma.$transaction([
        this.prisma.auditJob.update({
          where: { id: jobIds.get(templates[0].kind)! },
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
      metadata: { targetId: target?.id, repositoryId: repository?.id, mode: dto.mode, categories: requestedCategories },
      outcome: 'allowed',
    });
    return audit;
  }
}

function safeError(error: unknown): string {
  return error instanceof Error ? error.name : 'unknown error';
}
