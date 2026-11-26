import { Module } from '@nestjs/common';
import { FindingsController, FlatFindingsController } from './findings.controller';
import { FindingsService } from './findings.service';
import { FindingPersistenceService } from './finding-persistence.service';
import { SecurityAuditImportController } from './security-audit-import.controller';
import { SecurityAuditImportService } from './security-audit-import.service';
import { FindingReviewController } from './finding-review.controller';
import { DedupService, LifecycleService } from './finding-review.service';
import { EvidenceModule } from '../evidence/evidence.module';
import { RetentionModule } from '../retention/retention.module';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [EvidenceModule, RetentionModule, StorageModule],
  controllers: [FindingsController, FlatFindingsController, SecurityAuditImportController, FindingReviewController],
  providers: [FindingsService, FindingPersistenceService, SecurityAuditImportService, DedupService, LifecycleService],
  exports: [FindingPersistenceService, DedupService, LifecycleService],
})
export class FindingsModule {}
