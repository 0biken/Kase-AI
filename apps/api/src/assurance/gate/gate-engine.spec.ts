import { evaluateGate, type GateFindingInput, type GateInput } from './gate-engine';
import { parsePolicy, type ParsedPolicy } from '../policy/policy-schema';

const NOW = new Date('2026-10-01T00:00:00.000Z');
const DAY = 86_400_000;

function policy(over: Record<string, unknown> = {}): ParsedPolicy {
  return parsePolicy({
    version: 1,
    name: 't',
    mode: 'full',
    block_on: [{ severity: ['critical'] }],
    waivers: { max_duration_days: 30, require_separate_approver: true, warn_before_expiry_days: 7 },
    ...over,
  });
}

function finding(over: Partial<GateFindingInput> = {}): GateFindingInput {
  return {
    findingId: 'f1',
    fingerprint: 'fp1',
    identityStatus: 'open',
    severity: 'critical',
    origin: 'tool',
    category: 'static_security',
    evidence: [{ id: 'e1', class: 'scanner', integrityOk: true }],
    ...over,
  };
}

function input(over: Partial<GateInput> = {}): GateInput {
  return {
    audit: { status: 'completed', degraded: false, executedCategories: [] },
    findings: [],
    policy: policy(),
    waivers: [],
    suppressions: [],
    now: NOW,
    ...over,
  };
}

