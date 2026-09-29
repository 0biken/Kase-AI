import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { StorageModule } from '../storage/storage.module';
import { AuditEventsModule } from '../audit-events/audit-events.module';
import { AuditTrailModule } from '../audit-trail/audit-trail.module';
import { EvidenceModule } from '../evidence/evidence.module';
import { RetentionModule } from '../retention/retention.module';
import { ProviderModule } from '../ai-provider/provider.module';
import { AiConfigurationModule } from './ai-configuration.module';
import { CodeMapModule } from './code-map/code-map.module';
import { AgentWorkerService } from './agent-worker.service';
import { AgentLoopService } from './agent-loop.service';
import { TranscriptService } from './transcript.service';
import { PromptBuilder } from './prompt-builder';
import { BudgetService } from './budget/budget.service';
import { CapabilityExecutor } from './capabilities/capability.executor';
import { AuditJobLifecycleService } from '../orchestrator/audit-job-lifecycle.service';
import { CancellationSignalRegistry } from '../orchestrator/cancellation-signal.registry';
@Module({ imports: [PrismaModule, QueueModule, StorageModule, AuditEventsModule,
  AuditTrailModule, EvidenceModule, RetentionModule, ProviderModule, AiConfigurationModule, CodeMapModule],
  providers: [AgentWorkerService, AgentLoopService, TranscriptService, PromptBuilder, BudgetService, CapabilityExecutor,
    AuditJobLifecycleService, CancellationSignalRegistry] })
export class AgentWorkerModule {}

