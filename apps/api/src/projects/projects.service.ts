import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService, diffOf } from '../audit-trail/audit-trail.service';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem-details';
import { PaginationQueryDto, paginationArgs, toPage, Page } from '../common/pagination';
import {
  CreateProjectDto,
  UpdateProjectDto,
  ReplaceScopePolicyDto,
} from './dto/project.dto';
import { RepositoryInputDto, UpdateRepositoryDto } from './dto/repository.dto';
import { TargetInputDto, UpdateTargetDto } from './dto/target.dto';

/**
 * 17-security §3: "Attestations are recorded with identity and timestamp and go
 * stale after 12 months, requiring renewal."
 */
export const ATTESTATION_MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

export function isAttestationStale(attestedAt: Date, now = new Date()): boolean {
  return now.getTime() - attestedAt.getTime() > ATTESTATION_MAX_AGE_MS;
}

export interface Actor {
  type: 'user' | 'token' | 'system';
  id?: string;
  organizationId?: string;
}

const DEFAULT_GATE_POLICY_RULES = {
  // ADR-002: only replayable evidence may block. AI-only findings warn.
  blockOn: { minSeverity: 'high', requiresReplayableEvidence: true },
  warnOn: { aiOnly: true },
};

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrailService,
  ) {}

  // ------------------------------------------------------------------ create

  /**
   * Creates the project graph in one transaction.
   *
   * Ordering is forced by the schema: `Project.defaultGatePolicyId` is
   * non-nullable but `GatePolicy.projectId` points back at the project, so
   * neither can be inserted first in isolation. The ID is generated in
   * application code (ULIDs), which breaks the cycle — we know the project ID
   * before either row exists.
   */
  async create(dto: CreateProjectDto, actor: Actor): Promise<unknown> {
    const organizationId = actor.organizationId;
    if (!organizationId) {
      throw new ProblemException(
        'FORBIDDEN',
        'The authenticated principal is not bound to an organization',
      );
    }

    const slug = dto.slug ?? slugify(dto.name);
    if (!slug) {
      throw new ProblemException(
        'VALIDATION_FAILED',
        `Could not derive a slug from name "${dto.name}"; supply "slug" explicitly`,
      );
    }

    const clash = await this.prisma.project.findUnique({ where: { slug } });
    if (clash) {
      throw new ProblemException('CONFLICT', `A project with slug "${slug}" already exists`);
    }

    assertDestructiveIsAttested(dto.scopePolicy.destructiveAllowed, dto.scopePolicy.allowedHosts);

    const projectId = newId('project');
    const gatePolicyId = newId('gatePolicy');
    const now = new Date();

    const project = await this.prisma.$transaction(async (tx) => {
      await tx.project.create({
        data: {
          id: projectId,
          organizationId,
          name: dto.name,
          slug,
          defaultGatePolicyId: gatePolicyId,
        },
      });

      await tx.gatePolicy.create({
        data: {
          id: gatePolicyId,
          projectId,
          version: 1,
          name: 'default',
          rules: DEFAULT_GATE_POLICY_RULES,
        },
      });

      await tx.scopePolicy.create({
        data: {
          id: newId('scopePolicy'),
          projectId,
          allowedHosts: dto.scopePolicy.allowedHosts,
          deniedPaths: dto.scopePolicy.deniedPaths ?? [],
          maxRequestsPerSecond: dto.scopePolicy.maxRequestsPerSecond,
          maxRequestsPerAudit: dto.scopePolicy.maxRequestsPerAudit,
          destructiveAllowed: dto.scopePolicy.destructiveAllowed ?? false,
          authorizationAttestedBy: dto.scopePolicy.authorizationAttestedBy,
          authorizationAttestedAt: now,
        },
      });

      if (dto.repository) {
        await tx.repository.create({
          data: { id: newId('repository'), projectId, ...dto.repository },
        });
      }

      for (const t of dto.targets ?? []) {
        await tx.target.create({
          data: {
            id: newId('target'),
            projectId,
            name: t.name,
            baseUrl: t.baseUrl,
            environment: t.environment,
            authMode: t.authMode ?? 'none',
            authCredentialId: t.authCredentialId ?? null,
            buildInfoUrl: t.buildInfoUrl ?? null,
          },
        });
      }

      // The creator is enrolled as the project's first admin. Without this,
      // a session user who just created a project would fail
      // ProjectScopeGuard on every subsequent request to it — no
      // ProjectMember row would exist, and nothing else creates one.
      if (actor.type === 'user' && actor.id) {
        await tx.projectMember.create({
          data: { userId: actor.id, projectId, role: 'admin' },
        });
      }

      return tx.project.findUniqueOrThrow({
        where: { id: projectId },
        include: { repositories: true, targets: true, scopePolicies: true },
      });
    });

    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'project.create',
      resourceType: 'Project',
      resourceId: projectId,
      diff: diffOf(null, { name: dto.name, slug }),
      metadata: {
        attestedBy: dto.scopePolicy.authorizationAttestedBy,
        allowedHosts: dto.scopePolicy.allowedHosts,
      },
      outcome: 'allowed',
    });

    return project;
  }

  // -------------------------------------------------------------------- read

  async list(organizationId: string, query: PaginationQueryDto): Promise<Page<{ id: string }>> {
    const rows = await this.prisma.project.findMany({
      where: { organizationId },
      ...paginationArgs(query),
    });
    return toPage(rows, query);
  }

  async findOne(id: string): Promise<unknown> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: { repositories: true, targets: true, scopePolicies: true },
    });
    if (!project) throw new ProblemException('NOT_FOUND', `No project with id "${id}"`);
    return project;
  }

  // ------------------------------------------------------------------ update

  async update(id: string, dto: UpdateProjectDto, actor: Actor): Promise<unknown> {
    const before = await this.prisma.project.findUnique({ where: { id } });
    if (!before) throw new ProblemException('NOT_FOUND', `No project with id "${id}"`);

    if (dto.slug && dto.slug !== before.slug) {
      const clash = await this.prisma.project.findUnique({ where: { slug: dto.slug } });
      if (clash) {
        throw new ProblemException('CONFLICT', `A project with slug "${dto.slug}" already exists`);
      }
    }

    const after = await this.prisma.project.update({ where: { id }, data: { ...dto } });

    await this.trail.record({
      projectId: id,
      actorType: actor.type,
      actorId: actor.id,
      action: 'project.update',
      resourceType: 'Project',
      resourceId: id,
      diff: diffOf(before as never, after as never),
      outcome: 'allowed',
    });

    return after;
  }

  async remove(id: string, actor: Actor): Promise<void> {
    const before = await this.prisma.project.findUnique({ where: { id } });
    if (!before) throw new ProblemException('NOT_FOUND', `No project with id "${id}"`);

    await this.prisma.project.delete({ where: { id } });

    await this.trail.record({
      projectId: id,
      actorType: actor.type,
      actorId: actor.id,
      action: 'project.delete',
      resourceType: 'Project',
      resourceId: id,
      diff: diffOf(before as never, null),
      outcome: 'allowed',
    });
  }

  // ------------------------------------------------------------ scope policy

  /** The current policy is the most recently attested one. */
  async getScopePolicy(projectId: string): Promise<unknown> {
    const policy = await this.prisma.scopePolicy.findFirst({
      where: { projectId },
      orderBy: { authorizationAttestedAt: 'desc' },
    });
    if (!policy) {
      throw new ProblemException('NOT_FOUND', `Project "${projectId}" has no scope policy`);
    }
    return policy;
  }

  /**
   * PUT semantics per 14-api §4 — a full replace, not a patch.
   *
   * Replacing writes a NEW row rather than mutating the old one: the previous
   * policy is what a past audit was authorized under, and rewriting it would
   * retroactively change what someone attested to.
   */
  async replaceScopePolicy(
    projectId: string,
    dto: ReplaceScopePolicyDto,
    actor: Actor,
  ): Promise<unknown> {
    const project = await this.prisma.project.findUnique({ where: { id: projectId } });
    if (!project) throw new ProblemException('NOT_FOUND', `No project with id "${projectId}"`);

    const before = await this.prisma.scopePolicy.findFirst({
      where: { projectId },
      orderBy: { authorizationAttestedAt: 'desc' },
    });

    assertDestructiveIsAttested(dto.destructiveAllowed, dto.allowedHosts);

    const created = await this.prisma.scopePolicy.create({
      data: {
        id: newId('scopePolicy'),
        projectId,
        allowedHosts: dto.allowedHosts,
        deniedPaths: dto.deniedPaths ?? [],
        maxRequestsPerSecond: dto.maxRequestsPerSecond,
        maxRequestsPerAudit: dto.maxRequestsPerAudit,
        destructiveAllowed: dto.destructiveAllowed ?? false,
        authorizationAttestedBy: dto.authorizationAttestedBy,
        authorizationAttestedAt: new Date(),
      },
    });

    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'scope_policy.replace',
      resourceType: 'ScopePolicy',
      resourceId: created.id,
      diff: diffOf(before as never, created as never),
      outcome: 'allowed',
    });

    return created;
  }

  // -------------------------------------------------------------- repository

  async listRepositories(projectId: string): Promise<unknown> {
    await this.assertProjectExists(projectId);
    return this.prisma.repository.findMany({ where: { projectId }, orderBy: { id: 'asc' } });
  }

  async createRepository(
    projectId: string,
    dto: RepositoryInputDto,
    actor: Actor,
  ): Promise<unknown> {
    await this.assertProjectExists(projectId);
    const created = await this.prisma.repository.create({
      data: { id: newId('repository'), projectId, ...dto },
    });
    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'repository.create',
      resourceType: 'Repository',
      resourceId: created.id,
      diff: diffOf(null, created as never),
      outcome: 'allowed',
    });
    return created;
  }

  async updateRepository(
    projectId: string,
    repositoryId: string,
    dto: UpdateRepositoryDto,
    actor: Actor,
  ): Promise<unknown> {
    const before = await this.prisma.repository.findFirst({
      where: { id: repositoryId, projectId },
    });
    if (!before) {
      throw new ProblemException('NOT_FOUND', `No repository "${repositoryId}" in this project`);
    }
    const after = await this.prisma.repository.update({
      where: { id: repositoryId },
      data: { ...dto },
    });
    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'repository.update',
      resourceType: 'Repository',
      resourceId: repositoryId,
      diff: diffOf(before as never, after as never),
      outcome: 'allowed',
    });
    return after;
  }

  async removeRepository(projectId: string, repositoryId: string, actor: Actor): Promise<void> {
    const before = await this.prisma.repository.findFirst({
      where: { id: repositoryId, projectId },
    });
    if (!before) {
      throw new ProblemException('NOT_FOUND', `No repository "${repositoryId}" in this project`);
    }
    await this.prisma.repository.delete({ where: { id: repositoryId } });
    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'repository.delete',
      resourceType: 'Repository',
      resourceId: repositoryId,
      diff: diffOf(before as never, null),
      outcome: 'allowed',
    });
  }

  // ------------------------------------------------------------------ target

  async listTargets(projectId: string): Promise<unknown> {
    await this.assertProjectExists(projectId);
    return this.prisma.target.findMany({ where: { projectId }, orderBy: { id: 'asc' } });
  }

  async createTarget(projectId: string, dto: TargetInputDto, actor: Actor): Promise<unknown> {
    await this.assertProjectExists(projectId);
    const created = await this.prisma.target.create({
      data: {
        id: newId('target'),
        projectId,
        name: dto.name,
        baseUrl: dto.baseUrl,
        environment: dto.environment,
        authMode: dto.authMode ?? 'none',
        authCredentialId: dto.authCredentialId ?? null,
        buildInfoUrl: dto.buildInfoUrl ?? null,
      },
    });
    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'target.create',
      resourceType: 'Target',
      resourceId: created.id,
      diff: diffOf(null, created as never),
      outcome: 'allowed',
    });
    return created;
  }

  /**
   * 17-security §3: "Production targets require re-attestation on target
   * change."
   *
   * Enforced here rather than in the DTO because it depends on stored state —
   * whether this target is production, and how old the attestation is. A stale
   * attestation blocks the change with ATTESTATION_STALE so the CLI can map it
   * to exit 3 rather than a generic validation failure.
   */
  async updateTarget(
    projectId: string,
    targetId: string,
    dto: UpdateTargetDto,
    actor: Actor,
  ): Promise<unknown> {
    const before = await this.prisma.target.findFirst({ where: { id: targetId, projectId } });
    if (!before) {
      throw new ProblemException('NOT_FOUND', `No target "${targetId}" in this project`);
    }

    const touchesProduction =
      before.environment === 'production' || dto.environment === 'production';

    if (touchesProduction) {
      const policy = await this.prisma.scopePolicy.findFirst({
        where: { projectId },
        orderBy: { authorizationAttestedAt: 'desc' },
      });
      if (!policy) {
        throw new ProblemException(
          'ATTESTATION_REQUIRED',
          'Changing a production target requires an attested scope policy',
        );
      }
      if (isAttestationStale(policy.authorizationAttestedAt)) {
        throw new ProblemException(
          'ATTESTATION_STALE',
          `Authorization attestation by ${policy.authorizationAttestedBy} has expired; ` +
            're-attest the scope policy before changing a production target',
        );
      }
    }

    const after = await this.prisma.target.update({ where: { id: targetId }, data: { ...dto } });

    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'target.update',
      resourceType: 'Target',
      resourceId: targetId,
      diff: diffOf(before as never, after as never),
      metadata: { touchesProduction },
      outcome: 'allowed',
    });

    return after;
  }

  async removeTarget(projectId: string, targetId: string, actor: Actor): Promise<void> {
    const before = await this.prisma.target.findFirst({ where: { id: targetId, projectId } });
    if (!before) {
      throw new ProblemException('NOT_FOUND', `No target "${targetId}" in this project`);
    }
    await this.prisma.target.delete({ where: { id: targetId } });
    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'target.delete',
      resourceType: 'Target',
      resourceId: targetId,
      diff: diffOf(before as never, null),
      outcome: 'allowed',
    });
  }

  // ----------------------------------------------------------------- helpers

  private async assertProjectExists(projectId: string): Promise<void> {
    const exists = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { id: true },
    });
    if (!exists) throw new ProblemException('NOT_FOUND', `No project with id "${projectId}"`);
  }
}

/**
 * 17-security §6: enabling `destructiveAllowed` "requires an explicit,
 * separately attested authorization recording who authorized it and for which
 * target. Production targets carry an additional confirmation."
 *
 * v1 enforces the narrower, checkable half: destructive testing may not be
 * enabled against a wildcard allowlist, because "which target" is then
 * unanswerable. The separate attestation record is M-later; this refuses the
 * unbounded case rather than pretending the rule is satisfied.
 */
function assertDestructiveIsAttested(
  destructiveAllowed: boolean | undefined,
  allowedHosts: string[],
): void {
  if (!destructiveAllowed) return;

  const wildcards = allowedHosts.filter((h) => h.includes('*'));
  if (wildcards.length > 0) {
    throw new ProblemException(
      'SCOPE_VIOLATION',
      'destructiveAllowed cannot be enabled with wildcard hosts ' +
        `(${wildcards.join(', ')}); destructive testing must name exact targets`,
    );
  }
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120)
    .replace(/-+$/g, '');
}
