import { Injectable, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CancellationBusService } from '../queue/cancellation-bus.service';

export interface CancellationWatch { signal: AbortSignal; close(): void }

/** Fast in-process signal plus PostgreSQL polling for cross-process cancellation. */
@Injectable()
export class CancellationSignalRegistry implements OnModuleInit, OnApplicationShutdown {
  private readonly controllers = new Map<string, Set<AbortController>>();
  private unsubscribe?: () => void;

  constructor(
    private readonly prisma: PrismaService,
    private readonly bus: CancellationBusService,
  ) {}

  onModuleInit(): void {
    this.unsubscribe = this.bus.onCancellation((auditId) => this.cancel(auditId));
  }

  onApplicationShutdown(): void {
    this.unsubscribe?.();
  }

  watch(auditId: string, parent?: AbortSignal, pollMs = 1_000): CancellationWatch {
    const controller = new AbortController();
    let controllers = this.controllers.get(auditId);
    if (!controllers) this.controllers.set(auditId, controllers = new Set());
    controllers.add(controller);
    const abort = () => controller.abort();
    parent?.addEventListener('abort', abort, { once: true });
    let checking = false;
    const check = async () => {
      if (checking || controller.signal.aborted) return;
      checking = true;
      try {
        const audit = await (this.prisma.audit as any).findUnique({
          where: { id: auditId }, select: { cancellationRequestedAt: true, status: true },
        });
        if (!audit || audit.cancellationRequestedAt || audit.status === 'cancelled') controller.abort();
      } catch {
        // Pub/sub remains the fast path. A transient database outage must not
        // crash the worker; the durable poll retries on the next interval.
      } finally { checking = false; }
    };
    void check();
    const timer = setInterval(() => void check(), pollMs);
    timer.unref?.();
    return {
      signal: controller.signal,
      close: () => {
        clearInterval(timer);
        parent?.removeEventListener('abort', abort);
        controllers!.delete(controller);
        if (controllers!.size === 0) this.controllers.delete(auditId);
      },
    };
  }

  cancel(auditId: string): void {
    for (const controller of this.controllers.get(auditId) ?? []) controller.abort();
  }
}
