import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { TokensService } from './tokens.service';
import { CreateApiTokenDto } from './dto/api-token.dto';
import type { Actor } from '../projects/projects.service';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import { ProblemException } from '../common/problem-details';
import { isId } from '../common/ids';

function assertProjectId(id: string): string {
  if (!isId('project', id)) {
    throw new ProblemException('NOT_FOUND', `"${id}" is not a valid project id`);
  }
  return id;
}

/**
 * 14-api §2: tokens are project-scoped and carry a role. Managing them is an
 * `admin` action ("manage projects, ..., integrations") on every route,
 * including listing — a token's `displayPrefix` alone is still information
 * about who can act as what on this project.
 */
@Controller('projects/:id/tokens')
@ProjectScope('id')
@Roles('admin')
export class TokensController {
  constructor(private readonly tokens: TokensService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Param('id') id: string, @Body() dto: CreateApiTokenDto, @CurrentActor() actor: Actor) {
    return this.tokens.create(assertProjectId(id), dto, actor);
  }

  @Get()
  list(@Param('id') id: string) {
    return this.tokens.list(assertProjectId(id));
  }

  @Delete(':tokenId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('id') id: string,
    @Param('tokenId') tokenId: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.tokens.revoke(assertProjectId(id), tokenId, actor);
  }
}
