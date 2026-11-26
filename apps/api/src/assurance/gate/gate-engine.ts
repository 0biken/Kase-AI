/**
 * M6 — Pure deterministic gate engine (Workstream B1).
 *
 * `evaluateGate` is a pure function: given the same findings, evidence, policy,
 * waivers, and `now`, it always returns the same decision. It contains no model
 * call, no probability arithmetic, no I/O, and no clock of its own. Everything
 * it reads is an objective property — an evidence *class* set at capture, a
 * correlation `verified` boolean, a finding status — never an AI-emitted number
 * compared against a threshold.
 *
 * Replay itself is NOT performed here (that is the replay-verifier, Workstream
 * B2). When a replay outcome is known it arrives on the evidence as
 * `replayResult`, and the engine consumes it; an errored replay fails closed.
 *
 * Design source: docs/12-policy-gate/README.md. The invariants this enforces
 * are the TASKS.md "Standing invariants" for the gate.
 */
import type {
  AuditStatus,
  BlockRule,
  CorrelationMethod,
  FindingOrigin,
  FindingStatus,
  ParsedPolicy,
  PolicySource,
  Severity,
  WarnRule,
} from '../policy/policy-schema';

/** Evidence classes. The replayable set is the only thing allowed to block. */
export const REPLAYABLE_EVIDENCE_CLASSES = ['scanner', 'http_replay', 'regression_test'] as const;
export const NON_REPLAYABLE_EVIDENCE_CLASSES = ['screenshot', 'trace', 'console_log', 'prose', 'ai_inference'] as const;
export type EvidenceClass =
  | (typeof REPLAYABLE_EVIDENCE_CLASSES)[number]
  | (typeof NON_REPLAYABLE_EVIDENCE_CLASSES)[number];

const REPLAYABLE = new Set<EvidenceClass>(REPLAYABLE_EVIDENCE_CLASSES);

export type ReplayResult = 'reproduced' | 'not_reproduced' | 'error';

export interface GateEvidenceInput {
  id: string;
  class: EvidenceClass;
  /** Evidence integrity check. A failed check makes the artifact non-eligible
   *  (12-policy-gate §7), regardless of class. */
  integrityOk: boolean;
  /** Only meaningful for `http_replay`; filled by the replay-verifier (B2). */
  replayResult?: ReplayResult;
}

export interface GateFindingInput {
  findingId: string;
  fingerprint: string;
  identityStatus: FindingStatus;
  severity: Severity;
  origin: FindingOrigin;
  category: string;
  /** Present for correlated findings; a block requires `verified: true`. */
  correlation?: { method: CorrelationMethod; verified: boolean } | null;
  /** Build provenance for this finding's correlation (M2). */
  provenanceVerified?: boolean;
  sourceLocation?: { file: string; enclosingSymbol: string; verified: boolean } | null;
  evidence: GateEvidenceInput[];
}

export interface GateWaiverInput {
  fingerprint: string;
  expiresAt: Date;
  approvedBy: string;
  requestedBy: string;
}

export interface GateSuppressionInput {
  fingerprint: string;
}

export interface GateAuditInput {
  status: AuditStatus;
  degraded: boolean;
  executedCategories: string[];
}

export interface GateInput {
  audit: GateAuditInput;
  findings: GateFindingInput[];
  policy: ParsedPolicy;
  waivers: GateWaiverInput[];
  suppressions: GateSuppressionInput[];
  now: Date;
}

export type GateOutcome = 'pass' | 'fail' | 'partial';

export interface BlockingEntry {
  findingId: string;
  fingerprint: string;
  severity: Severity;
  category: string;
  /** The exact policy clause that produced the block, e.g. "block_on[0] source=deterministic severity=critical". */
  rule: string;
  evidence: Array<{ id: string; class: EvidenceClass; replayResult?: ReplayResult }>;
  sourceLocation?: { file: string; enclosingSymbol: string; verified: boolean } | null;
}

export interface WarningEntry {
  findingId?: string;
  fingerprint?: string;
  reason: string;
}

export interface WaivedEntry {
  fingerprint: string;
  expiresAt: Date;
  approvedBy: string;
  daysRemaining: number;
  findingIds: string[];
}

export interface GateDecision {
  outcome: GateOutcome;
  mode: ParsedPolicy['mode'];
  blocking: BlockingEntry[];
  warnings: WarningEntry[];
  waived: WaivedEntry[];
  notExecutedCategories: string[];
  degraded: boolean;
}

