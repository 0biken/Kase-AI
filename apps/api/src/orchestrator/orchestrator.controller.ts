import { Body, Controller, Headers, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { OrchestratorService } from './orchestrator.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import type { Actor } from '../projects/projects.service';
import { isId } from '../common/ids';
import { ProblemException } from '../common/problem-details';

@Controller('projects/:projectId/audits')
@ProjectScope('projectId')
export class OrchestratorController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Post()
  @Roles('operator', 'admin')
  @HttpCode(HttpStatus.ACCEPTED)
  dispatch(
    @Param('projectId') projectId: string,
    @Body() dto: CreateAuditDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @CurrentActor() actor: Actor,
  ) {
    if (!isId('project', projectId)) throw new ProblemException('NOT_FOUND', 'Invalid project id');
    if (!isId('target', dto.targetId)) throw new ProblemException('NOT_FOUND', 'Invalid target id');
    return this.orchestrator.dispatch(projectId, dto, idempotencyKey, actor);
  }
}
