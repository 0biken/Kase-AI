import { Inject, Injectable, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { newId } from '../common/ids';
import { ProblemException } from '../common/problem-details';
import type { Role } from '../auth/roles';
import type { Actor } from '../projects/projects.service';
import {
  advisorResponseSchema, classifyDedup, DEDUP_ADVISOR, noAdvisor, normalizeTarget, pairKey,
  type DedupAdvisor, type DedupOutcome, type DedupSubject,
} from './dedup';
import { checkDecision, observe, producingCategories, promoteNew, type Decision, type LifecycleStatus } from './lifecycle';

/* eslint-disable @typescript-eslint/no-explicit-any -- Prisma transaction clients are passed structurally. */
type Db = any;

const MAX_CANDIDATES = 500;
const FINDING_SUMMARY = { id: true, auditId: true, identityId: true, origin: true, category: true, cwe: true, severity: true,
  title: true, description: true, affectedTarget: true, reproduction: true } as const;

function subjectOf(identity: { id: string; fingerprint: string }, finding: any, locations: number): DedupSubject {
  return { identityId: identity.id, fingerprint: identity.fingerprint, category: finding.category, cwe: finding.cwe ?? null,
    severity: finding.severity, normalizedTarget: normalizeTarget(finding.affectedTarget), hasSourceLocation: locations > 0,
    title: finding.title, description: finding.description };
}

/**
 * Pass 2 semantic dedup (09-findings §5) and its human review queue.
 * MATCH merges into the existing identity; POSSIBLE_MATCH creates a pending
 * `FindingRelation` that only a reviewer can confirm or reject.
 */
@Injectable()
export class DedupService {
  constructor(
    @Inject(PrismaService) private readonly prisma: Db,
    private readonly trail: AuditTrailService,
    @Optional() @Inject(DEDUP_ADVISOR) private readonly advisor: DedupAdvisor = noAdvisor,
  ) {}

  /** Classifies a finding just persisted in `auditId`; see `runDedup`. */
  recordForFinding(tx: Db, input: DedupRunInput) {
    return runDedup(tx, input, this.advisor);
  }

  async queue(projectId: string, limit = 50): Promise<unknown[]> {
    const rows = await this.prisma.findingRelation.findMany({
      where: { projectId, kind: 'possible_match', status: 'pending' }, orderBy: { createdAt: 'asc' }, take: Math.min(Math.max(limit, 1), 200) });
    const ids = [...new Set(rows.flatMap((r: any) => [r.fromFindingId, r.toFindingId]))];
    const findings = await this.prisma.finding.findMany({ where: { id: { in: ids } },
      select: { id: true, auditId: true, title: true, category: true, cwe: true, severity: true, affectedTarget: true, identity: { select: { id: true, fingerprint: true, status: true } } } });
    const byId = new Map(findings.map((f: any) => [f.id, f]));
    return rows.map((r: any) => ({ id: r.id, level: r.level, confidenceBand: r.confidenceBand, createdAt: r.createdAt,
      finding: byId.get(r.fromFindingId) ?? null, candidate: byId.get(r.toFindingId) ?? null }));
  }

  async decide(projectId: string, relationId: string, input: { decision: 'confirm' | 'reject'; rationale: string }, actor: Actor): Promise<unknown> {
    if (!input.rationale || input.rationale.trim().length < 3) throw new ProblemException('VALIDATION_FAILED', 'A rationale is required', { rationale: ['required'] });
    const result = await this.prisma.$transaction(async (tx: Db) => {
      const relation = await tx.findingRelation.findUnique({ where: { id: relationId } });
      if (!relation || relation.projectId !== projectId || relation.kind !== 'possible_match') throw new ProblemException('NOT_FOUND', `No dedup proposal "${relationId}"`);
      if (relation.status !== 'pending') throw new ProblemException('CONFLICT', `Dedup proposal is already ${relation.status}`);
      const [from, to] = await Promise.all([relation.fromFindingId, relation.toFindingId].map(id => tx.finding.findUnique({ where: { id }, select: { id: true, identityId: true } })));
      if (!from || !to) throw new ProblemException('CONFLICT', 'A finding in this proposal no longer exists');
      const decided = { decidedBy: actor.id ?? 'unknown', decidedAt: new Date(), rationale: input.rationale.trim() };
      if (input.decision === 'reject') {
        return tx.findingRelation.update({ where: { id: relationId }, data: { status: 'rejected', ...decided } });
      }
      await mergeIdentity(tx, from.identityId, to.identityId);
      return tx.findingRelation.update({ where: { id: relationId }, data: { status: 'confirmed', ...decided } });
    });
    await this.trail.record({ projectId, actorType: actor.type, actorId: actor.id, action: `finding.dedup.${input.decision}`,
      resourceType: 'FindingRelation', resourceId: relationId, metadata: { rationale: input.rationale.trim() }, outcome: 'allowed' });
    return result;
  }
}

export interface DedupRunInput { projectId: string; auditId: string; findingId: string }

/**
 * Runs dedup for a finding just persisted in `auditId`. Only an identity's
 * first occurrence is classified: later occurrences were already matched by
 * fingerprint. A finding whose identity was previously merged away follows
 * the merge.
 */
export async function runDedup(tx: Db, input: DedupRunInput, advisor: DedupAdvisor = noAdvisor): Promise<DedupOutcome & { mergedInto?: string; findingId: string }> {
  const finding = await tx.finding.findFirst({ where: { id: input.findingId, auditId: input.auditId },
    select: { ...FINDING_SUMMARY, identity: true, _count: { select: { sourceLocations: true } } } });
  if (!finding || finding.identity?.projectId !== input.projectId) throw new Error('Finding not in this audit');
  const identity = finding.identity;

  if (identity.mergedIntoIdentityId) {
    const survivor = await mergeFinding(tx, finding.id, identity.id, identity.mergedIntoIdentityId);
    return { outcome: 'MATCH', level: 1, identityId: identity.mergedIntoIdentityId, mergedInto: identity.mergedIntoIdentityId, findingId: survivor };
  }
  if (identity.firstSeenAuditId !== input.auditId || identity.occurrences > 1) return { outcome: 'MATCH', level: 1, identityId: identity.id, findingId: finding.id };

  const others = await tx.findingIdentity.findMany({
    where: { projectId: input.projectId, id: { not: identity.id }, mergedIntoIdentityId: null, findings: { some: { category: finding.category } } },
    take: MAX_CANDIDATES,
    select: { id: true, fingerprint: true, findings: { take: 1, select: { ...FINDING_SUMMARY, _count: { select: { sourceLocations: true } } } } },
  });
  const candidates = others.filter((o: any) => o.findings.length).map((o: any) => subjectOf(o, o.findings[0], o.findings[0]._count.sourceLocations));
  const representative = new Map<string, string>(others.filter((o: any) => o.findings.length).map((o: any) => [o.id, o.findings[0].id]));
  const subject = subjectOf(identity, finding, finding._count.sourceLocations);
  const rejected = await rejectedPairs(tx, input.projectId);

  let outcome = classifyDedup(subject, candidates, { rejectedPairs: rejected });
  if (outcome.outcome === 'NEW_FINDING' && advisor !== noAdvisor && candidates.length) {
    // Level 3 sees only the ambiguous remainder, and its answer is schema-checked.
    try {
      const parsed = advisorResponseSchema.safeParse(await advisor.similar(subject, candidates));
      if (parsed.success) outcome = classifyDedup(subject, candidates, { rejectedPairs: rejected }, parsed.data.similar);
    } catch { /* an unavailable advisor leaves the finding new */ }
  }

  if (outcome.outcome === 'MATCH') {
    // Recorded before merging: the relation is the durable record of why the merge happened.
    await upsertRelation(tx, { projectId: input.projectId, from: finding.id, to: representative.get(outcome.identityId)!, kind: 'match', level: outcome.level, status: 'auto', confidenceBand: 'high' });
    const survivor = await mergeFinding(tx, finding.id, identity.id, outcome.identityId);
    return { ...outcome, mergedInto: outcome.identityId, findingId: survivor };
  }
  if (outcome.outcome === 'POSSIBLE_MATCH') {
    for (const candidate of outcome.candidates) {
      await upsertRelation(tx, { projectId: input.projectId, from: finding.id, to: representative.get(candidate.identityId)!, kind: 'possible_match', level: outcome.level, status: 'pending', confidenceBand: candidate.confidenceBand });
    }
  }
  return { ...outcome, findingId: finding.id };
}

async function rejectedPairs(tx: Db, projectId: string): Promise<Set<string>> {
  const rejected = await tx.findingRelation.findMany({ where: { projectId, kind: 'possible_match', status: 'rejected' }, select: { fromFindingId: true, toFindingId: true } });
  if (!rejected.length) return new Set();
  const findings = await tx.finding.findMany({ where: { id: { in: rejected.flatMap((r: any) => [r.fromFindingId, r.toFindingId]) } }, select: { id: true, identityId: true } });
  const identityOf = new Map<string, string>(findings.map((f: any) => [f.id, f.identityId as string]));
  return new Set(rejected.filter((r: any) => identityOf.has(r.fromFindingId) && identityOf.has(r.toFindingId))
    .map((r: any) => pairKey(identityOf.get(r.fromFindingId)!, identityOf.get(r.toFindingId)!)));
}

async function upsertRelation(tx: Db, r: { projectId: string; from: string; to: string; kind: string; level: number; status: string; confidenceBand: string }) {
  await tx.findingRelation.upsert({
    where: { fromFindingId_toFindingId_kind: { fromFindingId: r.from, toFindingId: r.to, kind: r.kind } },
    create: { id: newId('findingRelation'), projectId: r.projectId, fromFindingId: r.from, toFindingId: r.to, kind: r.kind, level: r.level, status: r.status, confidenceBand: r.confidenceBand },
    update: {},
  });
}

/**
 * Moves one finding to another identity without losing evidence. If the target
 * already has an occurrence in the same audit, the evidence and source
 * locations move onto that occurrence and the duplicate row is removed.
 */
async function mergeFinding(tx: Db, findingId: string, fromIdentityId: string, toIdentityId: string): Promise<string> {
  const finding = await tx.finding.findUnique({ where: { id: findingId }, select: { id: true, auditId: true, findingEvidence: true } });
  const existing = await tx.finding.findUnique({ where: { auditId_identityId: { auditId: finding.auditId, identityId: toIdentityId } }, select: { id: true } });
  if (existing) {
    if (finding.findingEvidence.length) {
      await tx.findingEvidence.createMany({ data: finding.findingEvidence.map((e: any) => ({ findingId: existing.id, evidenceId: e.evidenceId, role: 'supporting' })), skipDuplicates: true });
    }
    await tx.sourceLocation.updateMany({ where: { findingId }, data: { findingId: existing.id } });
    await tx.findingRelation.updateMany({ where: { status: 'pending', OR: [{ fromFindingId: findingId }, { toFindingId: findingId }] }, data: { status: 'superseded' } });
    await tx.finding.delete({ where: { id: findingId } });
    await tx.findingIdentity.update({ where: { id: fromIdentityId }, data: { occurrences: { decrement: 1 }, mergedIntoIdentityId: toIdentityId } });
    return existing.id;
  } else {
    await tx.finding.update({ where: { id: findingId }, data: { identityId: toIdentityId } });
    await tx.findingIdentity.update({ where: { id: toIdentityId }, data: { occurrences: { increment: 1 } } });
  }
  await tx.findingIdentity.update({ where: { id: fromIdentityId }, data: { occurrences: { decrement: 1 }, mergedIntoIdentityId: toIdentityId } });
  return findingId;
}

async function mergeIdentity(tx: Db, fromIdentityId: string, toIdentityId: string): Promise<void> {
  if (fromIdentityId === toIdentityId) return;
  const findings = await tx.finding.findMany({ where: { identityId: fromIdentityId }, select: { id: true } });
  for (const f of findings) await mergeFinding(tx, f.id, fromIdentityId, toIdentityId);
  await tx.findingIdentity.update({ where: { id: fromIdentityId }, data: { mergedIntoIdentityId: toIdentityId, occurrences: 0 } });
}

/**
 * Finding lifecycle (09-findings §6): human decisions through `decide`, and
 * platform observations when an audit settles through `applyAuditOutcome`.
 */
@Injectable()
export class LifecycleService {
  constructor(@Inject(PrismaService) private readonly prisma: Db, private readonly trail: AuditTrailService) {}

  async decide(projectId: string, identityId: string, input: { decision: Decision; reason: string }, actor: Actor, role: Role | undefined): Promise<unknown> {
    const { updated, from, to } = await this.prisma.$transaction(async (tx: Db) => {
      const identity = await tx.findingIdentity.findUnique({ where: { id: identityId } });
      if (!identity || identity.projectId !== projectId) throw new ProblemException('NOT_FOUND', `No finding identity "${identityId}"`);
      if (identity.mergedIntoIdentityId) throw new ProblemException('CONFLICT', `Identity was merged into ${identity.mergedIntoIdentityId}`);
      const check = checkDecision(identity.status, input.decision, role, input.reason);
      if (!check.allowed) {
        if (check.reason === 'forbidden_role') throw new ProblemException('FORBIDDEN', `Role "${role ?? 'none'}" may not record ${input.decision}`);
        if (check.reason === 'reason_required') throw new ProblemException('VALIDATION_FAILED', 'A reason is required', { reason: ['required'] });
        throw new ProblemException('CONFLICT', `Cannot ${input.decision} a finding that is ${identity.status}`);
      }
      const reason = input.reason.trim();
      const from = identity.status as LifecycleStatus;
      const updated = await tx.findingIdentity.update({ where: { id: identityId }, data: {
        status: check.to, statusChangedAt: new Date(), statusDecidedBy: actor.id ?? 'unknown', statusReason: reason } });
      // A false positive must be durable: it feeds the fingerprint suppression store.
      if (check.to === 'false_positive') {
        const existing = await tx.suppression.findFirst({ where: { projectId, fingerprint: identity.fingerprint } });
        if (!existing) await tx.suppression.create({ data: { id: newId('suppression'), projectId, fingerprint: identity.fingerprint, markedBy: actor.id ?? 'unknown', reason } });
      }
      if (input.decision === 'reopen' && from === 'false_positive') {
        await tx.suppression.deleteMany({ where: { projectId, fingerprint: identity.fingerprint } });
      }
      return { updated, from, to: check.to };
    });
    await this.trail.record({ projectId, actorType: actor.type, actorId: actor.id, action: 'finding.status.transition',
      resourceType: 'FindingIdentity', resourceId: identityId, diff: { status: { from, to } } as never,
      metadata: { decision: input.decision, reason: input.reason.trim(), role }, outcome: 'allowed' });
    return updated;
  }
}

export interface AuditOutcomeInput { projectId: string; auditId: string; completed: boolean; succeededCategories: readonly string[] }
export interface StatusChange { identityId: string; from: LifecycleStatus; to: LifecycleStatus }

/**
 * Applies observation transitions for one settled audit, inside the caller's
 * transaction. Returns the changes so the caller can append them to the audit
 * event log.
 */
export async function applyAuditOutcome(tx: Db, input: AuditOutcomeInput): Promise<StatusChange[]> {
  const seenRows = await tx.finding.findMany({ where: { auditId: input.auditId }, select: { identityId: true } });
  const seen = new Set<string>(seenRows.map((r: any) => r.identityId));
  const identities = await tx.findingIdentity.findMany({
    where: { projectId: input.projectId, mergedIntoIdentityId: null, status: { notIn: ['false_positive', 'accepted_risk'] } },
    select: { id: true, status: true, firstSeenAuditId: true, findings: { take: 1, select: { origin: true, reproduction: true } } },
  });
  const ran = new Set(input.succeededCategories);
  const changes: StatusChange[] = [];
  for (const identity of identities) {
    const status = identity.status as LifecycleStatus;
    const producers = identity.findings[0] ? producingCategories(identity.findings[0].origin, identity.findings[0].reproduction) : null;
    const covered = !!producers && producers.every(category => ran.has(category));
    const isSeen = seen.has(identity.id);
    const next = observe({ identityId: identity.id, status, seen: isSeen, covered }, input.completed)
      ?? (isSeen ? promoteNew(status, identity.firstSeenAuditId, input.auditId) : undefined);
    if (!next || next === status) continue;
    await tx.findingIdentity.update({ where: { id: identity.id }, data: { status: next, statusChangedAt: new Date(), statusDecidedBy: 'system', statusReason: `audit ${input.auditId}` } });
    changes.push({ identityId: identity.id, from: status, to: next });
  }
  return changes;
}
