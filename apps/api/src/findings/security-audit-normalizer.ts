import { computeFingerprint, computeSeverity, syntheticRuleKey } from '../agent-runtime/capabilities/finding-authority';
import type { SecurityAuditFinding } from '../adapters/security-audit/security-audit.schema';

/** Category imported findings report under, matching the policy's `security` category name. */
export const SECURITY_AUDIT_CATEGORY = 'security';

export interface ImportedFinding {
  fingerprint: string; ruleId: string; category: string; cwe: string | undefined; title: string;
  severity: string; severitySource: string; description: string; impact: string; rootCause: string;
  fix: string; fixPatch: string | undefined; reproduction: Record<string, unknown>;
  confidenceBand: string; aiGenerated: true; gateEligible: false; verdict: 'confirmed' | 'needs_validation';
  /** Upstream fingerprint, kept as metadata only; never an input to the Kase fingerprint. */
  upstreamFingerprint: string;
  /** Other upstream records that share this Kase identity (same entrypoint and sink), folded in here. */
  merged: Array<{ upstreamFingerprint: string; verdict: string; title: string }>;
  sourceLocations: Array<{ file: string; enclosingSymbol: string; line: number; role: string }>;
  blockers: string[];
}

export interface NormalizedImport {
  findings: ImportedFinding[];
  /** Candidates disproved upstream; recorded as coverage, never as findings. */
  rejected: Array<{ upstreamFingerprint: string; title: string; reason: string }>;
}

// The upstream schema has no CWE field, so the CWE is read from the record's text. It informs
// severity floors and display only; it is never a fingerprint input, since prose is reworded across runs.
const CWE_PATTERN = /\bCWE-\d{1,5}\b/u;
const SEVERITY_RANK: Record<string, number> = { informational: 0, low: 1, medium: 2, high: 3, critical: 4 };

export function normalizeSecurityAudit(records: SecurityAuditFinding[], context: { target: string }): NormalizedImport {
  const rejected: NormalizedImport['rejected'] = [];
  const byFingerprint = new Map<string, ImportedFinding>();
  for (const record of records) {
    if (record.verdict === 'rejected') {
      rejected.push({ upstreamFingerprint: record.fingerprint, title: record.title, reason: record.reason });
      continue;
    }
    const finding = toFinding(record, context.target);
    const existing = byFingerprint.get(finding.fingerprint);
    if (!existing) { byFingerprint.set(finding.fingerprint, finding); continue; }
    // One Kase identity per entrypoint→sink path: keep the strongest record, fold the rest in visibly.
    const [keep, fold] = outranks(finding, existing) ? [finding, existing] : [existing, finding];
    keep.merged.push({ upstreamFingerprint: fold.upstreamFingerprint, verdict: fold.verdict, title: fold.title }, ...fold.merged);
    keep.blockers = [...new Set([...keep.blockers, ...fold.blockers])];
    byFingerprint.set(keep.fingerprint, keep);
  }
  return { findings: [...byFingerprint.values()], rejected };
}

function outranks(a: ImportedFinding, b: ImportedFinding): boolean {
  if (a.verdict !== b.verdict) return a.verdict === 'confirmed';
  return (SEVERITY_RANK[a.severity] ?? 0) > (SEVERITY_RANK[b.severity] ?? 0);
}

function toFinding(record: Exclude<SecurityAuditFinding, { verdict: 'rejected' }>, target: string): ImportedFinding {
  const entry = record.trace.find(t => t.kind === 'entrypoint') ?? record.trace[0];
  const sink = record.trace.find(t => t.kind === 'sink') ?? record.trace[record.trace.length - 1];
  const rootCause = record.verdict === 'confirmed' ? record.root_cause : record.claimed_root_cause;
  const cwe = CWE_PATTERN.exec(`${record.title}\n${record.description}\n${rootCause}`)?.[0];
  const ruleId = syntheticRuleKey('whitebox', SECURITY_AUDIT_CATEGORY);
  // Deterministic structural inputs only (ADR-004): entrypoint and sink as file + enclosing scope.
  // No line numbers, no prose, no CWE scraped from prose.
  const fingerprint = computeFingerprint({ category: SECURITY_AUDIT_CATEGORY, ruleKey: ruleId, target,
    endpoint: `${normalizePath(entry.file)}#${entry.scope}`, enclosingSymbol: `${normalizePath(sink.file)}#${sink.scope}` });
  // SourceLocation is keyed by file + enclosing symbol; repeated steps within one scope collapse to the first.
  const seen = new Set<string>();
  const sourceLocations = record.trace.flatMap(t => {
    const key = `${normalizePath(t.file)}\u001f${t.scope}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ file: normalizePath(t.file), enclosingSymbol: t.scope, line: t.line, role: t.kind }];
  });
  const base = { fingerprint, ruleId, category: SECURITY_AUDIT_CATEGORY, cwe, title: record.title,
    description: record.description, rootCause, aiGenerated: true as const, gateEligible: false as const,
    upstreamFingerprint: record.fingerprint, merged: [], sourceLocations };
  if (record.verdict === 'confirmed') {
    // The skill's severity is only a proposal; Kase floors may raise it, never lower it.
    const severity = computeSeverity(record.severity.overall_severity, cwe, SECURITY_AUDIT_CATEGORY);
    return { ...base, ...severity, verdict: 'confirmed', impact: record.severity.impact.reason,
      fix: record.remediation.strategy, fixPatch: record.remediation.code_changes?.map(c => `// ${c.file_name}\n${c.fixed_code}`).join('\n\n') || undefined,
      reproduction: { kind: 'code_location', source: 'security_audit_skill', execution: record.execution, conditions: record.conditions },
      confidenceBand: record.confidence.score, blockers: [] };
  }
  // An unvalidated lead is not a finding yet: no severity at all, so CWE floors do not apply.
  return { ...base, severity: 'informational', severitySource: 'unvalidated_lead', verdict: 'needs_validation',
    impact: 'Unvalidated lead; impact not established.',
    fix: record.validation_plan.local ?? record.validation_plan.deployment ?? 'Validate the open blockers before remediation.',
    fixPatch: undefined, reproduction: { kind: 'code_location', source: 'security_audit_skill', validationPlan: record.validation_plan },
    confidenceBand: 'low', blockers: record.blockers };
}

function normalizePath(file: string): string {
  return file.replace(/\\/gu, '/').replace(/^\.\//u, '');
}
