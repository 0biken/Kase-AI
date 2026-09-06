import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { AuditTrailModule } from '../audit-trail/audit-trail.module';
import { RetentionModule } from './retention.module';
import { RetentionRunnerService } from './retention-runner.service';

@Module({
  imports: [PrismaModule, StorageModule, AuditTrailModule, RetentionModule],
  providers: [RetentionRunnerService],
})
export class RetentionWorkerModule {}
