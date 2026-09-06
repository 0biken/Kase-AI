import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { CurrentActor } from '../auth/current-actor.decorator';
import { OrganizationAdminGuard } from '../auth/organization-admin.guard';
import { OrgScope } from '../auth/project-scope.decorator';
import type { Actor } from '../projects/projects.service';
import { OrganizationEvidencePolicyDto } from '../retention/dto/evidence-policy.dto';
import { RetentionPolicyService } from '../retention/retention-policy.service';

@Controller('organizations/:id/evidence-policy')
@OrgScope()
export class OrganizationsController {
  constructor(private readonly policies: RetentionPolicyService) {}

  @Get()
  get(@Param('id') organizationId: string, @CurrentActor() actor: Actor) {
    return this.policies.getOrganizationPolicy(organizationId, actor);
  }

  @Put()
  @UseGuards(OrganizationAdminGuard)
  put(
    @Param('id') organizationId: string,
    @Body() dto: OrganizationEvidencePolicyDto,
    @CurrentActor() actor: Actor,
  ) {
    return this.policies.putOrganizationPolicy(organizationId, dto, actor);
  }
}
