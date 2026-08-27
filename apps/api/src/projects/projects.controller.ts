import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ProjectsService, Actor } from './projects.service';
import {
  CreateProjectDto,
  UpdateProjectDto,
  ReplaceScopePolicyDto,
} from './dto/project.dto';
import { RepositoryInputDto, UpdateRepositoryDto } from './dto/repository.dto';
import { TargetInputDto, UpdateTargetDto } from './dto/target.dto';
import { PaginationQueryDto } from '../common/pagination';
import { ProblemException } from '../common/problem-details';
import { isId } from '../common/ids';

/**
 * Placeholder principal.
 *
 * AuthGuard lands in PR B; until then every request is attributed to a system
 * actor bound to a bootstrap organization. This is deliberately a single
 * obvious seam rather than scattered `TODO`s — when the guard exists, this
 * function is replaced by reading `req.principal` and nothing else moves.
 *
 * Nothing here is reachable in a deployed configuration: the module is not
 * mounted without an organization present.
 */
function actorFor(): Actor {
  return {
    type: 'system',
    organizationId: process.env.KASE_BOOTSTRAP_ORG_ID,
  };
}

function assertProjectId(id: string): string {
  if (!isId('project', id)) {
    throw new ProblemException('NOT_FOUND', `"${id}" is not a valid project id`);
  }
  return id;
}

@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProjectDto) {
    return this.projects.create(dto, actorFor());
  }

  @Get()
  list(@Query() query: PaginationQueryDto) {
    const orgId = actorFor().organizationId;
    if (!orgId) {
      throw new ProblemException('FORBIDDEN', 'No organization bound to this principal');
    }
    return this.projects.list(orgId, query);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.projects.findOne(assertProjectId(id));
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto) {
    return this.projects.update(assertProjectId(id), dto, actorFor());
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string) {
    await this.projects.remove(assertProjectId(id), actorFor());
  }

  // --------------------------------------------------------- scope policy

  @Get(':id/scope-policy')
  getScopePolicy(@Param('id') id: string) {
    return this.projects.getScopePolicy(assertProjectId(id));
  }

  /** PUT, not PATCH — 14-api §4 defines this as a full replace. */
  @Put(':id/scope-policy')
  replaceScopePolicy(@Param('id') id: string, @Body() dto: ReplaceScopePolicyDto) {
    return this.projects.replaceScopePolicy(assertProjectId(id), dto, actorFor());
  }

  // ----------------------------------------------------------- repositories

  @Get(':id/repositories')
  listRepositories(@Param('id') id: string) {
    return this.projects.listRepositories(assertProjectId(id));
  }

  @Post(':id/repositories')
  @HttpCode(HttpStatus.CREATED)
  createRepository(@Param('id') id: string, @Body() dto: RepositoryInputDto) {
    return this.projects.createRepository(assertProjectId(id), dto, actorFor());
  }

  @Patch(':id/repositories/:repositoryId')
  updateRepository(
    @Param('id') id: string,
    @Param('repositoryId') repositoryId: string,
    @Body() dto: UpdateRepositoryDto,
  ) {
    return this.projects.updateRepository(assertProjectId(id), repositoryId, dto, actorFor());
  }

  @Delete(':id/repositories/:repositoryId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeRepository(
    @Param('id') id: string,
    @Param('repositoryId') repositoryId: string,
  ) {
    await this.projects.removeRepository(assertProjectId(id), repositoryId, actorFor());
  }

  // ---------------------------------------------------------------- targets

  @Get(':id/targets')
  listTargets(@Param('id') id: string) {
    return this.projects.listTargets(assertProjectId(id));
  }

  @Post(':id/targets')
  @HttpCode(HttpStatus.CREATED)
  createTarget(@Param('id') id: string, @Body() dto: TargetInputDto) {
    return this.projects.createTarget(assertProjectId(id), dto, actorFor());
  }

  @Patch(':id/targets/:targetId')
  updateTarget(
    @Param('id') id: string,
    @Param('targetId') targetId: string,
    @Body() dto: UpdateTargetDto,
  ) {
    return this.projects.updateTarget(assertProjectId(id), targetId, dto, actorFor());
  }

  @Delete(':id/targets/:targetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTarget(@Param('id') id: string, @Param('targetId') targetId: string) {
    await this.projects.removeTarget(assertProjectId(id), targetId, actorFor());
  }
}
