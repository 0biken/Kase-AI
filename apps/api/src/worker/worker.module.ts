import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AuditTrailModule } from '../audit-trail/audit-trail.module';
import { SecretsModule } from '../secrets/secrets.module';
import { ReconWorkerService } from './recon-worker.service';

@Module({
  imports: [PrismaModule, StorageModule, AuditTrailModule, SecretsModule],
  providers: [ReconWorkerService],
})
export class WorkerModule {}
