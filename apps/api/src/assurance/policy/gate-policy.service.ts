import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditTrailService, diffOf } from '../../audit-trail/audit-trail.service';
import { newId } from '../../common/ids';
import { ProblemException } from '../../common/problem-details';
import { PaginationQueryDto, paginationArgs, toPage, type Page } from '../../common/pagination';
import type { Actor } from '../../projects/projects.service';
import { safeParsePolicy, type ParsedPolicy } from './policy-schema';

/**
 * CRUD + versioning over `GatePolicy` (M6 Workstream A).
 *
 * Policies are immutable per version. There is no update/patch: editing a
 * policy means creating the next version, and the `@@unique([projectId,
 * version])` constraint guarantees versions do not collide. The newest version
 * becomes the project's active default, while every prior version stays intact
 * so a historical `GateEvaluation` referenced by (policy id, version) remains
 * reproducible — the property 12-policy-gate §4 depends on.
 *
 * The full policy DSL is stored on `GatePolicy.rules`; `version`/`name` are
 * mirrored into their columns for cheap listing. `mode` (rollout phase) lives
 * inside `rules` — no schema migration is needed for M6. Validation is
 * fail-closed: a policy that does not satisfy the schema is never stored, and a
 * stored policy that fails to re-parse is a server fault, never a silent pass.
 */
@Injectable()
export class GatePolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrailService,
  ) {}

  /** Create the next version and promote it to the project's active default. */
  async create(projectId: string, rulesInput: Record<string, unknown>, actor: Actor): Promise<unknown> {
    await this.assertProjectExists(projectId);

    const last = await this.prisma.gatePolicy.findFirst({
      where: { projectId },
      orderBy: { version: 'desc' },
    });
    const nextVersion = (last?.version ?? 0) + 1;

    // The service owns the version number; a client-supplied one is ignored so
    // versions stay monotonic and gap-free.
    const parsed = this.validate({ ...rulesInput, version: nextVersion });

    const id = newId('gatePolicy');
    const created = await this.prisma.$transaction(async (tx) => {
      const row = await tx.gatePolicy.create({
        data: { id, projectId, version: nextVersion, name: parsed.name, rules: parsed as object },
      });
      await tx.project.update({ where: { id: projectId }, data: { defaultGatePolicyId: id } });
      return row;
    });

    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'gate_policy.create',
      resourceType: 'GatePolicy',
      resourceId: id,
      diff: diffOf(last as never, created as never),
      metadata: { version: nextVersion, mode: parsed.mode },
      outcome: 'allowed',
    });

    return created;
  }

  async list(projectId: string, query: PaginationQueryDto): Promise<Page<{ id: string }>> {
    await this.assertProjectExists(projectId);
    const rows = await this.prisma.gatePolicy.findMany({ where: { projectId }, ...paginationArgs(query) });
    return toPage(rows, query);
  }

  /** The project's active policy — the one new evaluations use. */
  async getActive(projectId: string): Promise<unknown> {
    return this.loadActiveRow(projectId);
  }

  async getVersion(projectId: string, version: number): Promise<unknown> {
    const row = await this.prisma.gatePolicy.findFirst({ where: { projectId, version } });
    if (!row) {
      throw new ProblemException('NOT_FOUND', `Project "${projectId}" has no gate policy version ${version}`);
    }
    return row;
  }

  /**
   * The active policy parsed for the gate engine. Re-validates the stored row:
   * rows are validated on write, but a policy that cannot be loaded must fail
   * closed (12-policy-gate §7: "Gate policy fails to load → FAIL"), never be
   * treated as an empty/permissive policy.
   */
  async getActiveParsed(projectId: string): Promise<{ id: string; version: number; policy: ParsedPolicy }> {
    const row = (await this.loadActiveRow(projectId)) as { id: string; version: number; rules: unknown };
    return { id: row.id, version: row.version, policy: this.validate(row.rules) };
  }

  private async loadActiveRow(projectId: string): Promise<unknown> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { defaultGatePolicyId: true },
    });
    if (!project) throw new ProblemException('NOT_FOUND', `No project with id "${projectId}"`);
    const row = await this.prisma.gatePolicy.findUnique({ where: { id: project.defaultGatePolicyId } });
    if (!row) throw new ProblemException('NOT_FOUND', `Project "${projectId}" has no active gate policy`);
    return row;
  }

  private validate(candidate: unknown): ParsedPolicy {
    const result = safeParsePolicy(candidate);
    if (!result.success) {
      const fieldErrors: Record<string, string[]> = {};
      for (const issue of result.error.issues) {
        const key = issue.path.length > 0 ? issue.path.join('.') : '(root)';
        (fieldErrors[key] ??= []).push(issue.message);
      }
      throw new ProblemException('VALIDATION_FAILED', 'Gate policy failed schema validation', fieldErrors);
    }
    return result.data;
  }

  private async assertProjectExists(projectId: string): Promise<void> {
    const exists = await this.prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!exists) throw new ProblemException('NOT_FOUND', `No project with id "${projectId}"`);
  }
}
