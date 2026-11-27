import { Controller, Get, Header, Param, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { isId } from '../../common/ids';
import { ProblemException } from '../../common/problem-details';
import { AuditScope } from '../../auth/project-scope.decorator';
import { Roles } from '../../auth/roles.decorator';
import { reportToMarkdown } from './report-builder';
import { ReportService } from './report.service';

function assertAuditId(id: string): string {
  if (!isId('audit', id)) throw new ProblemException('NOT_FOUND', `"${id}" is not a valid audit id`);
  return id;
}

/**
 * `GET /audits/:auditId/report?format=json|markdown` (14-api §9). JSON carries
 * every file separately so the CLI can write the report folder; markdown is
 * the same files concatenated. HTML is specified but not built yet.
 */
@Controller('audits/:auditId/report')
@AuditScope('auditId')
export class ReportController {
  constructor(private readonly reports: ReportService) {}

  @Get()
  @Roles('viewer', 'operator', 'approver', 'admin')
  @Header('Cache-Control', 'no-store')
  async get(@Param('auditId') auditId: string, @Res({ passthrough: true }) res: Response, @Query('format') format = 'json') {
    if (format !== 'json' && format !== 'markdown') {
      throw new ProblemException('VALIDATION_FAILED', `Unsupported report format "${format}"; use json or markdown`);
    }
    const report = await this.reports.build(assertAuditId(auditId));
    if (format === 'json') return report;
    res.type('text/markdown; charset=utf-8');
    return reportToMarkdown(report);
  }
}
