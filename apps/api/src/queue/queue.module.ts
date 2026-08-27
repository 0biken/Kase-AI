import { Module, Global } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ALL_QUEUES } from './queue.constants';
import { MAX_JOB_ATTEMPTS, redisConnection } from './queue.config';

@Global()
@Module({
  imports: [
    BullModule.forRoot({
      connection: redisConnection(),
      defaultJobOptions: {
        // 02 §7: "Max retries | 2 | Then `failed`, audit continues".
        attempts: MAX_JOB_ATTEMPTS,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: true,
        // Keep failures: a job that failed is why a category is reported
        // `not_executed`, and the gate has to be able to explain that.
        removeOnFail: false,
      },
    }),
    // One registration per queue in the topology. Worker concurrency is NOT set
    // here — it belongs to the Worker, not the producer — so processors take it
    // from workerOptionsFor(queue) when they land in M2.
    ...ALL_QUEUES.map((name) => BullModule.registerQueue({ name })),
  ],
  exports: [BullModule],
})
export class QueueModule {}
