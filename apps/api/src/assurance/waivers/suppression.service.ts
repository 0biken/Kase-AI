import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditTrailService, diffOf } from '../../audit-trail/audit-trail.service';
import { newId } from '../../common/ids';
import { ProblemException } from '../../common/problem-details';
import { PaginationQueryDto, paginationArgs, toPage, type Page } from '../../common/pagination';
import type { Actor } from '../../projects/projects.service';
import type { SuppressionInputDto } from './dto/waiver.dto';

/**
 * Suppressions (12-policy-gate §9). Fingerprint-keyed and durable: a confirmed
 * false positive does not return and re-flap the gate. Normally fed by the
 * `false_positive` finding status; this write API records one directly.
 */
@Injectable()
export class SuppressionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrailService,
  ) {}

  async create(projectId: string, dto: SuppressionInputDto, actor: Actor): Promise<unknown> {
    await this.assertProjectExists(projectId);

    const id = newId('suppression');
    const created = await this.prisma.suppression.create({
      data: { id, projectId, fingerprint: dto.fingerprint, markedBy: actor.id ?? 'unknown', reason: dto.reason },
    });

    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'suppression.create',
      resourceType: 'Suppression',
      resourceId: id,
      diff: diffOf(null, created as never),
      metadata: { fingerprint: dto.fingerprint },
      outcome: 'allowed',
    });

    return created;
  }

  async list(projectId: string, query: PaginationQueryDto): Promise<Page<{ id: string }>> {
    await this.assertProjectExists(projectId);
    const rows = await this.prisma.suppression.findMany({ where: { projectId }, ...paginationArgs(query) });
    return toPage(rows, query);
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    const exists = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!exists) throw new ProblemException('NOT_FOUND', `No project with id "${projectId}"`);
  }
}
