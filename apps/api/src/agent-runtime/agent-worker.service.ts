import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { Worker, Job } from 'bullmq';
import { QUEUE_BLACKBOX_AGENT, QUEUE_WHITEBOX_AGENT } from '../queue/queue.constants';
import { workerOptionsFor } from '../queue/queue.config';
import { withJobTimeout } from '../queue/job-timeout.util';
import { AgentLoopService } from './agent-loop.service';
import { AuditJobLifecycleService, DEFAULT_HEARTBEAT_MS } from '../orchestrator/audit-job-lifecycle.service';
import { CancellationSignalRegistry } from '../orchestrator/cancellation-signal.registry';
import { PrismaService } from '../prisma/prisma.service';
import type { ReconAuditJobPayload } from '../orchestrator/audit-job.payload';
@Injectable()
export class AgentWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentWorkerService.name);
  private workers: Worker[] = [];
  constructor(private readonly loop: AgentLoopService, private readonly lifecycle: AuditJobLifecycleService,
    private readonly cancellations: CancellationSignalRegistry, private readonly prisma: PrismaService) {}
  onModuleInit() {
    for (const [queue, role] of [[QUEUE_BLACKBOX_AGENT, 'blackbox'], [QUEUE_WHITEBOX_AGENT, 'whitebox']] as const) {
      const worker = new Worker(queue, job => this.process(job, role), { ...workerOptionsFor(queue), concurrency: 1 });
      worker.on('failed', (job) => this.logger.error('Agent job failed: ' + job?.id));
      this.workers.push(worker);
    }
  }
  async process(job: Job<ReconAuditJobPayload>, role: 'blackbox' | 'whitebox') {
    const payload = job.data;
    const stored = await this.lifecycle.claim(payload);
    if (!stored) return;
    const watch = this.cancellations.watch(payload.auditId);
    const lostLease = new AbortController();
    const heartbeat = setInterval(() => {
      void this.lifecycle.heartbeat(payload.auditJobId, undefined, stored.attempts).then(ok => {
        if (!ok) lostLease.abort(new Error('Agent lease lost'));
      }).catch(() => lostLease.abort(new Error('Agent heartbeat failed')));
    }, DEFAULT_HEARTBEAT_MS);
    heartbeat.unref();
    try {
      const remaining = Math.max(1, stored.startedAt.getTime() + stored.timeoutMs - Date.now());
      const result = await withJobTimeout(payload.auditJobId, remaining, timeout => this.loop.runTurnLoop(
        payload.auditId, payload.auditJobId, role, AbortSignal.any([timeout, watch.signal, lostLease.signal])));
      if (result.waitingForJobId) await this.lifecycle.waitForChild(payload, result.waitingForJobId, stored.attempts);
      else await this.lifecycle.succeed(payload, stored.attempts);
    } catch (error) {
      await this.lifecycle.fail(payload, error, stored.attempts);
      const latest = await this.prisma.auditJob.findUnique({ where: { id: payload.auditJobId } });
      if (latest && ['failed', 'timed_out', 'cancelled'].includes(latest.status))
        await this.prisma.agentRun.updateMany({ where: { auditId: payload.auditId, role }, data: { status: latest.status === 'cancelled' ? 'cancelled' : 'failed', finishedAt: new Date() } });
      throw error;
    } finally { clearInterval(heartbeat); watch.close(); }
  }
  async onModuleDestroy() { await Promise.all(this.workers.map(w => w.close())); }
}

