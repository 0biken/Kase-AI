import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { SecretsService } from './secrets.service';
import { CreateSecretDto, RotateSecretDto } from './dto/secret.dto';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import type { Actor } from '../projects/projects.service';
import { isId } from '../common/ids';
import { ProblemException } from '../common/problem-details';

@Controller('projects/:projectId/secrets')
@ProjectScope('projectId')
@Roles('admin')
export class SecretsController {
  constructor(private readonly secrets: SecretsService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('projectId') projectId: string,
    @Body() dto: CreateSecretDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.secrets.create(assertProject(projectId), dto, actor);
  }

  @Get()
  list(@Param('projectId') projectId: string) {
    return this.secrets.list(assertProject(projectId));
  }

  @Post(':secretId/rotate')
  rotate(
    @Param('projectId') projectId: string,
    @Param('secretId') secretId: string,
    @Body() dto: RotateSecretDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.secrets.rotate(assertProject(projectId), assertSecret(secretId), dto, actor);
  }

  @Delete(':secretId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revoke(
    @Param('projectId') projectId: string,
    @Param('secretId') secretId: string,
    @CurrentActor() actor: Actor,
  ) {
    await this.secrets.revoke(assertProject(projectId), assertSecret(secretId), actor);
  }
}

function assertProject(value: string): string {
  if (!isId('project', value)) throw new ProblemException('NOT_FOUND', 'Invalid project id');
  return value;
}

function assertSecret(value: string): string {
  if (!isId('secret', value)) throw new ProblemException('NOT_FOUND', 'Invalid secret id');
  return value;
}
