import { Body, Controller, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import { resolvedProjectId } from '../auth/resolved-project-id';
import { isId } from '../common/ids';
import { ProblemException } from '../common/problem-details';
import { SecurityAuditImportService } from './security-audit-import.service';

/** Importing findings is a privileged write (operator/admin), keyed on a flat audit id for CLI/CI use. */
@Controller('audits/:auditId/import/security-audit')
@AuditScope('auditId')
export class SecurityAuditImportController {
  constructor(private readonly importer: SecurityAuditImportService) {}

  @Post()
  @Roles('operator', 'admin')
  @HttpCode(HttpStatus.OK)
  import(@Param('auditId') auditId: string, @Body() body: unknown, @Req() request: Request) {
    if (!isId('audit', auditId)) throw new ProblemException('NOT_FOUND', `"${auditId}" is not a valid audit id`);
    return this.importer.import(resolvedProjectId(request), auditId, body);
  }
}
