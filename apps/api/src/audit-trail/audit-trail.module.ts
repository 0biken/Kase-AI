import { Global, Module } from '@nestjs/common';
import { AuditTrailService } from './audit-trail.service';

@Global()
@Module({
  providers: [AuditTrailService],
  exports: [AuditTrailService],
})
export class AuditTrailModule {}
