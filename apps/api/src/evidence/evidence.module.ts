import { Module } from '@nestjs/common';
import { RetentionModule } from '../retention/retention.module';
import { EvidenceCaptureService } from './evidence-capture.service';
import { EvidenceController, FlatEvidenceController } from './evidence.controller';
import { EvidenceService } from './evidence.service';

@Module({
  imports: [RetentionModule],
  controllers: [EvidenceController, FlatEvidenceController],
  providers: [EvidenceCaptureService, EvidenceService],
  exports: [EvidenceCaptureService],
})
export class EvidenceModule {}
