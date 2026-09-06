import { Controller, Get, Param, Req, StreamableFile } from '@nestjs/common';
import type { Request } from 'express';
import { AuditScope, ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentActor } from '../auth/current-actor.decorator';
import type { Actor } from '../projects/projects.service';
import { EvidenceService } from './evidence.service';
import { resolvedProjectId } from '../auth/resolved-project-id';

@Controller('projects/:projectId/audits/:auditId/evidence')
@ProjectScope('projectId')
@Roles('viewer', 'operator', 'approver', 'admin')
export class EvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get()
  list(@Param('projectId') projectId: string, @Param('auditId') auditId: string) {
    return this.evidence.list(projectId, auditId);
  }

  @Get(':evidenceId')
  metadata(@Param('projectId') projectId: string, @Param('auditId') auditId: string, @Param('evidenceId') evidenceId: string) {
    return this.evidence.metadata(projectId, auditId, evidenceId);
  }

  @Get(':evidenceId/download')
  async download(
    @Param('projectId') projectId: string,
    @Param('auditId') auditId: string,
    @Param('evidenceId') evidenceId: string,
    @CurrentActor() actor: Actor,
  ) {
    return new StreamableFile(await this.evidence.download(projectId, auditId, evidenceId, actor), {
      type: 'application/octet-stream',
    });
  }
}

@Controller('audits/:auditId/evidence')
@AuditScope('auditId')
@Roles('viewer', 'operator', 'approver', 'admin')
export class FlatEvidenceController {
  constructor(private readonly evidence: EvidenceService) {}

  @Get()
  list(@Param('auditId') auditId: string, @Req() request: Request) {
    return this.evidence.list(resolvedProjectId(request), auditId);
  }

  @Get(':evidenceId')
  metadata(@Param('auditId') auditId: string, @Param('evidenceId') evidenceId: string, @Req() request: Request) {
    return this.evidence.metadata(resolvedProjectId(request), auditId, evidenceId);
  }

  @Get(':evidenceId/download')
  async download(
    @Param('auditId') auditId: string,
    @Param('evidenceId') evidenceId: string,
    @Req() request: Request,
    @CurrentActor() actor: Actor,
  ) {
    const bytes = await this.evidence.download(resolvedProjectId(request), auditId, evidenceId, actor);
    return new StreamableFile(bytes, { type: 'application/octet-stream' });
  }
}
