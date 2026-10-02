import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query } from '@nestjs/common';
import { WaiverService } from './waiver.service';
import { SuppressionService } from './suppression.service';
import { SuppressionInputDto, WaiverInputDto } from './dto/waiver.dto';
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

/**
 * Waiver and suppression routes, nested under a project. Project-scoped;
 * creating either requires `admin`. Reads are available to any member.
 */
@Controller('projects')
@ProjectScope('id')
export class WaiversController {
  constructor(
    private readonly waivers: WaiverService,
    private readonly suppressions: SuppressionService,
  ) {}

  @Get(':id/waivers')
  listWaivers(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.waivers.list(assertProjectId(id), query);
  }

  @Post(':id/waivers')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  createWaiver(@Param('id') id: string, @Body() dto: WaiverInputDto, @CurrentActor() actor: Actor) {
    return this.waivers.create(assertProjectId(id), dto, actor);
  }

  @Get(':id/suppressions')
  listSuppressions(@Param('id') id: string, @Query() query: PaginationQueryDto) {
    return this.suppressions.list(assertProjectId(id), query);
  }

  @Post(':id/suppressions')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  createSuppression(@Param('id') id: string, @Body() dto: SuppressionInputDto, @CurrentActor() actor: Actor) {
    return this.suppressions.create(assertProjectId(id), dto, actor);
  }
}
