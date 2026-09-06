import { Module } from '@nestjs/common';
import { AuditEventsController, FlatAuditEventsController } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';

@Module({
  controllers: [AuditEventsController, FlatAuditEventsController],
  providers: [AuditEventsService],
  exports: [AuditEventsService],
})
export class AuditEventsModule {}
