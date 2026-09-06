import { Module } from '@nestjs/common';
import { AuditEventsModule } from '../audit-events/audit-events.module';
import { AuditSchedulerService } from './audit-scheduler.service';
import { SchedulerWorkerService } from './scheduler-worker.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';

@Module({
  imports: [PrismaModule, QueueModule, AuditEventsModule],
  providers: [AuditSchedulerService, SchedulerWorkerService],
})
export class SchedulerModule {}
