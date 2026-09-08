import { Module } from '@nestjs/common';
import { AuditEventsModule } from '../audit-events/audit-events.module';
import { AuditSchedulerService } from './audit-scheduler.service';
import { SchedulerWorkerService } from './scheduler-worker.service';
import { PrismaModule } from '../prisma/prisma.module';
import { QueueModule } from '../queue/queue.module';
import { ReconBudgetService } from '../recon/recon-budget.service';

@Module({
  imports: [PrismaModule, QueueModule, AuditEventsModule],
  providers: [ReconBudgetService, AuditSchedulerService, SchedulerWorkerService],
})
export class SchedulerModule {}
