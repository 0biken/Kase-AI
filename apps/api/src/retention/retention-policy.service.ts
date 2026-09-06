import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService, diffOf } from '../audit-trail/audit-trail.service';
import { ProblemException } from '../common/problem-details';
import type { Actor } from '../projects/projects.service';
import {
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  OrganizationEvidencePolicyDto,
  ProjectEvidencePolicyDto,
} from './dto/evidence-policy.dto';

export const PLATFORM_EVIDENCE_POLICY = Object.freeze({
  replayableEvidenceDays: 90,
  nonReplayableEvidenceDays: 30,
  rawToolOutputDays: 30,
  agentTranscriptDays: 30,
});

type PolicyField = keyof typeof PLATFORM_EVIDENCE_POLICY;
const POLICY_FIELDS = Object.keys(PLATFORM_EVIDENCE_POLICY) as PolicyField[];
type PolicyValues = Record<PolicyField, number>;
type PolicyOverrides = Record<PolicyField, number | null>;
type PolicySource = 'project' | 'organization' | 'platform';

@Injectable()
export class RetentionPolicyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrailService,
  ) {}

  async expiryForCapture(
    projectId: string,
    evidence: { type: string; replayable: boolean },
    capturedAt = new Date(),
  ): Promise<Date> {
    const policy = await this.getProjectPolicy(projectId);
    const field: PolicyField = evidence.type === 'agent_transcript'
      ? 'agentTranscriptDays'
      : ['tool_stdout', 'tool_stderr', 'raw_tool_output'].includes(evidence.type)
        ? 'rawToolOutputDays'
        : evidence.replayable
          ? 'replayableEvidenceDays'
          : 'nonReplayableEvidenceDays';
    return new Date(capturedAt.getTime() + policy.effective[field].days * 24 * 60 * 60 * 1000);
  }

  async getOrganizationPolicy(organizationId: string, actor: Actor): Promise<PolicyValues> {
    await this.assertOrganizationMember(organizationId, actor, false);
    const configured = await this.prisma.evidenceRetentionPolicy.findUnique({
      where: { organizationId },
    });
    return valuesOf(configured ?? PLATFORM_EVIDENCE_POLICY);
  }

  async putOrganizationPolicy(
    organizationId: string,
    dto: OrganizationEvidencePolicyDto,
    actor: Actor,
  ): Promise<PolicyValues> {
    validateCompletePolicy(dto);
    await this.assertOrganizationMember(organizationId, actor, true);
    const before = await this.prisma.evidenceRetentionPolicy.findUnique({
      where: { organizationId },
    });

    const after = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.evidenceRetentionPolicy.upsert({
        where: { organizationId },
        create: { organizationId, ...dto, updatedBy: actor.id! },
        update: { ...dto, updatedBy: actor.id! },
      });
      // LEAST makes this monotonic: a shorter policy advances commitments;
      // an extension cannot move an existing expiry later.
      await tx.$executeRawUnsafe(RESCHEDULE_ORGANIZATION_SQL, organizationId);
      return saved;
    });

    await this.trail.record({
      actorType: 'user',
      actorId: actor.id,
      action: 'evidence_policy.organization_update',
      resourceType: 'EvidenceRetentionPolicy',
      resourceId: organizationId,
      diff: diffOf(
        valuesOf(before ?? PLATFORM_EVIDENCE_POLICY),
        valuesOf(after),
      ),
      outcome: 'allowed',
    });
    return valuesOf(after);
  }

  async getProjectPolicy(projectId: string): Promise<{
    configured: PolicyOverrides;
    effective: Record<PolicyField, { days: number; source: PolicySource }>;
  }> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: {
        organizationId: true,
        evidenceRetentionOverride: true,
        organization: { select: { evidenceRetentionPolicy: true } },
      },
    });
    if (!project) throw new ProblemException('NOT_FOUND', `No project with id "${projectId}"`);

    return resolveProjectPolicy(
      project.evidenceRetentionOverride,
      project.organization.evidenceRetentionPolicy,
    );
  }

  async putProjectPolicy(
    projectId: string,
    dto: ProjectEvidencePolicyDto,
    actor: Actor,
  ): Promise<ReturnType<typeof resolveProjectPolicy>> {
    const overrides = normalizeOverrides(dto);
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { organizationId: true, evidenceRetentionOverride: true },
    });
    if (!project) throw new ProblemException('NOT_FOUND', `No project with id "${projectId}"`);

    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.projectEvidenceRetentionOverride.upsert({
        where: { projectId },
        create: { projectId, ...overrides, updatedBy: actor.id ?? 'system' },
        update: { ...overrides, updatedBy: actor.id ?? 'system' },
      });
      await tx.$executeRawUnsafe(RESCHEDULE_PROJECT_SQL, projectId);
      return row;
    });

    const result = await this.getProjectPolicy(projectId);
    await this.trail.record({
      projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'evidence_policy.project_update',
      resourceType: 'ProjectEvidenceRetentionOverride',
      resourceId: projectId,
      diff: diffOf(normalizeStoredOverrides(project.evidenceRetentionOverride), normalizeStoredOverrides(saved)),
      outcome: 'allowed',
    });
    return result;
  }

  private async assertOrganizationMember(
    organizationId: string,
    actor: Actor,
    requireAdmin: boolean,
  ): Promise<void> {
    if (
      actor.type !== 'user' ||
      !actor.id ||
      actor.organizationId !== organizationId
    ) {
      throw new ProblemException('FORBIDDEN', 'Organization policy requires a session principal');
    }
    const membership = await this.prisma.organizationMember.findUnique({
      where: { userId_organizationId: { userId: actor.id, organizationId } },
      select: { role: true },
    });
    if (!membership || (requireAdmin && membership.role !== 'admin')) {
      throw new ProblemException(
        'FORBIDDEN',
        requireAdmin ? 'Organization administrator role is required' : 'Organization membership is required',
      );
    }
  }
}

