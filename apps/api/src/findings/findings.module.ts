import { Module } from '@nestjs/common';
import { FindingsController, FlatFindingsController } from './findings.controller';
import { FindingsService } from './findings.service';
import { FindingPersistenceService } from './finding-persistence.service';

@Module({
  controllers: [FindingsController, FlatFindingsController],
  providers: [FindingsService, FindingPersistenceService],
  exports: [FindingPersistenceService],
})
export class FindingsModule {}
