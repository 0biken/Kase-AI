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
import { ReconPipelineConsumerService } from './recon-pipeline-consumer.service';
import { KatanaAdapter } from '../adapters/recon/katana.adapter';
import { HttpxAdapter } from '../adapters/recon/httpx.adapter';
import { ReconScopeService } from '../recon/recon-scope.service';
import { ReconBudgetService } from '../recon/recon-budget.service';
import { HostRateLeaseService } from '../recon/host-rate-lease.service';
import { ReconEvidenceService } from '../recon/recon-evidence.service';
import { InventoryService } from '../recon/inventory.service';
import { HttpJobConsumerService } from './http-job-consumer.service';

@Module({
  imports: [PrismaModule, QueueModule, StorageModule, AuditTrailModule, SecretsModule, AuditEventsModule, RetentionModule, EvidenceModule],
  providers: [
    AuditJobLifecycleService, CancellationSignalRegistry, ReconWorkerService,
    KatanaAdapter, HttpxAdapter, ReconScopeService, ReconBudgetService, HostRateLeaseService,
    ReconEvidenceService, InventoryService, ReconPipelineConsumerService, HttpJobConsumerService,
  ],
})
export class WorkerModule {}