export function resolveProjectPolicy(
  override: Partial<PolicyOverrides> | null | undefined,
  organization: Partial<PolicyValues> | null | undefined,
) {
  const configured = normalizeStoredOverrides(override);
  const effective = {} as Record<PolicyField, { days: number; source: PolicySource }>;
  for (const field of POLICY_FIELDS) {
    if (configured[field] !== null) {
      effective[field] = { days: configured[field]!, source: 'project' };
    } else if (organization?.[field] !== undefined) {
      effective[field] = { days: organization[field]!, source: 'organization' };
    } else {
      effective[field] = { days: PLATFORM_EVIDENCE_POLICY[field], source: 'platform' };
    }
  }
  return { configured, effective };
}

function validateDays(field: string, value: unknown, nullable: boolean): void {
  if (nullable && value === null) return;
  if (!Number.isInteger(value) || (value as number) < MIN_RETENTION_DAYS || (value as number) > MAX_RETENTION_DAYS) {
    throw new ProblemException(
      'VALIDATION_FAILED',
      `${field} must be an integer from ${MIN_RETENTION_DAYS} through ${MAX_RETENTION_DAYS}`,
      { [field]: ['invalid retention days'] },
    );
  }
}

function validateCompletePolicy(value: Partial<PolicyValues>): void {
  for (const field of POLICY_FIELDS) validateDays(field, value[field], false);
}

function normalizeOverrides(value: Partial<PolicyOverrides>): PolicyOverrides {
  const result = {} as PolicyOverrides;
  for (const field of POLICY_FIELDS) {
    const candidate = value[field] === undefined ? null : value[field];
    validateDays(field, candidate, true);
    result[field] = candidate!;
  }
  return result;
}

function normalizeStoredOverrides(value: Partial<PolicyOverrides> | null | undefined): PolicyOverrides {
  const out = {} as PolicyOverrides;
  for (const field of POLICY_FIELDS) out[field] = value?.[field] ?? null;
  return out;
}

function valuesOf(value: Partial<PolicyValues>): PolicyValues {
  const out = {} as PolicyValues;
  for (const field of POLICY_FIELDS) out[field] = value[field] ?? PLATFORM_EVIDENCE_POLICY[field];
  return out;
}

// Classification order matters: transcript/raw output classes are explicit;
// remaining records use replayable vs non-replayable.
const EFFECTIVE_DAYS_SQL = `CASE
  WHEN e."type" = 'agent_transcript' THEN COALESCE(o."agentTranscriptDays", op."agentTranscriptDays", 30)
  WHEN e."type" IN ('tool_stdout', 'tool_stderr', 'raw_tool_output') THEN COALESCE(o."rawToolOutputDays", op."rawToolOutputDays", 30)
  WHEN e."replayable" THEN COALESCE(o."replayableEvidenceDays", op."replayableEvidenceDays", 90)
  ELSE COALESCE(o."nonReplayableEvidenceDays", op."nonReplayableEvidenceDays", 30)
END`;

const RESCHEDULE_ORGANIZATION_SQL = `
UPDATE "Evidence" e
SET "expiresAt" = LEAST(e."expiresAt", e."capturedAt" + make_interval(days => ${EFFECTIVE_DAYS_SQL}))
FROM "Audit" a
JOIN "Project" p ON p."id" = a."projectId"
LEFT JOIN "ProjectEvidenceRetentionOverride" o ON o."projectId" = p."id"
LEFT JOIN "EvidenceRetentionPolicy" op ON op."organizationId" = p."organizationId"
WHERE e."auditId" = a."id" AND p."organizationId" = $1 AND e."tombstonedAt" IS NULL`;

const RESCHEDULE_PROJECT_SQL = `
UPDATE "Evidence" e
SET "expiresAt" = LEAST(e."expiresAt", e."capturedAt" + make_interval(days => ${EFFECTIVE_DAYS_SQL}))
FROM "Audit" a
JOIN "Project" p ON p."id" = a."projectId"
LEFT JOIN "ProjectEvidenceRetentionOverride" o ON o."projectId" = p."id"
LEFT JOIN "EvidenceRetentionPolicy" op ON op."organizationId" = p."organizationId"
WHERE e."auditId" = a."id" AND p."id" = $1 AND e."tombstonedAt" IS NULL`;
