import { Injectable } from '@nestjs/common';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { ProblemException } from '../common/problem-details';
import { PrismaService } from '../prisma/prisma.service';
import { DurableQueueDispatcher } from '../queue/durable-queue-dispatcher';
import { AuditEventsService } from '../audit-events/audit-events.service';
import type { Actor } from '../projects/projects.service';
import { isTerminalAuditStatus } from './audit-state-machine';

@Injectable()
export class AuditCancellationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly queues: DurableQueueDispatcher,
    private readonly events: AuditEventsService,
    private readonly trail: AuditTrailService,
  ) {}

  async cancel(auditId: string, actor: Actor): Promise<unknown> {
    const outcome = await this.prisma.$transaction(async (tx: any) => {
      if (typeof tx.$queryRawUnsafe === 'function') {
        await tx.$queryRawUnsafe('SELECT id FROM "Audit" WHERE id = $1 FOR UPDATE', auditId);
      }
      const audit = await tx.audit.findUnique({ where: { id: auditId }, include: { jobs: true } });
      if (!audit) throw new ProblemException('NOT_FOUND', 'Audit does not exist');
      if (audit.status === 'cancelled') return { audit, pending: [], wakeJobId: null, repeated: true };
      if (isTerminalAuditStatus(audit.status)) {
        throw new ProblemException('CONFLICT', `Audit is already terminal: ${audit.status}`);
      }
      if (audit.cancellationRequestedAt) return { audit, pending: [], wakeJobId: null, repeated: true };
      const now = new Date();
      await tx.auditJob.updateMany({
        where: { auditId, status: { in: ['queued', 'waiting'] } },
        data: { status: 'cancelled', finishedAt: now, enqueuedAt: null, errorClass: 'cancelled' },
      });
      const updated = await tx.audit.update({
        where: { id: auditId },
        data: { cancellationRequestedAt: audit.cancellationRequestedAt ?? now },
      });
      return {
        audit: updated,
        pending: audit.jobs.filter((job: any) => ['queued', 'waiting'].includes(job.status)).map((job: any) => ({ id: job.id, kind: job.kind })),
        wakeJobId: audit.jobs[0]?.id ?? null,
        repeated: false,
      };
    });

    if (!outcome.repeated) {
      await Promise.all(outcome.pending.map((job: any) => this.queues.removePending(job.kind, job.id)));
      await this.queues.publishCancellation(auditId);
      if (outcome.wakeJobId) {
        await this.queues.wakeScheduler({
          auditId,
          auditJobId: outcome.wakeJobId,
          projectId: (outcome.audit as any).projectId,
        });
      }
      await this.events.append(auditId, 'audit.cancel', { requestedBy: actor.type });
      await this.trail.record({
        projectId: (outcome.audit as any).projectId,
        actorType: actor.type, actorId: actor.id, action: 'audit.cancel',
        resourceType: 'Audit', resourceId: auditId, outcome: 'allowed',
      });
    }
    return outcome.audit;
  }
}
