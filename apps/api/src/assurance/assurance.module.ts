import { Module } from '@nestjs/common';
import { GatePolicyController } from './policy/gate-policy.controller';
import { GatePolicyService } from './policy/gate-policy.service';
import { GateEvaluationService } from './gate/gate-evaluation.service';
import { FailClosedReplayVerifier, REPLAY_VERIFIER } from './gate/replay-verifier';

/**
 * M6 — Release Assurance. Gate-policy CRUD/versioning plus the gate evaluation
 * service. The replay verifier is bound to its fail-closed default until the
 * live HTTP re-issue adapter lands; waivers, report, and integrations follow
 * per M6-PLAN.md. PrismaModule and AuditTrailModule are global.
 */
@Module({
  controllers: [GatePolicyController],
  providers: [
    GatePolicyService,
    GateEvaluationService,
    { provide: REPLAY_VERIFIER, useClass: FailClosedReplayVerifier },
  ],
  exports: [GatePolicyService, GateEvaluationService],
})
export class AssuranceModule {}