describe('M6 gate engine — invariants', () => {
  it('blocks a critical deterministic finding carrying replayable scanner evidence → FAIL', () => {
    const d = evaluateGate(input({ findings: [finding()] }));
    expect(d.outcome).toBe('fail');
    expect(d.blocking).toHaveLength(1);
    expect(d.blocking[0].rule).toMatch(/^block_on\[0\]/u);
    expect(d.blocking[0].evidence[0].class).toBe('scanner');
  });

  it('a clean, completed, non-degraded audit with nothing blocking is PASS', () => {
    expect(evaluateGate(input()).outcome).toBe('pass');
  });

  // --- PARTIAL is never PASS -------------------------------------------------
  it('a partial audit is PARTIAL, never PASS', () => {
    expect(evaluateGate(input({ audit: { status: 'partial', degraded: false, executedCategories: [] } })).outcome).toBe('partial');
  });

  it('a degraded but completed audit is PARTIAL, never PASS', () => {
    expect(evaluateGate(input({ audit: { status: 'completed', degraded: true, executedCategories: [] } })).outcome).toBe('partial');
  });

  it('a failed audit fails closed', () => {
    expect(evaluateGate(input({ audit: { status: 'failed', degraded: false, executedCategories: [] } })).outcome).toBe('fail');
  });

  it('an incomplete (running) audit fails closed — cannot make a claim', () => {
    expect(evaluateGate(input({ audit: { status: 'running', degraded: false, executedCategories: [] } })).outcome).toBe('fail');
  });

  // --- Evidence-class gating -------------------------------------------------
  it('an AI-only finding (non-replayable evidence) cannot block; it is downgraded to a warning', () => {
    const d = evaluateGate(input({
      findings: [finding({ origin: 'blackbox', evidence: [{ id: 'p', class: 'prose', integrityOk: true }] })],
    }));
    expect(d.outcome).toBe('pass');
    expect(d.blocking).toHaveLength(0);
    expect(d.warnings.some((w) => /no replayable evidence/u.test(w.reason))).toBe(true);
  });

  it('evidence that fails its integrity check cannot block', () => {
    const d = evaluateGate(input({
      findings: [finding({ evidence: [{ id: 'e1', class: 'scanner', integrityOk: false }] })],
    }));
    expect(d.outcome).toBe('pass');
    expect(d.blocking).toHaveLength(0);
  });

  it('an http_replay that did not reproduce clears the block (finding is fixed)', () => {
    const d = evaluateGate(input({
      findings: [finding({ evidence: [{ id: 'h', class: 'http_replay', integrityOk: true, replayResult: 'not_reproduced' }] })],
    }));
    expect(d.outcome).toBe('pass');
    expect(d.blocking).toHaveLength(0);
  });

  it('an errored replay fails closed — the block stands', () => {
    const d = evaluateGate(input({
      findings: [finding({ evidence: [{ id: 'h', class: 'http_replay', integrityOk: true, replayResult: 'error' }] })],
    }));
    expect(d.outcome).toBe('fail');
    expect(d.blocking).toHaveLength(1);
  });

  // --- Coverage --------------------------------------------------------------
  it('a required category that did not execute fails closed and is reported', () => {
    const p = policy({ block_on: [], required_categories: ['security'] });
    const miss = evaluateGate(input({ policy: p, audit: { status: 'completed', degraded: false, executedCategories: [] } }));
    expect(miss.outcome).toBe('fail');
    expect(miss.notExecutedCategories).toEqual(['security']);
    const ok = evaluateGate(input({ policy: p, audit: { status: 'completed', degraded: false, executedCategories: ['security'] } }));
    expect(ok.outcome).toBe('pass');
  });

  // --- Correlation verification ---------------------------------------------
  it('a correlated finding blocks only when its correlation is verified', () => {
    const unverified = evaluateGate(input({
      findings: [finding({ origin: 'correlated', correlation: { method: 'runtime_dump', verified: false } })],
    }));
    expect(unverified.outcome).toBe('pass');
    expect(unverified.warnings.some((w) => /not verified/u.test(w.reason))).toBe(true);

    const verified = evaluateGate(input({
      findings: [finding({ origin: 'correlated', correlation: { method: 'runtime_dump', verified: true } })],
    }));
    expect(verified.outcome).toBe('fail');
  });

  it('an AI-inferred correlation is advisory and never blocks (no number is thresholded)', () => {
    const d = evaluateGate(input({
      findings: [finding({ origin: 'correlated', correlation: { method: 'ai_inference', verified: true } })],
    }));
    expect(d.outcome).toBe('pass');
    expect(d.blocking).toHaveLength(0);
    expect(d.warnings.some((w) => /advisory/u.test(w.reason))).toBe(true);
  });

  it('removing build provenance downgrades a correlated finding to advisory without losing it', () => {
    const p = policy({ fail_closed: { audit_status: ['failed', 'partial'], provenance_verified: 'false_blocks_correlated_findings_only' } });
    const base = finding({ origin: 'correlated', correlation: { method: 'runtime_dump', verified: true } });
    const downgraded = evaluateGate(input({ policy: p, findings: [{ ...base, provenanceVerified: false }] }));
    expect(downgraded.outcome).toBe('pass');
    expect(downgraded.warnings.some((w) => /provenance unverified/u.test(w.reason))).toBe(true);
    const kept = evaluateGate(input({ policy: p, findings: [{ ...base, provenanceVerified: true }] }));
    expect(kept.outcome).toBe('fail');
  });

  // --- Suppressions and waivers ---------------------------------------------
  it('a durably suppressed false positive is excluded entirely — not even warned', () => {
    const p = policy({ warn_on: [{ provenance_unverified: true }] });
    const d = evaluateGate(input({
      policy: p,
      findings: [finding({ provenanceVerified: false })],
      suppressions: [{ fingerprint: 'fp1' }],
    }));
    expect(d.outcome).toBe('pass');
    expect(d.blocking).toHaveLength(0);
    expect(d.warnings).toHaveLength(0);
  });

  it('an active waiver moves a block to waived, allows release, and reports daysRemaining', () => {
    const d = evaluateGate(input({
      findings: [finding()],
      waivers: [{ fingerprint: 'fp1', expiresAt: new Date(NOW.getTime() + 9 * DAY), approvedBy: 'alex@example.com', requestedBy: 'sam@example.com' }],
    }));
    expect(d.outcome).toBe('pass');
    expect(d.blocking).toHaveLength(0);
    expect(d.waived).toHaveLength(1);
    expect(d.waived[0].daysRemaining).toBe(9);
    expect(d.waived[0].findingIds).toEqual(['f1']);
  });

  it('an expired waiver has no effect — the finding blocks again', () => {
    const d = evaluateGate(input({
      findings: [finding()],
      waivers: [{ fingerprint: 'fp1', expiresAt: new Date(NOW.getTime() - DAY), approvedBy: 'a', requestedBy: 'b' }],
    }));
    expect(d.outcome).toBe('fail');
    expect(d.blocking).toHaveLength(1);
    expect(d.waived).toHaveLength(0);
  });

  // --- Rollout modes ---------------------------------------------------------
  it('observe mode evaluates and reports but never blocks a finding', () => {
    const d = evaluateGate(input({ policy: policy({ mode: 'observe' }), findings: [finding()] }));
    expect(d.outcome).toBe('pass');
    expect(d.blocking).toHaveLength(0);
    expect(d.warnings.some((w) => /mode=observe/u.test(w.reason))).toBe(true);
  });

  it('block_critical mode enforces only deterministic criticals', () => {
    const p = policy({ mode: 'block_critical', block_on: [{ severity: ['critical', 'high'] }] });
    const detCrit = evaluateGate(input({ policy: p, findings: [finding({ severity: 'critical', origin: 'tool' })] }));
    expect(detCrit.outcome).toBe('fail');
    const agentCrit = evaluateGate(input({
      policy: p,
      findings: [finding({ severity: 'critical', origin: 'blackbox', evidence: [{ id: 'h', class: 'http_replay', integrityOk: true, replayResult: 'reproduced' }] })],
    }));
    expect(agentCrit.outcome).toBe('pass');
    const detHigh = evaluateGate(input({ policy: p, findings: [finding({ severity: 'high', origin: 'tool' })] }));
    expect(detHigh.outcome).toBe('pass');
  });

  // --- Explainability --------------------------------------------------------
  it('every block cites the exact policy clause and its supporting evidence', () => {
    const d = evaluateGate(input({ findings: [finding({ sourceLocation: { file: 'src/x.ts', enclosingSymbol: 'X.find', verified: true } })] }));
    expect(d.blocking[0].rule).toMatch(/^block_on\[\d+\] .*severity=critical/u);
    expect(d.blocking[0].evidence.length).toBeGreaterThan(0);
    expect(d.blocking[0].sourceLocation).toEqual({ file: 'src/x.ts', enclosingSymbol: 'X.find', verified: true });
  });

  // --- Finding status rules --------------------------------------------------
  it('a regressed high-severity finding blocks via the finding_status clause', () => {
    const p = policy({ block_on: [{ finding_status: ['regressed'], severity: ['critical', 'high'] }] });
    const d = evaluateGate(input({ policy: p, findings: [finding({ identityStatus: 'regressed', severity: 'high' })] }));
    expect(d.outcome).toBe('fail');
  });

  it('a not_reproduced finding does not open the gate (a vanished finding stays blocking)', () => {
    const d = evaluateGate(input({ findings: [finding({ identityStatus: 'not_reproduced' })] }));
    expect(d.outcome).toBe('fail');
    expect(d.blocking).toHaveLength(1);
  });

  // --- warn_on ---------------------------------------------------------------
  it('warn_on produces warnings without affecting a PASS', () => {
    const p = policy({ block_on: [], warn_on: [{ provenance_unverified: true }] });
    const d = evaluateGate(input({ policy: p, findings: [finding({ provenanceVerified: false })] }));
    expect(d.outcome).toBe('pass');
    expect(d.warnings.some((w) => /warn_on\[0\]/u.test(w.reason))).toBe(true);
  });

  // --- Determinism -----------------------------------------------------------
  it('is a pure function: identical inputs yield identical decisions', () => {
    const build = () => input({
      findings: [finding(), finding({ findingId: 'f2', fingerprint: 'fp2', origin: 'correlated', correlation: { method: 'ai_inference', verified: true } })],
      waivers: [{ fingerprint: 'fp1', expiresAt: new Date(NOW.getTime() + 3 * DAY), approvedBy: 'a', requestedBy: 'b' }],
    });
    expect(evaluateGate(build())).toEqual(evaluateGate(build()));
  });
});
