import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { QUEUE_AUDIT } from '../queue/queue.constants';
import { workerOptionsFor } from '../queue/queue.config';
import type { ReconAuditJobPayload } from './audit-job.payload';
import { AuditSchedulerService } from './audit-scheduler.service';

@Injectable()
export class SchedulerWorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SchedulerWorkerService.name);
  private worker?: Worker<ReconAuditJobPayload>;
  private recoveryTimer?: NodeJS.Timeout;

  constructor(private readonly scheduler: AuditSchedulerService) {}

  onModuleInit(): void {
    this.worker = new Worker(QUEUE_AUDIT, (job: Job<ReconAuditJobPayload>) => this.scheduler.advance(job.data.auditId), workerOptionsFor(QUEUE_AUDIT));
    this.worker.on('failed', (job, error) => this.logger.error(`Scheduler wake ${job?.id ?? 'unknown'} failed: ${error.message}`));
    void this.scheduler.recover().catch((error) => this.logger.error('Initial scheduler recovery failed', error));
    const recoveryMs = positiveInt(process.env.KASE_SCHEDULER_RECOVERY_MS, 30_000);
    this.recoveryTimer = setInterval(() => void this.scheduler.recover().catch((error) => this.logger.error('Scheduler recovery failed', error)), recoveryMs);
    this.recoveryTimer.unref?.();
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
    await this.worker?.close();
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('KASE_SCHEDULER_RECOVERY_MS must be a positive integer');
  return parsed;
}
