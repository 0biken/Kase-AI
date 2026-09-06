import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';
import { redisConnection } from './queue.config';

export const AUDIT_CANCELLATION_CHANNEL = 'kase:audit-cancel';

@Injectable()
export class CancellationBusService implements OnModuleInit, OnApplicationShutdown {
  private publisher?: Redis;
  private subscriber?: Redis;
  private readonly listeners = new Set<(auditId: string) => void>();

  async onModuleInit(): Promise<void> {
    const connection = redisConnection();
    this.publisher = new Redis({ ...connection, lazyConnect: true, maxRetriesPerRequest: null });
    this.subscriber = new Redis({ ...connection, lazyConnect: true, maxRetriesPerRequest: null });
    await Promise.all([this.publisher.connect(), this.subscriber.connect()]);
    this.subscriber.on('message', (channel, auditId) => {
      if (channel !== AUDIT_CANCELLATION_CHANNEL) return;
      for (const listener of this.listeners) listener(auditId);
    });
    await this.subscriber.subscribe(AUDIT_CANCELLATION_CHANNEL);
  }

  onCancellation(listener: (auditId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish(auditId: string): Promise<void> {
    if (!this.publisher) throw new Error('Cancellation bus is not initialized');
    await this.publisher.publish(AUDIT_CANCELLATION_CHANNEL, auditId);
  }

  async onApplicationShutdown(): Promise<void> {
    this.listeners.clear();
    await Promise.all([
      this.subscriber?.quit().catch(() => undefined),
      this.publisher?.quit().catch(() => undefined),
    ]);
  }
}
