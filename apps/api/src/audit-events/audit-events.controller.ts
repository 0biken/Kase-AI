import { Controller, Headers, Param, Req, Sse } from '@nestjs/common';
import type { Request } from 'express';
import type { MessageEvent } from '@nestjs/common';
import type { Observable } from 'rxjs';
import { AuditScope, ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import { AuditEventsService } from './audit-events.service';
import { resolvedProjectId } from '../auth/resolved-project-id';

@Controller('projects/:projectId/audits/:auditId/events')
@ProjectScope('projectId')
export class AuditEventsController {
  constructor(private readonly events: AuditEventsService) {}

  @Sse()
  @Roles('viewer', 'operator', 'approver', 'admin')
  stream(
    @Param('projectId') projectId: string,
    @Param('auditId') auditId: string,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    return this.events.streamForProject(projectId, auditId, parseLastEventId(lastEventId));
  }
}

@Controller('audits/:auditId/events')
@AuditScope('auditId')
export class FlatAuditEventsController {
  constructor(private readonly events: AuditEventsService) {}

  @Sse()
  @Roles('viewer', 'operator', 'approver', 'admin')
  stream(
    @Param('auditId') auditId: string,
    @Req() request: Request,
    @Headers('last-event-id') lastEventId?: string,
  ): Observable<MessageEvent> {
    return this.events.streamForProject(
      resolvedProjectId(request),
      auditId,
      parseLastEventId(lastEventId),
    );
  }
}

export function parseLastEventId(value?: string): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}
