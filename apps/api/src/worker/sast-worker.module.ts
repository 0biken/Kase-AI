import { CodeMapModule } from '../agent-runtime/code-map/code-map.module';
import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { AuditTrailModule } from '../audit-trail/audit-trail.module';
import { AuditEventsModule } from '../audit-events/audit-events.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { FindingsModule } from '../findings/findings.module';
import { ProvenanceModule } from '../provenance/provenance.module';
import { RetentionModule } from '../retention/retention.module';
import { AuditJobLifecycleService } from '../orchestrator/audit-job-lifecycle.service';
import { CancellationSignalRegistry } from '../orchestrator/cancellation-signal.registry';
import { executeSemgrep, SEMGREP_EXECUTOR, SemgrepAdapter } from '../adapters/sast/semgrep.adapter';
import { SastWorkerService } from './sast-worker.service';
import { SastJobConsumerService } from './sast-job-consumer.service';

@Module({
  imports: [
    CodeMapModule, PrismaModule, QueueModule, StorageModule, AuditTrailModule, AuditEventsModule,
    EvidenceModule, FindingsModule, ProvenanceModule, RetentionModule,
  ],
  providers: [
    AuditJobLifecycleService,
    CancellationSignalRegistry,
    { provide: SEMGREP_EXECUTOR, useValue: executeSemgrep },
    SemgrepAdapter,
    SastWorkerService,
    SastJobConsumerService,
  ],
})
export class SastWorkerModule {}
