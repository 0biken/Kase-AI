import { Module } from '@nestjs/common';
import { FlatAuditQueryController, OrchestratorController } from './orchestrator.controller';
import { OrchestratorService } from './orchestrator.service';
import { AuditCancellationController } from './audit-cancellation.controller';
import { AuditCancellationService } from './audit-cancellation.service';
import { AuditEventsModule } from '../audit-events/audit-events.module';
import { AiConfigurationModule } from '../agent-runtime/ai-configuration.module';

@Module({
  imports: [AuditEventsModule, AiConfigurationModule],
  controllers: [OrchestratorController, FlatAuditQueryController, AuditCancellationController],
  providers: [OrchestratorService, AuditCancellationService],
  exports: [OrchestratorService],
})
export class OrchestratorModule {}
