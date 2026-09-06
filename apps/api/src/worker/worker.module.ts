import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AuditTrailModule } from '../audit-trail/audit-trail.module';
import { SecretsModule } from '../secrets/secrets.module';
import { ReconWorkerService } from './recon-worker.service';
import { QueueModule } from '../queue/queue.module';
import { AuditEventsModule } from '../audit-events/audit-events.module';
import { RetentionModule } from '../retention/retention.module';
import { AuditJobLifecycleService } from '../orchestrator/audit-job-lifecycle.service';
import { CancellationSignalRegistry } from '../orchestrator/cancellation-signal.registry';
import { EvidenceModule } from '../evidence/evidence.module';
import { HttpJobConsumerService } from './http-job-consumer.service';

@Module({
  imports: [PrismaModule, QueueModule, StorageModule, AuditTrailModule, SecretsModule, AuditEventsModule, RetentionModule, EvidenceModule],
  providers: [AuditJobLifecycleService, CancellationSignalRegistry, ReconWorkerService, HttpJobConsumerService],
})
export class WorkerModule {}