const DAY_MS = 86_400_000;

/** Maps a storage `origin` to the policy's `source` vocabulary. A correlated
 *  finding counts as deterministic only when its correlation is verified. */
function sourceOf(f: GateFindingInput): PolicySource {
  if (f.origin === 'tool' || f.origin === 'whitebox') return 'deterministic';
  if (f.origin === 'correlated') return f.correlation?.verified ? 'deterministic' : 'agent';
  return 'agent';
}

/** True when the finding carries at least one replayable-class artifact that is
 *  integrity-sound and not cleared by a replay. An http_replay that did not
 *  reproduce clears that artifact; an errored replay stays eligible (fail
 *  closed); any other replayable class is eligible on integrity alone. */
function blockEligibleEvidence(f: GateFindingInput): GateEvidenceInput[] {
  return f.evidence.filter((e) => {
    if (!REPLAYABLE.has(e.class) || !e.integrityOk) return false;
    if (e.class === 'http_replay' && e.replayResult === 'not_reproduced') return false;
    return true;
  });
}

function matchesCondition(f: GateFindingInput, rule: BlockRule | WarnRule): boolean {
  if (rule.source && sourceOf(f) !== rule.source) return false;
  if (rule.category && !rule.category.includes(f.category)) return false;
  if (rule.severity && !rule.severity.includes(f.severity)) return false;
  if ('finding_status' in rule && rule.finding_status && !rule.finding_status.includes(f.identityStatus)) return false;
  return true;
}

function describeRule(rule: BlockRule | WarnRule): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(rule)) parts.push(`${k}=${Array.isArray(v) ? v.join('|') : String(v)}`);
  return parts.join(' ');
}

export function evaluateGate(input: GateInput): GateDecision {
  const { audit, policy, now } = input;
  const mode = policy.mode;

  const notExecutedCategories = policy.required_categories.filter((c) => !audit.executedCategories.includes(c));

  const suppressed = new Set(input.suppressions.map((s) => s.fingerprint));

  // Earliest-expiring active (non-expired) waiver per fingerprint.
  const activeWaivers = new Map<string, GateWaiverInput>();
  for (const w of input.waivers) {
    if (w.expiresAt.getTime() <= now.getTime()) continue; // expired → no effect; the finding blocks again
    const prev = activeWaivers.get(w.fingerprint);
    if (!prev || w.expiresAt.getTime() < prev.expiresAt.getTime()) activeWaivers.set(w.fingerprint, w);
  }

  const blocking: BlockingEntry[] = [];
  const warnings: WarningEntry[] = [];
  const waivedFindings = new Map<string, string[]>(); // fingerprint -> findingIds

  for (const f of input.findings) {
    // A confirmed false positive is durably suppressed and leaves the evaluation
    // entirely — it is not even warned (12-policy-gate §9).
    if (suppressed.has(f.fingerprint)) continue;

    const eligibleEvidence = blockEligibleEvidence(f);
    const hasReplayable = eligibleEvidence.length > 0;

    // Correlation verification gate: a correlated finding may block only when
    // its correlation is verified and not AI-inferred.
    const correlationBlocks =
      !f.correlation || (f.correlation.verified && f.correlation.method !== 'ai_inference');
    // Unverified build provenance downgrades correlated findings to advisory
    // without losing them (M5 exit criterion 2 / 12-policy-gate §7).
    const provenanceDowngrade =
      f.correlation != null &&
      f.provenanceVerified === false &&
      policy.fail_closed.provenance_verified === 'false_blocks_correlated_findings_only';

    // First block_on clause this finding matches by its narrowing conditions.
    const matchedIndex = policy.block_on.findIndex(
      (r) => !r.regression && !r.required_categories_not_executed && hasMatchableCondition(r) && matchesCondition(f, r),
    );
    const matched = matchedIndex >= 0 ? policy.block_on[matchedIndex] : undefined;

    // warn_on evaluation is independent of block_on and always runs.
    for (const [i, w] of policy.warn_on.entries()) {
      if (warnRuleMatches(f, w)) {
        warnings.push({ findingId: f.findingId, fingerprint: f.fingerprint, reason: `warn_on[${i}] ${describeRule(w)}` });
      }
    }

    if (!matched) continue;

    const ruleLabel = `block_on[${matchedIndex}] ${describeRule(matched)}`;

    // A matched clause that cannot block is downgraded to a warning, never
    // silently dropped — the reviewer still sees why it did not fire.
    if (!hasReplayable) {
      warnings.push({ findingId: f.findingId, fingerprint: f.fingerprint, reason: `downgraded: ${ruleLabel} has no replayable evidence` });
      continue;
    }
    if (!correlationBlocks) {
      const why = f.correlation?.method === 'ai_inference' ? 'ai-inferred correlation is advisory' : 'correlation not verified';
      warnings.push({ findingId: f.findingId, fingerprint: f.fingerprint, reason: `downgraded: ${ruleLabel} (${why})` });
      continue;
    }
    if (provenanceDowngrade) {
      warnings.push({ findingId: f.findingId, fingerprint: f.fingerprint, reason: `downgraded: ${ruleLabel} (build provenance unverified)` });
      continue;
    }

    // Rollout mode decides whether a true block is enforced this run.
    if (!modeEnforces(mode, f)) {
      warnings.push({ findingId: f.findingId, fingerprint: f.fingerprint, reason: `advisory under mode=${mode}: ${ruleLabel}` });
      continue;
    }

    // Active waiver on this fingerprint: release allowed, recorded, reported.
    const waiver = activeWaivers.get(f.fingerprint);
    if (waiver) {
      const ids = waivedFindings.get(f.fingerprint) ?? [];
      ids.push(f.findingId);
      waivedFindings.set(f.fingerprint, ids);
      continue;
    }

    blocking.push({
      findingId: f.findingId,
      fingerprint: f.fingerprint,
      severity: f.severity,
      category: f.category,
      rule: ruleLabel,
      evidence: eligibleEvidence.map((e) => ({ id: e.id, class: e.class, replayResult: e.replayResult })),
      sourceLocation: f.sourceLocation ?? null,
    });
  }

  const waived: WaivedEntry[] = [...waivedFindings.entries()].map(([fingerprint, findingIds]) => {
    const w = activeWaivers.get(fingerprint)!;
    return {
      fingerprint,
      expiresAt: w.expiresAt,
      approvedBy: w.approvedBy,
      daysRemaining: Math.ceil((w.expiresAt.getTime() - now.getTime()) / DAY_MS),
      findingIds,
    };
  });

  const outcome = decideOutcome({ audit, blocking, notExecutedCategories });
  return { outcome, mode, blocking, warnings, waived, notExecutedCategories, degraded: audit.degraded };
}

