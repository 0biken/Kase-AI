import { Controller, Get, Param, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuditScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import { resolvedProjectId } from '../auth/resolved-project-id';
import { InventoryQueryService } from './inventory-query.service';

@Controller('audits/:auditId/inventory')
@AuditScope('auditId')
@Roles('viewer', 'operator', 'approver', 'admin')
export class InventoryController {
  constructor(private readonly inventories: InventoryQueryService) {}

  @Get()
  get(
    @Param('auditId') auditId: string,
    @Req() request: Request,
    @Query('method') method?: string,
    @Query('path') path?: string,
    @Query('source') source?: string,
    @Query('statusClass') statusClass?: string,
    @Query('technology') technology?: string,
    @Query('drift') drift?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.inventories.get(resolvedProjectId(request), auditId, { method, path, source, statusClass, technology, drift, cursor, limit });
  }
}
