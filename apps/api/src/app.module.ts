import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { OrchestratorModule } from './orchestrator/orchestrator.module';
import { EvidenceModule } from './evidence/evidence.module';
import { CorrelationModule } from './correlation/correlation.module';
import { AssuranceModule } from './assurance/assurance.module';
import { QueueModule } from './queue/queue.module';
import { PrismaModule } from './prisma/prisma.module';
import { StorageModule } from './storage/storage.module';
import { AuditTrailModule } from './audit-trail/audit-trail.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { TokensModule } from './tokens/tokens.module';
import { SecretsModule } from './secrets/secrets.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { FindingsModule } from './findings/findings.module';
import { ReconModule } from './recon/recon.module';

@Module({
  imports: [
    PrismaModule,
    AuditTrailModule,
    // AuthModule registers the global guards — it must be imported before
    // any module whose routes depend on being protected by them.
    AuthModule,
    QueueModule,
    StorageModule,
    OrchestratorModule,
    EvidenceModule,
    FindingsModule,
    ReconModule,
    CorrelationModule,
    AssuranceModule,
    ProjectsModule,
    TokensModule,
    SecretsModule,
    OrganizationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
