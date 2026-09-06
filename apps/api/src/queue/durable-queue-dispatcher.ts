import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Queue } from 'bullmq';
import type { ReconAuditJobPayload } from '../orchestrator/audit-job.payload';
import { QUEUE_BY_JOB_KIND, type QueueName } from './queue.constants';
import { redisConnection } from './queue.config';
import { QUEUE_AUDIT } from './queue.constants';
import { CancellationBusService } from './cancellation-bus.service';

export interface EnqueueOptions { delayMs?: number }

/** Queue transport deliberately accepts only the frozen identifier payload. */
@Injectable()
export class DurableQueueDispatcher implements OnApplicationShutdown {
  private readonly queues = new Map<QueueName, Queue<ReconAuditJobPayload>>();

  constructor(private readonly cancellationBus: CancellationBusService) {}

  async enqueue(kind: string, payload: ReconAuditJobPayload, options: EnqueueOptions = {}): Promise<void> {
    assertIdentifierOnlyPayload(payload);
    const queueName = QUEUE_BY_JOB_KIND[kind];
    if (!queueName) throw new Error(`No deterministic queue for AuditJob.kind=${kind}`);
    const queue = this.queue(queueName);
    const existing = await queue.getJob(payload.auditJobId);
    if (existing) {
      const state = await existing.getState();
      if (state === 'failed' || state === 'completed') await existing.remove();
      else return;
    }
    await queue.add(kind, payload, {
      jobId: payload.auditJobId, delay: options.delayMs ?? 0,
      attempts: 1, removeOnComplete: true, removeOnFail: false,
    });
  }

  async removePending(kind: string, auditJobId: string): Promise<void> {
    const queueName = QUEUE_BY_JOB_KIND[kind];
    if (!queueName) return;
    const job = await this.queue(queueName).getJob(auditJobId);
    if (!job) return;
    const state = await job.getState();
    if (state === 'waiting' || state === 'delayed' || state === 'prioritized') await job.remove();
  }

  async publishCancellation(auditId: string): Promise<void> {
    await this.cancellationBus.publish(auditId);
  }

  async wakeScheduler(payload: ReconAuditJobPayload): Promise<void> {
    assertIdentifierOnlyPayload(payload);
    const queue = this.queue(QUEUE_AUDIT);
    await queue.add('advance', payload, {
      attempts: 1,
      removeOnComplete: true,
      removeOnFail: false,
    });
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([...this.queues.values()].map((queue) => queue.close()));
    this.queues.clear();
  }

  private queue(name: QueueName): Queue<ReconAuditJobPayload> {
    let queue = this.queues.get(name);
    if (!queue) {
      queue = new Queue<ReconAuditJobPayload>(name, { connection: redisConnection() });
      this.queues.set(name, queue);
    }
    return queue;
  }
}

export function assertIdentifierOnlyPayload(payload: ReconAuditJobPayload): void {
  const keys = Object.keys(payload).sort();
  const expected = ['auditId', 'auditJobId', 'projectId'];
  if (JSON.stringify(keys) !== JSON.stringify(expected) ||
      expected.some((key) => typeof payload[key as keyof ReconAuditJobPayload] !== 'string')) {
    throw new Error('Queue payload must contain auditId, auditJobId, and projectId only');
  }
}
