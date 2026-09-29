import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditTrailModule } from '../audit-trail/audit-trail.module';
import { AiConfigurationModule } from './ai-configuration.module';
import { AiConfigurationController } from './ai-configuration.controller';
import { TestIdentitiesController } from './test-identities.controller';
import { AgentRunController } from './agent-run.controller';
// HTTP API composition: no model SDKs or agent consumers in this graph.
@Module({ imports: [PrismaModule, AuditTrailModule, AiConfigurationModule],
  controllers: [AiConfigurationController, TestIdentitiesController, AgentRunController] })
export class AgentRuntimeModule {}
