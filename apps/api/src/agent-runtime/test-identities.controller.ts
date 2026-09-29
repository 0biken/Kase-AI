import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { z } from 'zod';
import { PrismaService } from '../prisma/prisma.service';
import { ProjectScope } from '../auth/project-scope.decorator';
import { Roles } from '../auth/roles.decorator';
import { CurrentActor } from '../auth/current-actor.decorator';
import type { Actor } from '../projects/projects.service';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem-details';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
const createSchema = z.object({ targetId: z.string().min(1), label: z.string().min(1).max(100), credentialSecretId: z.string().min(1) }).strict();
const view = { id: true, projectId: true, targetId: true, label: true, active: true, createdAt: true } as const;
@Controller('projects/:projectId/test-identities')
@ProjectScope('projectId')
export class TestIdentitiesController {
  constructor(private readonly prisma: PrismaService, private readonly trail: AuditTrailService) {}
  @Get()
  async getIdentities(@Param('projectId') projectId: string) {
    return { data: await this.prisma.testIdentity.findMany({ where: { projectId }, select: view, orderBy: { createdAt: 'asc' } }) };
  }
  @Post()
  @Roles('admin')
  async create(@Param('projectId') projectId: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    const parsed = createSchema.safeParse(body);
    if (!parsed.success) throw new ProblemException('VALIDATION_FAILED', 'Invalid test identity');
    const input = parsed.data;
    const target = await this.prisma.target.findFirst({ where: { id: input.targetId, projectId } });
    const secret = await this.prisma.secret.findFirst({ where: { id: input.credentialSecretId, projectId, revokedAt: null, kind: 'target_header' } });
    if (!target || !secret) throw new ProblemException('VALIDATION_FAILED', 'Target and active header credential must belong to this project');
    const data = await this.prisma.testIdentity.create({ data: { id: newId('testIdentity'), projectId, ...input, createdBy: actor.id ?? actor.type }, select: view });
    await this.trail.record({ projectId, actorType: actor.type, actorId: actor.id, action: 'test_identity.create', resourceType: 'TestIdentity', resourceId: data.id, outcome: 'allowed' });
    return { data };
  }
  @Patch(':identityId')
  @Roles('admin')
  async deactivate(@Param('projectId') projectId: string, @Param('identityId') identityId: string, @Body() body: unknown, @CurrentActor() actor: Actor) {
    if (!z.object({ active: z.literal(false) }).strict().safeParse(body).success) throw new ProblemException('VALIDATION_FAILED', 'Only deactivation is supported');
    const updated = await this.prisma.testIdentity.updateMany({ where: { id: identityId, projectId }, data: { active: false } });
    if (!updated.count) throw new ProblemException('NOT_FOUND', 'Test identity does not belong to this project');
    await this.trail.record({ projectId, actorType: actor.type, actorId: actor.id, action: 'test_identity.deactivate', resourceType: 'TestIdentity', resourceId: identityId, outcome: 'allowed' });
    return { data: await this.prisma.testIdentity.findFirst({ where: { id: identityId, projectId }, select: view }) };
  }
}

