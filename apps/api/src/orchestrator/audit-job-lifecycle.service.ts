import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DurableQueueDispatcher } from '../queue/durable-queue-dispatcher';
import { AuditEventsService } from '../audit-events/audit-events.service';
import type { ReconAuditJobPayload } from './audit-job.payload';
import { assertAuditTransition, isTerminalAuditStatus } from './audit-state-machine';
import { classifyJobError, retryDecision } from './retry-policy';
import { newId } from '../common/ids';

export const DEFAULT_LEASE_MS = positiveInt('JOB_LEASE_MS', 60_000);
export const DEFAULT_HEARTBEAT_MS = positiveInt('JOB_HEARTBEAT_MS', 20_000);

@Injectable()
export class AuditJobLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: DurableQueueDispatcher,
    private readonly events: AuditEventsService,
  ) {}

  async claim(payload: ReconAuditJobPayload, leaseMs = DEFAULT_LEASE_MS): Promise<any | null> {
    return this.prisma.$transaction(async (tx: any) => {
      await lockAudit(tx, payload.auditId);
      const audit = await tx.audit.findFirst({ where: { id: payload.auditId, projectId: payload.projectId } });
      if (!audit) throw new Error('Audit does not match queue payload');
      if (audit.cancellationRequestedAt || audit.status === 'cancelled') throw new Error('Audit cancellation requested');
      if (isTerminalAuditStatus(audit.status)) throw new Error(`Audit is terminal: ${audit.status}`);
      const job = await tx.auditJob.findFirst({ where: { id: payload.auditJobId, auditId: payload.auditId } });
      if (!job) throw new Error('Audit job does not match queue payload');
      if (job.status === 'succeeded') return null;
      if (job.status !== 'queued') throw new Error(`Audit job is not claimable: ${job.status}`);
      const now = new Date();
      const updated = await tx.auditJob.update({
        where: { id: job.id },
        data: {
          status: 'running', attempts: { increment: 1 }, startedAt: job.startedAt ?? now,
          heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + leaseMs),
          enqueuedAt: null, error: null, errorClass: null,
        },
      });
      if (audit.status === 'queued') {
        assertAuditTransition('queued', 'running');
        await tx.audit.update({ where: { id: audit.id }, data: { status: 'running', startedAt: now } });
        await appendEventInTransaction(tx, audit.id, 'audit.status', { status: 'running' });
      }
      await appendEventInTransaction(tx, audit.id, 'job.running', { jobId: job.id, kind: job.kind });
      return updated;
    });
  }

  async heartbeat(auditJobId: string, leaseMs = DEFAULT_LEASE_MS, attempt?: number): Promise<boolean> {
    const now = new Date();
    const result = await this.prisma.auditJob.updateMany({
      where: { id: auditJobId, status: 'running', ...(attempt === undefined ? {} : { attempts: attempt }) },
      data: { heartbeatAt: now, leaseExpiresAt: new Date(now.getTime() + leaseMs) },
    });
    return result.count === 1;
  }

  async waitForChild(payload: ReconAuditJobPayload, childJobId: string, attempt: number): Promise<void> {
    await this.prisma.$transaction(async tx => {
      await lockAudit(tx, payload.auditId);
      const child = await tx.auditJob.findFirst({ where: { id: childJobId, auditId: payload.auditId, parentJobId: payload.auditJobId } });
      if (!child) throw new Error('Child does not belong to agent job');
      await tx.auditJob.updateMany({ where: { id: payload.auditJobId, auditId: payload.auditId, status: 'running', attempts: attempt },
        data: { status: 'waiting', continuations: { increment: 1 }, heartbeatAt: null, leaseExpiresAt: null, enqueuedAt: null } });
    });
    await this.queues.wakeScheduler(payload);
  }

  async succeed(payload: ReconAuditJobPayload, attempt?: number): Promise<void> {
    const changed = await this.prisma.auditJob.updateMany({
      where: { id: payload.auditJobId, auditId: payload.auditId, status: 'running', ...(attempt === undefined ? {} : { attempts: attempt }) },
      data: { status: 'succeeded', finishedAt: new Date(), heartbeatAt: null, leaseExpiresAt: null },
    });
    if (changed.count === 1) await this.events.append(payload.auditId, 'job.succeeded', { jobId: payload.auditJobId });
    const audit = await this.prisma.audit.findUnique({ where: { id: payload.auditId }, select: { mode: true } });
    if (audit?.mode === 'smoke') {
      const completed = await this.prisma.audit.updateMany({
        where: { id: payload.auditId, status: { in: ['queued', 'running'] }, cancellationRequestedAt: null },
        data: { status: 'completed', completedAt: new Date() },
      });
      if (completed.count === 1) await this.events.append(payload.auditId, 'audit.status', { status: 'completed' });
    } else await this.queues.wakeScheduler(payload);
  }

  async fail(payload: ReconAuditJobPayload, error: unknown, attempt?: number): Promise<void> {
    const job = await this.prisma.auditJob.findFirst({ where: { id: payload.auditJobId, auditId: payload.auditId, ...(attempt === undefined ? {} : { attempts: attempt }) } });
    if (!job || job.status !== 'running') return;
    const errorClass = classifyJobError(error);
    // Lease generations never decrease. Successful child suspensions do not
    // consume the failure retry allowance.
    const decision = retryDecision(errorClass, job.attempts - (job.continuations ?? 0), job.maxRetries, job.timeoutMs);
    // A recovered job may have been claimed for a newer attempt after the
    // stale worker read it.  Make the terminal/retry write conditional too;
    // otherwise that stale worker could overwrite the current attempt.
    const changed = await this.prisma.auditJob.updateMany({
      where: { id: job.id, status: 'running', attempts: job.attempts },
      data: decision.retry ? {
        status: 'queued', timeoutMs: decision.timeoutMs, enqueuedAt: null,
        heartbeatAt: null, leaseExpiresAt: null, error: safeError(error), errorClass,
      } : {
        status: decision.terminalStatus!, finishedAt: new Date(), heartbeatAt: null,
        leaseExpiresAt: null, error: safeError(error), errorClass,
      },
    });
    if (changed.count !== 1) return;
    await this.events.append(payload.auditId, decision.retry ? 'job.retrying' : `job.${decision.terminalStatus}`, {
      jobId: payload.auditJobId, errorClass, attempts: job.attempts,
    });
    const audit = await this.prisma.audit.findUnique({ where: { id: payload.auditId }, select: { mode: true } });
    if (audit?.mode === 'smoke') {
      if (!decision.retry) {
        await this.prisma.audit.updateMany({
          where: { id: payload.auditId, status: { in: ['queued', 'running'] } },
          data: { status: decision.terminalStatus === 'cancelled' ? 'cancelled' : 'failed', completedAt: new Date() },
        });
        return;
      }
      const timer = setTimeout(
        () => void this.queues.enqueue(job.kind, payload).catch(() => undefined),
        decision.delayMs!,
      );
      timer.unref?.();
      return;
    }
    const wake = () => void this.queues.wakeScheduler(payload).catch(() => undefined);
    if (decision.retry && decision.delayMs) {
      const timer = setTimeout(wake, decision.delayMs);
      timer.unref?.();
    } else wake();
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

function positiveInt(name: string, fallback: number): number {
  const raw = process.env[`KASE_${name}`];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(`KASE_${name} must be a positive integer`);
  return parsed;
}
