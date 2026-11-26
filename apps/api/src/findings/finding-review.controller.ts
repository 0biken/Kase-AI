import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Query, Req } from '@nestjs/common';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import type { Request } from 'express';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import type { Role } from '../auth/roles';
import { isId } from '../common/ids';
import { ProblemException } from '../common/problem-details';
import type { Actor } from '../projects/projects.service';
import { DedupService, LifecycleService } from './finding-review.service';
import type { Decision } from './lifecycle';

export class DedupDecisionDto {
  @IsIn(['confirm', 'reject'])
  decision!: 'confirm' | 'reject';

  @IsString() @MinLength(3) @MaxLength(2000)
  rationale!: string;
}

export class FindingTransitionDto {
  @IsIn(['false_positive', 'accepted_risk', 'reopen', 'confirm_fixed'])
  decision!: Decision;

  @IsString() @MinLength(3) @MaxLength(2000)
  reason!: string;
}

function projectId(id: string): string {
  if (!isId('project', id)) throw new ProblemException('NOT_FOUND', `"${id}" is not a valid project id`);
  return id;
}

function roleOf(request: Request): Role | undefined {
  return (request as Request & { principal?: { role?: Role } }).principal?.role;
}

/**
 * The POSSIBLE_MATCH review queue and finding lifecycle decisions. Reading the
 * queue is open to members; deciding needs `approver` or `admin`. Which
 * lifecycle decision a role may make is enforced again by the service.
 */
@Controller('projects')
@ProjectScope('id')
export class FindingReviewController {
  constructor(private readonly dedup: DedupService, private readonly lifecycle: LifecycleService) {}

  @Get(':id/dedup-queue')
  @Roles('viewer', 'operator', 'approver', 'admin')
  queue(@Param('id') id: string, @Query('limit') limit?: string) {
    return this.dedup.queue(projectId(id), limit ? Number.parseInt(limit, 10) || 50 : 50);
  }

  @Post(':id/dedup-queue/:relationId/decision')
  @Roles('approver', 'admin')
  @HttpCode(HttpStatus.OK)
  decide(@Param('id') id: string, @Param('relationId') relationId: string, @Body() dto: DedupDecisionDto, @CurrentActor() actor: Actor) {
    return this.dedup.decide(projectId(id), relationId, dto, actor);
  }

  @Post(':id/finding-identities/:identityId/transition')
  @Roles('operator', 'approver', 'admin')
  @HttpCode(HttpStatus.OK)
  transition(@Param('id') id: string, @Param('identityId') identityId: string, @Body() dto: FindingTransitionDto,
    @CurrentActor() actor: Actor, @Req() request: Request) {
    return this.lifecycle.decide(projectId(id), identityId, dto, actor, roleOf(request));
  }
}
