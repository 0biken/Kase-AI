import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { GateEvaluationService } from './gate-evaluation.service';
import { ProblemException } from '../../common/problem-details';
import { isId } from '../../common/ids';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { AuditScope } from '../../auth/project-scope.decorator';
import { Roles } from '../../auth/roles.decorator';
import type { Actor } from '../../projects/projects.service';

function assertAuditId(id: string): string {
  if (!isId('audit', id)) throw new ProblemException('NOT_FOUND', `"${id}" is not a valid audit id`);
  return id;
}

/**
 * Release-gate routes, keyed on a flat audit id for CLI/CI use. `@AuditScope`
 * resolves the owning project before the handler runs. Evaluating is a
 * privileged action (operator/admin); reading the last outcome is open to any
 * member. The project-nested read for the dashboard is an M7 concern.
 */
@Controller('audits/:auditId/gate')
@AuditScope('auditId')
export class GateController {
  constructor(private readonly gate: GateEvaluationService) {}

  @Post('evaluate')
  @Roles('operator', 'admin')
  @HttpCode(HttpStatus.OK)
  evaluate(@Param('auditId') auditId: string, @CurrentActor() actor: Actor) {
    return this.gate.evaluate(assertAuditId(auditId), actor);
  }

  @Get()
  @Roles('viewer', 'operator', 'approver', 'admin')
  latest(@Param('auditId') auditId: string) {
    return this.gate.latest(assertAuditId(auditId));
  }
}
