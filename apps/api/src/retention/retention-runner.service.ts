import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { RetentionWorkerService } from './retention-worker.service';

@Injectable()
export class RetentionRunnerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(RetentionRunnerService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly retention: RetentionWorkerService) {}

  onModuleInit(): void {
    void this.run();
    if (process.env.KASE_RETENTION_RUN_ONCE === 'true') return;
    const intervalMs = positiveInt(process.env.KASE_RETENTION_INTERVAL_MS, 60_000);
    this.timer = setInterval(() => void this.run(), intervalMs);
  }

  onApplicationShutdown(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const result = await this.retention.runBatch();
      this.logger.log(`Retention batch claimed=${result.claimed} tombstoned=${result.tombstoned} failed=${result.failed}`);
    } catch (error) {
      this.logger.error('Retention batch failed', error instanceof Error ? error.stack : String(error));
    } finally {
      this.running = false;
    }
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error('KASE_RETENTION_INTERVAL_MS must be a positive integer');
  return parsed;
}
