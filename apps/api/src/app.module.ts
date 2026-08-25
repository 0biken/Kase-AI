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

@Module({
  imports: [
    PrismaModule,
    QueueModule,
    StorageModule,
    OrchestratorModule,
    AgentRuntimeModule,
    EvidenceModule,
    CorrelationModule,
    AssuranceModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
