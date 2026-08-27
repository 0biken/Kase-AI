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
import { ProjectsService, type Actor } from './projects.service';
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
import { CurrentActor } from '../auth/current-actor.decorator';
import { OrgScope, ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';

function assertProjectId(id: string): string {
  if (!isId('project', id)) {
    throw new ProblemException('NOT_FOUND', `"${id}" is not a valid project id`);
  }
  return id;
}

/**
 * `@ProjectScope('id')` at the class level covers every route below —
 * every one of them is nested under `/:id`. `create` and `list` override it
 * with `@OrgScope()`: a project cannot be project-scoped before it exists,
 * and listing is inherently organization-wide.
 *
 * Reads carry no `@Roles()`, which means "any project member" — 14 §2 gives
 * `viewer` read access, and ProjectScopeGuard already proved membership.
 * Every mutation requires `admin`: 14 §2 puts "manage projects, scope
 * policies, gate policies, integrations" under admin specifically.
 */
@Controller('projects')
@ProjectScope('id')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}

  @Post()
  @OrgScope()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateProjectDto, @CurrentActor() actor: Actor) {
    return this.projects.create(dto, actor);
  }

  @Get()
  @OrgScope()
  list(@Query() query: PaginationQueryDto, @CurrentActor() actor: Actor) {
    const orgId = actor.organizationId;
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
  @Roles('admin')
  update(@Param('id') id: string, @Body() dto: UpdateProjectDto, @CurrentActor() actor: Actor) {
    return this.projects.update(assertProjectId(id), dto, actor);
  }

  @Delete(':id')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') id: string, @CurrentActor() actor: Actor) {
    await this.projects.remove(assertProjectId(id), actor);
  }

  // --------------------------------------------------------- scope policy

  @Get(':id/scope-policy')
  getScopePolicy(@Param('id') id: string) {
    return this.projects.getScopePolicy(assertProjectId(id));
  }

  /** PUT, not PATCH — 14-api §4 defines this as a full replace. */
  @Put(':id/scope-policy')
  @Roles('admin')
  replaceScopePolicy(
    @Param('id') id: string,
    @Body() dto: ReplaceScopePolicyDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.projects.replaceScopePolicy(assertProjectId(id), dto, actor);
  }

  // ----------------------------------------------------------- repositories

  @Get(':id/repositories')
  listRepositories(@Param('id') id: string) {
    return this.projects.listRepositories(assertProjectId(id));
  }

  @Post(':id/repositories')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  createRepository(
    @Param('id') id: string,
    @Body() dto: RepositoryInputDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.projects.createRepository(assertProjectId(id), dto, actor);
  }

  @Patch(':id/repositories/:repositoryId')
  @Roles('admin')
  updateRepository(
    @Param('id') id: string,
    @Param('repositoryId') repositoryId: string,
    @Body() dto: UpdateRepositoryDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.projects.updateRepository(assertProjectId(id), repositoryId, dto, actor);
  }

  @Delete(':id/repositories/:repositoryId')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeRepository(
    @Param('id') id: string,
    @Param('repositoryId') repositoryId: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.projects.removeRepository(assertProjectId(id), repositoryId, actor);
  }

  // ---------------------------------------------------------------- targets

  @Get(':id/targets')
  listTargets(@Param('id') id: string) {
    return this.projects.listTargets(assertProjectId(id));
  }

  @Post(':id/targets')
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  createTarget(@Param('id') id: string, @Body() dto: TargetInputDto, @CurrentActor() actor: Actor) {
    return this.projects.createTarget(assertProjectId(id), dto, actor);
  }

  @Patch(':id/targets/:targetId')
  @Roles('admin')
  updateTarget(
    @Param('id') id: string,
    @Param('targetId') targetId: string,
    @Body() dto: UpdateTargetDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.projects.updateTarget(assertProjectId(id), targetId, dto, actor);
  }

  @Delete(':id/targets/:targetId')
  @Roles('admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removeTarget(
    @Param('id') id: string,
    @Param('targetId') targetId: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.projects.removeTarget(assertProjectId(id), targetId, actor);
  }
}
