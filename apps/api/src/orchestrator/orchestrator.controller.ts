import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { OrchestratorService } from './orchestrator.service';
import { CreateAuditDto } from './dto/create-audit.dto';
import { CurrentActor } from '../auth/current-actor.decorator';
import { AuditScope, ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import type { Actor } from '../projects/projects.service';
import { isId } from '../common/ids';
import { ProblemException } from '../common/problem-details';
import { resolvedProjectId } from '../auth/resolved-project-id';

@Controller('projects/:projectId/audits')
@ProjectScope('projectId')
export class OrchestratorController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Get()
  @Roles('viewer', 'operator', 'approver', 'admin')
  list(@Param('projectId') projectId: string) {
    return this.orchestrator.list(projectId);
  }

  @Get(':auditId')
  @Roles('viewer', 'operator', 'approver', 'admin')
  detail(@Param('projectId') projectId: string, @Param('auditId') auditId: string) {
    return this.orchestrator.detail(projectId, auditId);
  }

  @Get(':auditId/jobs')
  @Roles('viewer', 'operator', 'approver', 'admin')
  jobs(@Param('projectId') projectId: string, @Param('auditId') auditId: string) {
    return this.orchestrator.jobs(projectId, auditId);
  }

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
    if (dto.targetId && !isId('target', dto.targetId)) throw new ProblemException('NOT_FOUND', 'Invalid target id');
    if (dto.repositoryId && !isId('repository', dto.repositoryId)) throw new ProblemException('NOT_FOUND', 'Invalid repository id');
    return this.orchestrator.dispatch(projectId, dto, idempotencyKey, actor);
  }
}

@Controller('audits')
@AuditScope('auditId')
@Roles('viewer', 'operator', 'approver', 'admin')
export class FlatAuditQueryController {
  constructor(private readonly orchestrator: OrchestratorService) {}

  @Get(':auditId')
  detail(@Param('auditId') auditId: string, @Req() request: Request) {
    return this.orchestrator.detail(resolvedProjectId(request), auditId);
  }

  @Get(':auditId/jobs')
  jobs(@Param('auditId') auditId: string, @Req() request: Request) {
    return this.orchestrator.jobs(resolvedProjectId(request), auditId);
  }
}