function hasMatchableCondition(r: BlockRule): boolean {
  return Boolean(r.source || r.category || r.severity || r.finding_status);
}

function warnRuleMatches(f: GateFindingInput, w: WarnRule): boolean {
  if (w.correlation_method) return f.correlation != null && w.correlation_method.includes(f.correlation.method);
  if (w.provenance_unverified) return f.provenanceVerified === false;
  if (w.requires_replayable_evidence === false) {
    // "agent findings whose evidence is not replayable" style warnings.
    if (!matchesCondition(f, w)) return false;
    return blockEligibleEvidence(f).length === 0;
  }
  if (w.source || w.category || w.severity) return matchesCondition(f, w);
  return false;
}

function modeEnforces(mode: ParsedPolicy['mode'], f: GateFindingInput): boolean {
  if (mode === 'full') return true;
  if (mode === 'observe') return false; // phase 1: evaluates and reports, never blocks
  // block_critical: only deterministic criticals are enforced.
  return f.severity === 'critical' && sourceOf(f) === 'deterministic';
}

/**
 * Outcome is fail-closed and never collapses PARTIAL into PASS:
 *  - any enforced block, a missing required category, or a failed audit → FAIL
 *  - an incomplete audit (not completed, e.g. cancelled/running) → FAIL
 *  - a partial or degraded audit → PARTIAL
 *  - only a clean, complete, non-degraded audit with nothing blocking → PASS
 */
function decideOutcome(args: {
  audit: GateAuditInput;
  blocking: BlockingEntry[];
  notExecutedCategories: string[];
}): GateOutcome {
  const { audit, blocking, notExecutedCategories } = args;
  if (blocking.length > 0) return 'fail';
  if (notExecutedCategories.length > 0) return 'fail';
  if (audit.status === 'failed' || audit.status === 'cancelled') return 'fail';
  if (audit.status === 'partial' || audit.degraded) return 'partial';
  if (audit.status === 'completed') return 'pass';
  return 'fail'; // queued/running — cannot make a claim, fail closed
}
