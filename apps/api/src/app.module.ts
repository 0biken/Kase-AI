import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { AgentRuntimeModule } from './agent-runtime/agent-runtime.module';
import { EvidenceModule } from './evidence/evidence.module';
import { CorrelationModule } from './correlation/correlation.module';
import { AssuranceModule } from './assurance/assurance.module';
import { QueueModule } from './queue/queue.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { AuditTrailModule } from './audit-trail/audit-trail.module';
import { ProjectsModule } from './projects/projects.module';

@Module({
  imports: [
    PrismaModule,
    AuditTrailModule,
    QueueModule,
    StorageModule,
    OrchestratorModule,
    AgentRuntimeModule,
    EvidenceModule,
    CorrelationModule,
    AssuranceModule,
    ProjectsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
