import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { CurrentActor } from '../auth/current-actor.decorator';
import { AuditScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import type { Actor } from '../projects/projects.service';
import { AuditCancellationService } from './audit-cancellation.service';

@Controller('audits')
@AuditScope('auditId')
export class AuditCancellationController {
  constructor(private readonly cancellation: AuditCancellationService) {}

  @Post(':auditId/cancel')
  @Roles('operator', 'admin')
  @HttpCode(HttpStatus.ACCEPTED)
  cancel(@Param('auditId') auditId: string, @CurrentActor() actor: Actor) {
    return this.cancellation.cancel(auditId, actor);
  }
}
