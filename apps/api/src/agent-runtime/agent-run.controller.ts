import { Controller, Get, Param } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectScope } from '../auth/project-scope.decorator';
import { ProblemException } from '../common/problem-details';
@Controller('projects/:projectId/audits/:auditId/agent-runs')
@ProjectScope('projectId')
export class AgentRunController {
  constructor(private readonly prisma: PrismaService) {}
  @Get()
  async getRuns(@Param('projectId') projectId: string, @Param('auditId') auditId: string) {
    if (!await this.prisma.audit.findFirst({ where: { id: auditId, projectId }, select: { id: true } }))
      throw new ProblemException('NOT_FOUND', 'Audit does not belong to this project');
    return { data: await this.prisma.agentRun.findMany({ where: { auditId }, orderBy: { startedAt: 'desc' } }) };
  }
}

