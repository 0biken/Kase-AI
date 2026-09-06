import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { CurrentActor } from '../auth/current-actor.decorator';
import { ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import type { Actor } from '../projects/projects.service';
import { ProjectEvidencePolicyDto } from './dto/evidence-policy.dto';
import { RetentionPolicyService } from './retention-policy.service';

@Controller('projects/:id/evidence-policy')
@ProjectScope('id')
export class ProjectEvidencePolicyController {
  constructor(private readonly policies: RetentionPolicyService) {}

  @Get()
  get(@Param('id') projectId: string) {
    return this.policies.getProjectPolicy(projectId);
  }

  @Put()
  @Roles('admin')
  put(
    @Param('id') projectId: string,
    @Body() dto: ProjectEvidencePolicyDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.policies.putProjectPolicy(projectId, dto, actor);
  }
}
