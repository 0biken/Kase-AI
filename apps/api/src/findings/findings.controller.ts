import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditScope, ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import { FindingsService } from './findings.service';
import { resolvedProjectId } from '../auth/resolved-project-id';

@Controller('projects/:projectId/audits/:auditId/findings')
@ProjectScope('projectId')
@Roles('viewer', 'operator', 'approver', 'admin')
export class FindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Get()
  list(
    @Param('projectId') projectId: string,
    @Param('auditId') auditId: string,
    @Query('severity') severity?: string,
    @Query('category') category?: string,
    @Query('gateEligible') gateEligible?: string,
  ) {
    return this.findings.list(projectId, auditId, { severity, category, gateEligible });
  }

  @Get(':findingId')
  detail(@Param('projectId') projectId: string, @Param('auditId') auditId: string, @Param('findingId') findingId: string) {
    return this.findings.detail(projectId, auditId, findingId);
  }
}

@Controller('audits/:auditId/findings')
@AuditScope('auditId')
@Roles('viewer', 'operator', 'approver', 'admin')
export class FlatFindingsController {
  constructor(private readonly findings: FindingsService) {}

  @Get()
  list(
    @Param('auditId') auditId: string,
    @Req() request: Request,
    @Query('severity') severity?: string,
    @Query('category') category?: string,
    @Query('gateEligible') gateEligible?: string,
  ) {
    return this.findings.list(resolvedProjectId(request), auditId, { severity, category, gateEligible });
  }

  @Get(':findingId')
  detail(@Param('auditId') auditId: string, @Param('findingId') findingId: string, @Req() request: Request) {
    return this.findings.detail(resolvedProjectId(request), auditId, findingId);
  }
}
