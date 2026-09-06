import { Module } from '@nestjs/common';
import { ProjectEvidencePolicyController } from './retention.controller';
import { RetentionPolicyService } from './retention-policy.service';
import { RetentionObjectStoreService } from './retention-object-store.service';
import { RetentionWorkerService } from './retention-worker.service';

@Module({
  controllers: [ProjectEvidencePolicyController],
  providers: [RetentionPolicyService, RetentionObjectStoreService, RetentionWorkerService],
  exports: [RetentionPolicyService, RetentionWorkerService],
})
export class RetentionModule {}
