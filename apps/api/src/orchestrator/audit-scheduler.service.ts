import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MAX_JOBS_PER_AUDIT } from '../queue/queue.config';
import { DurableQueueDispatcher } from '../queue/durable-queue-dispatcher';
import type { ReconAuditJobPayload } from './audit-job.payload';
import { assertAuditTransition, completionStatus, isTerminalAuditStatus } from './audit-state-machine';
import { blockedJobs, readyJobs, TERMINAL_JOB_STATUSES, type JobGraphNode } from './job-graph';
import { newId } from '../common/ids';
import { ReconBudgetService } from '../recon/recon-budget.service';

const DEFAULT_LEASE_MS = 60_000;

interface StoredJob extends JobGraphNode {
  auditId: string;
  category?: string | null;
  attempts: number;
  continuations?: number;
  maxRetries: number;
  timeoutMs: number;
  required?: boolean;
  leaseExpiresAt?: Date | null;
}

/** Durable scheduler: every decision can be reconstructed from PostgreSQL. */
@Injectable()
export class AuditSchedulerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: DurableQueueDispatcher,
    private readonly budgets: ReconBudgetService,
  ) {}

  async advance(auditId: string): Promise<void> {
    const toEnqueue = await this.prisma.$transaction(async (tx: any) => {
      await lockAudit(tx, auditId);
      const audit = await tx.audit.findUnique({ where: { id: auditId } });
      if (!audit || isTerminalAuditStatus(audit.status)) return [];
      const jobs: StoredJob[] = await tx.auditJob.findMany({ where: { auditId }, orderBy: { id: 'asc' } });
      for (const job of jobs.filter(j => j.status === 'waiting')) {
        const run = await tx.agentRun.findFirst({ where: { auditJobId: job.id, auditId } });
        const child = jobs.find(j => j.id === run?.waitingForJobId);
        if (!child || TERMINAL_JOB_STATUSES.includes(child.status) || (run?.deadline && run.deadline <= new Date())) {
          await tx.auditJob.update({ where: { id: job.id }, data: { status: 'queued', enqueuedAt: null } });
          job.status = 'queued';
        }
      }
      if (audit.cancellationRequestedAt) {
        await tx.auditJob.updateMany({
          where: { auditId, status: { in: ['queued', 'waiting'] } },
          data: { status: 'cancelled', finishedAt: new Date(), enqueuedAt: null, errorClass: 'cancelled' },
        });
        const remaining = jobs.filter((job) => job.status === 'running');
        if (remaining.length === 0) {
          const cancelledJobs = jobs.map((job) => ['queued', 'waiting'].includes(job.status) ? { ...job, status: 'cancelled' as const } : job);
          await this.finishSettledGraph(tx, audit, cancelledJobs);
        }
        return [];
      }
      let effectiveJobs = jobs;
      for (;;) {
        const blocked = blockedJobs(effectiveJobs);
        if (blocked.length === 0) break;
        const blockedIds = new Set(blocked.map((job) => job.id));
        const now = new Date();
        for (const job of blocked) {
          await tx.auditJob.update({ where: { id: job.id }, data: {
            status: 'skipped', finishedAt: now, enqueuedAt: null,
            error: 'Required dependency did not succeed', errorClass: 'permanent',
          } });
        }
        effectiveJobs = effectiveJobs.map((job) => blockedIds.has(job.id)
          ? { ...job, status: 'skipped' as const, finishedAt: now }
          : job);
      }
      const available = Math.max(0, MAX_JOBS_PER_AUDIT - effectiveJobs.filter((job) => job.status === 'running').length);
      const ready = readyJobs(effectiveJobs, effectiveJobs.length)
        .filter((job: any) => !job.enqueuedAt)
        .slice(0, available);

      if (ready.length === 0 && effectiveJobs.every((job) => TERMINAL_JOB_STATUSES.includes(job.status))) {
        await this.finishSettledGraph(tx, audit, effectiveJobs);
        return [];
      }

      const now = new Date();
      for (const job of ready) {
        await tx.auditJob.update({ where: { id: job.id }, data: { enqueuedAt: now } });
      }
      return ready.map((job) => ({
        kind: job.kind,
        payload: { auditId, auditJobId: job.id, projectId: audit.projectId } satisfies ReconAuditJobPayload,
      }));
    });

    for (const item of toEnqueue) {
      try {
        await this.queues.enqueue(item.kind, item.payload);
      } catch (error) {
        await (this.prisma.auditJob as any).update({
          where: { id: item.payload.auditJobId },
          data: { enqueuedAt: null, error: safeError(error), errorClass: 'transient' },
        });
        throw error;
      }
    }
  }

  async recover(now = new Date()): Promise<void> {
    await this.budgets.reclaimExpired(now);
    const expired: StoredJob[] = await (this.prisma.auditJob as any).findMany({
      where: { status: 'running', leaseExpiresAt: { lt: now } },
      orderBy: { id: 'asc' },
    });
    for (const job of expired) {
      const retry = job.attempts - (job.continuations ?? 0) <= job.maxRetries;
      await (this.prisma.auditJob as any).updateMany({
        where: { id: job.id, status: 'running', leaseExpiresAt: { lt: now } },
        data: retry ? {
          status: 'queued', enqueuedAt: null, heartbeatAt: null, leaseExpiresAt: null,
          error: 'Worker lease expired; recovered by scheduler', errorClass: 'transient',
        } : {
          status: 'failed', finishedAt: now, enqueuedAt: null, heartbeatAt: null, leaseExpiresAt: null,
          error: 'Worker lease expired after the final permitted attempt', errorClass: 'transient',
        },
      });
    }
    await (this.prisma.auditJob as any).updateMany({
      where: { status: 'queued', enqueuedAt: { lt: new Date(now.getTime() - DEFAULT_LEASE_MS) } },
      data: { enqueuedAt: null },
    });
    const audits: Array<{ id: string }> = await (this.prisma.audit as any).findMany({
      where: { status: { in: ['queued', 'running'] } }, select: { id: true },
    });
    for (const audit of audits) await this.advance(audit.id);
  }

  private async finishSettledGraph(tx: any, audit: any, jobs: StoredJob[]): Promise<void> {
    const failed = jobs.filter((job) => ['failed', 'timed_out'].includes(job.status));
    const reasons = [...new Set([...(audit.degradationReasons ?? []), ...(audit.degraded ? ['audit_degraded'] : []),
      ...failed.map((job) => job.status === 'timed_out' ? 'job_timeout' : 'job_exhausted')])];
    const status = completionStatus({
      setupFailed: failed.some((job) => job.kind === 'build_provenance'),
      cancellationRequested: Boolean(audit.cancellationRequestedAt),
      hasUsableResults: jobs.some((job) => job.status === 'succeeded' && job.kind !== 'build_provenance'),
      requiredJobsFailed: failed.some((job) => job.required !== false), degradationReasons: reasons,
    });
    assertAuditTransition(audit.status, status);
    const executedCategories = [...new Set(jobs.filter((job) => job.status === 'succeeded' && job.category).map((job) => job.category!))];
    const notExecutedCategories = jobs
      .filter((job) => ['failed', 'timed_out', 'cancelled', 'skipped'].includes(job.status) && job.category)
      .map((job) => ({ category: job.category!, reason: job.status }));
    await tx.audit.update({ where: { id: audit.id }, data: {
      status, degraded: reasons.length > 0, degradationReasons: reasons,
      executedCategories, notExecutedCategories, completedAt: new Date(),
    } });
    if (reasons.length > 0) await appendEventInTransaction(tx, audit.id, 'audit.degraded', { reasons });
    await appendEventInTransaction(tx, audit.id, 'audit.status', { status });
  }

}

async function lockAudit(tx: any, auditId: string): Promise<void> {
  if (typeof tx.$queryRawUnsafe === 'function') {
    await tx.$queryRawUnsafe('SELECT id FROM "Audit" WHERE id = $1 FOR UPDATE', auditId);
  }
}

function safeError(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1_000);
}

async function appendEventInTransaction(tx: any, auditId: string, type: string, data: unknown): Promise<void> {
  if (!tx.auditEvent) return;
  const last = await tx.auditEvent.findFirst({
    where: { auditId }, orderBy: { sequence: 'desc' }, select: { sequence: true },
  });
  await tx.auditEvent.create({
    data: { id: newId('auditEvent'), auditId, sequence: (last?.sequence ?? 0) + 1, type, data },
  });
}
