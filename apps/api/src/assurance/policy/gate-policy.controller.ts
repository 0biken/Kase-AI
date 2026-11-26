import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { GatePolicyService } from './gate-policy.service';
import { GatePolicyInputDto } from './dto/gate-policy.dto';
import { PaginationQueryDto } from '../../common/pagination';
import { ProblemException } from '../../common/problem-details';
import { isId } from '../../common/ids';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { ProjectScope } from '../../auth/project-scope.decorator';
import { Roles } from '../../auth/roles.decorator';
import type { Actor } from '../../projects/projects.service';

function assertProjectId(id: string): string {
  if (!isId('project', id)) throw new ProblemException('NOT_FOUND', `"${id}" is not a valid project id`);
  return id;
}

function assertVersion(raw: string): number {
  const v = Number(raw);
  if (!Number.isInteger(v) || v < 1) throw new ProblemException('NOT_FOUND', `"${raw}" is not a valid gate policy version`);
  return v;
}

/**
 * Gate-policy routes, nested under a project. `@ProjectScope('id')` proves
 * membership on every route; reads carry no `@Roles` (any member, per 14-api
 * §2), and creating a version requires `admin` — 14-api §2 puts "manage gate
 * policies" under admin. The active-policy read uses the singular
 * `/gate-policy`, which keeps it from colliding with `/gate-policies/:version`.
 */
@Controller('projects')
@ProjectScope('id')
export class GatePolicyController {
  constructor(private readonly policies: GatePolicyService) {}

  @Get(':id/gate-policy')
  getActive(@Param('id') id: string) {
    return this.policies.getActive(assertProjectId(id));
  }

  @Get(':id/gate-policies')
  list(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.policies.list(assertProjectId(id), query);
  }

  @Get(':id/gate-policies/:version')
  getVersion(@Param('id') id: string, @Param('version') version: string) {
    return this.policies.getVersion(assertProjectId(id), assertVersion(version));
  }

  @Post(':id/gate-policies')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Param('id') id: string, @Body() dto: GatePolicyInputDto, @CurrentActor() actor: Actor) {
    return this.policies.create(assertProjectId(id), dto.rules, actor);
  }
}
