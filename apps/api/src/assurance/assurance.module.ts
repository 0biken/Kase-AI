import { Module } from '@nestjs/common';
import { GatePolicyController } from './policy/gate-policy.controller';
import { GatePolicyService } from './policy/gate-policy.service';
import { GateEvaluationService } from './gate/gate-evaluation.service';
import { FailClosedReplayVerifier, REPLAY_VERIFIER } from './gate/replay-verifier';
import { WaiversController } from './waivers/waivers.controller';
import { WaiverService } from './waivers/waiver.service';
import { SuppressionService } from './waivers/suppression.service';

/**
 * M6 — Release Assurance. Gate-policy CRUD/versioning, the gate evaluation
 * service, and waiver/suppression management. The replay verifier is bound to
 * its fail-closed default until the live HTTP re-issue adapter lands; the
 * report and integrations follow per M6-PLAN.md. PrismaModule and
 * AuditTrailModule are global.
 */
@Module({
  controllers: [GatePolicyController, WaiversController],
  providers: [
    GatePolicyService,
    GateEvaluationService,
    WaiverService,
    SuppressionService,
    { provide: REPLAY_VERIFIER, useClass: FailClosedReplayVerifier },
  ],
  exports: [GatePolicyService, GateEvaluationService, WaiverService, SuppressionService],
})
export class AssuranceModule {}
