import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { AuditTrailModule } from '../audit-trail/audit-trail.module';
import { AiConfigurationService } from './ai-configuration.service';
import { MethodologyGuard } from './methodology.guard';
@Module({ imports: [PrismaModule, AuditTrailModule], providers: [AiConfigurationService, MethodologyGuard], exports: [AiConfigurationService, MethodologyGuard] })
export class AiConfigurationModule {}

