import { Controller, Get, Put, Body, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentActor } from '../auth/current-actor.decorator';
import type { Actor } from '../projects/projects.service';
import { AiConfigurationService } from './ai-configuration.service';
@Controller('projects/:projectId/ai-configuration')
@ProjectScope('projectId')
export class AiConfigurationController {
  constructor(private readonly prisma: PrismaService, private readonly configurations: AiConfigurationService) {}
  @Get()
  async getConfiguration(@Param('projectId') projectId: string) {
    return { data: await this.prisma.projectAiConfiguration.findUnique({ where: { projectId } }) };
  }
  @Put()
  @Roles('admin')
  async updateConfiguration(@Param('projectId') projectId: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    return { data: await this.configurations.put(projectId, body, actor) };
  }
}

