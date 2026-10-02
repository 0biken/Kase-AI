import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditTrailService, diffOf } from '../../audit-trail/audit-trail.service';
import { newId } from '../../common/ids';
import { ProblemException } from '../../common/problem-details';
import { PaginationQueryDto, paginationArgs, toPage, type Page } from '../../common/pagination';
import type { Actor } from '../../projects/projects.service';
import { GatePolicyService } from '../policy/gate-policy.service';
import type { WaiverInputDto } from './dto/waiver.dto';

const DAY_MS = 86_400_000;

/**
 * Waivers (12-policy-gate §5). Fingerprint-scoped — never `Finding.id`, which
 * is per-audit and would evaporate on the next run. Mandatory expiry, bounded
 * by the active policy's `max_duration_days`, and a separate approver when the
 * policy requires one. The grant links the `FindingIdentity.waiverId` so the
 * gate and the UI can see which identity is covered.
 */
@Injectable()
export class WaiverService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: GatePolicyService,
    private readonly trail: AuditTrailService,
  ) {}

  async create(projectId: string, dto: WaiverInputDto, actor: Actor, now = new Date()): Promise<unknown> {
    await this.assertProjectExists(projectId);

    const { waivers: rules } = (await this.policies.getActiveParsed(projectId)).policy;
    const requestedBy = actor.id ?? 'unknown';

    if (rules.require_separate_approver && dto.approvedBy === requestedBy) {
      throw new ProblemException('VALIDATION_FAILED', 'This project requires a waiver approver different from the requester', {
        approvedBy: ['approver must differ from the requester'],
      });
    }

    const expiresAt = new Date(dto.expiresAt);
    if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= now.getTime()) {
      throw new ProblemException('VALIDATION_FAILED', 'Waiver expiry must be a future timestamp', {
        expiresAt: ['must be in the future'],
      });
    }
    const maxExpiry = now.getTime() + rules.max_duration_days * DAY_MS;
    if (expiresAt.getTime() > maxExpiry) {
      throw new ProblemException('VALIDATION_FAILED', `Waiver expiry exceeds the policy maximum of ${rules.max_duration_days} days`, {
        expiresAt: [`must be within ${rules.max_duration_days} days`],
      });
    }

    const id = newId('waiver');
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.waiver.create({
        data: {
          id,
          projectId,
          fingerprint: dto.fingerprint,
          reason: dto.reason,
          requestedBy,
          approvedBy: dto.approvedBy,
          approvedAt: now,
          expiresAt,
          affectedRelease: dto.affectedRelease ?? null,
        },
      });
      // Link any existing identity for this fingerprint. A waiver may precede
      // the finding (pre-emptive), in which case nothing is updated yet.
      await tx.findingIdentity.updateMany({ where: { projectId, fingerprint: dto.fingerprint }, data: { waiverId: id } });
      return row;
    });

    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'waiver.create',
      resourceType: 'Waiver',
      resourceId: id,
      diff: diffOf(null, created as never),
      metadata: { fingerprint: dto.fingerprint, expiresAt: expiresAt.toISOString(), approvedBy: dto.approvedBy },
      outcome: 'allowed',
    });

    return created;
  }

  async list(projectId: string, query: PaginationQueryDto): Promise<Page<{ id: string }>> {
    await this.assertProjectExists(projectId);
    const rows = await this.prisma.waiver.findMany({ where: { projectId }, ...paginationArgs(query) });
    return toPage(rows, query);
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    const exists = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!exists) throw new ProblemException('NOT_FOUND', `No project with id "${projectId}"`);
  }
}
