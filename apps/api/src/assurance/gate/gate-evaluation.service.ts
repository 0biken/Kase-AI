import { Inject, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditTrailService } from '../../audit-trail/audit-trail.service';
import { newId } from '../../common/ids';
import { ProblemException } from '../../common/problem-details';
import type { Actor } from '../../projects/projects.service';
import { GatePolicyService } from '../policy/gate-policy.service';
import {
  evaluateGate,
  type GateDecision,
  type GateEvidenceInput,
  type GateFindingInput,
} from './gate-engine';
import { classifyEvidence, evidenceIntegrityOk } from './evidence-classification';
import { REPLAY_VERIFIER, type ReplayVerifier } from './replay-verifier';
import type { AuditStatus, CorrelationMethod } from '../policy/policy-schema';

/**
 * Orchestrates a gate evaluation (M6 Workstream B3): load the audit, its active
 * policy, findings, evidence, correlations, waivers and suppressions; replay
 * every blockable `http_replay` artifact; run the pure engine; persist a
 * `GateEvaluation`. All reasoning lives in the pure engine — this service only
 * loads, normalizes, replays, and records.
 *
 * Fail-closed: if the active policy cannot be loaded or parsed, the evaluation
 * is recorded as FAIL rather than throwing (12-policy-gate §7). Persisting the
 * row and the HTTP replay are the only steps that need live infrastructure; the
 * normalization and orchestration are unit-tested with doubles.
 */
@Injectable()
export class GateEvaluationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policies: GatePolicyService,
    private readonly trail: AuditTrailService,
    @Inject(REPLAY_VERIFIER) private readonly replay: ReplayVerifier,
  ) {}

  async evaluate(auditId: string, actor: Actor, now = new Date()): Promise<{ evaluation: unknown; decision: GateDecision }> {
    const audit = await this.prisma.audit.findUnique({ where: { id: auditId } });
    if (!audit) throw new ProblemException('NOT_FOUND', `No audit with id "${auditId}"`);

    // Fail closed on a policy that cannot be loaded/parsed.
    let policyId: string;
    let policyVersion: number;
    let decision: GateDecision;

    let active: Awaited<ReturnType<GatePolicyService['getActiveParsed']>> | null = null;
    try {
      active = await this.policies.getActiveParsed(audit.projectId);
    } catch {
      active = null;
    }

    if (!active) {
      const project = await this.prisma.project.findUnique({ where: { id: audit.projectId }, select: { defaultGatePolicyId: true } });
      policyId = project?.defaultGatePolicyId ?? 'unknown';
      policyVersion = 0;
      decision = failClosedDecision();
    } else {
      policyId = active.id;
      policyVersion = active.version;

      const provenanceVerified = await this.resolveProvenanceVerified(audit.buildProvenanceId);
      const findings = await this.loadFindings(auditId, provenanceVerified);
      await this.applyReplay(auditId, findings);

      const [waivers, suppressions] = await Promise.all([
        this.prisma.waiver.findMany({ where: { projectId: audit.projectId } }),
        this.prisma.suppression.findMany({ where: { projectId: audit.projectId } }),
      ]);

      decision = evaluateGate({
        audit: { status: audit.status as AuditStatus, degraded: audit.degraded, executedCategories: audit.executedCategories },
        findings,
        policy: active.policy,
        waivers: waivers.map((w) => ({ fingerprint: w.fingerprint, expiresAt: w.expiresAt, approvedBy: w.approvedBy, requestedBy: w.requestedBy })),
        suppressions: suppressions.map((s) => ({ fingerprint: s.fingerprint })),
        now,
      });
    }

    const id = newId('gateEvaluation');
    const evaluation = await this.prisma.gateEvaluation.create({
      data: {
        id,
        auditId,
        gatePolicyId: policyId,
        gatePolicyVersion: policyVersion,
        outcome: decision.outcome,
        blockingFindingIds: decision.blocking.map((b) => b.findingId),
        waivedFindingIds: decision.waived.flatMap((w) => w.findingIds),
        notExecutedCategories: decision.notExecutedCategories,
        commitSha: audit.requestedCommitSha ?? null,
      },
    });

    await this.trail.record({
      projectId: audit.projectId,
      actorType: actor.type,
      actorId: actor.id,
      action: 'gate.evaluate',
      resourceType: 'GateEvaluation',
      resourceId: id,
      metadata: {
        auditId,
        outcome: decision.outcome,
        policyLoaded: active !== null,
        blocking: decision.blocking.length,
        waived: decision.waived.length,
      },
      outcome: 'allowed',
    });

    return { evaluation, decision };
  }

  private async resolveProvenanceVerified(buildProvenanceId: string | null): Promise<boolean> {
    if (!buildProvenanceId) return false; // no provenance → treat as unverified
    const prov = await this.prisma.buildProvenance.findUnique({ where: { id: buildProvenanceId }, select: { verified: true } });
    return prov?.verified ?? false;
  }

  private async loadFindings(auditId: string, provenanceVerified: boolean): Promise<GateFindingInput[]> {
    const [rows, correlations] = await Promise.all([
      this.prisma.finding.findMany({
        where: { auditId },
        include: { identity: true, sourceLocations: true, findingEvidence: { include: { evidence: true } } },
      }),
      this.prisma.correlation.findMany({ where: { auditId } }),
    ]);

    // findingId -> correlation method/verified (a finding on either side of a
    // correlation carries that correlation's verification).
    const byFinding = new Map<string, { method: string; verified: boolean }>();
    for (const c of correlations) {
      const info = { method: c.method, verified: c.verified };
      if (c.blackboxFindingId) byFinding.set(c.blackboxFindingId, info);
      if (c.whiteboxFindingId) byFinding.set(c.whiteboxFindingId, info);
    }

    return rows.map((f): GateFindingInput => {
      const correlation = byFinding.get(f.id) ?? null;
      const src = f.sourceLocations.find((s) => s.verified) ?? f.sourceLocations[0];
      const evidence: GateEvidenceInput[] = f.findingEvidence.map((fe) => ({
        id: fe.evidence.id,
        class: classifyEvidence(fe.evidence.type, fe.evidence.replayable),
        integrityOk: evidenceIntegrityOk(fe.evidence),
      }));
      return {
        findingId: f.id,
        fingerprint: f.identity.fingerprint,
        identityStatus: f.identity.status as GateFindingInput['identityStatus'],
        severity: f.severity as GateFindingInput['severity'],
        origin: f.origin as GateFindingInput['origin'],
        category: f.category,
        correlation: correlation ? { method: correlation.method as CorrelationMethod, verified: correlation.verified } : null,
        provenanceVerified,
        sourceLocation: src ? { file: src.file, enclosingSymbol: src.enclosingSymbol, verified: src.verified } : null,
        evidence,
      };
    });
  }

  private async applyReplay(auditId: string, findings: GateFindingInput[]): Promise<void> {
    for (const f of findings) {
      for (const e of f.evidence) {
        if (e.class === 'http_replay' && e.integrityOk && e.replayResult === undefined) {
          e.replayResult = await this.replay.verify({ auditId, evidenceId: e.id });
        }
      }
    }
  }
}

/** No policy to evaluate against → FAIL, with no claimed findings. */
function failClosedDecision(): GateDecision {
  return { outcome: 'fail', mode: 'observe', blocking: [], warnings: [], waived: [], notExecutedCategories: [], degraded: false };
}
