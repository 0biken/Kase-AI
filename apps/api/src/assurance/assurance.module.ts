import { Module } from '@nestjs/common';
import { GatePolicyController } from './policy/gate-policy.controller';
import { GatePolicyService } from './policy/gate-policy.service';

/**
 * M6 — Release Assurance. Starts with gate-policy CRUD/versioning; the gate
 * evaluation service, replay verifier, waivers, report, and integrations land
 * on top per M6-PLAN.md. PrismaModule and AuditTrailModule are global.
 */
@Module({
  controllers: [GatePolicyController],
  providers: [GatePolicyService],
  exports: [GatePolicyService],
})
export class AssuranceModule {}
