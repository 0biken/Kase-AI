/**
 * Finding authority rules for agent-created findings.
 *
 * - Severity is always recomputed centrally (ADR-001).
 * - Fingerprints use deterministic inputs only — no AI prose or line numbers (ADR-004).
 * - Agent findings remain gateEligible: false until M5 correlation (spec).
 * - CWE-639 IDOR receives authoritative 'high' severity.
 */

import { createHash } from 'node:crypto';

// ---------------------------------------------------------------------------
// Severity
// ---------------------------------------------------------------------------

/**
 * CWE-based severity floors. These are authoritative — the agent's proposed
 * severity is advisory input that may only raise, never lower, the floor.
 */
const SEVERITY_FLOORS: Record<string, string> = {
  'CWE-639': 'high',     // IDOR — Authorization Bypass Through User-Controlled Key
  'CWE-285': 'high',     // Improper Authorization
  'CWE-862': 'high',     // Missing Authorization
  'CWE-863': 'high',     // Incorrect Authorization
  'CWE-89': 'critical',  // SQL Injection
  'CWE-78': 'critical',  // OS Command Injection
  'CWE-79': 'medium',    // Cross-site Scripting
  'CWE-502': 'high',     // Deserialization of Untrusted Data
  'CWE-918': 'high',     // Server-Side Request Forgery
  'CWE-22': 'high',      // Path Traversal
};

const SEVERITY_ORDER: Record<string, number> = {
  informational: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

/**
 * Compute authoritative severity.
 *
 * The engine enforces CWE-based floors and category-based minimums.
 * The agent's proposal is advisory — it may raise but never lower the floor.
 */
export function computeSeverity(
  proposedSeverity: string,
  cwe?: string,
  category?: string,
): { severity: string; severitySource: string } {
  let floor = 'informational';
  let source = 'agent_proposed';

  // CWE floor
  if (cwe && SEVERITY_FLOORS[cwe]) {
    const cweSeverity = SEVERITY_FLOORS[cwe];
    if ((SEVERITY_ORDER[cweSeverity] ?? 0) > (SEVERITY_ORDER[floor] ?? 0)) {
      floor = cweSeverity;
      source = 'cwe_floor';
    }
  }

  // Category floor: authorization/injection findings are at least high
  if (category) {
    const lc = category.toLowerCase();
    if (lc === 'authorization' || lc === 'injection' || lc === 'authentication') {
      if ((SEVERITY_ORDER['high'] ?? 0) > (SEVERITY_ORDER[floor] ?? 0)) {
        floor = 'high';
        source = 'category_floor';
      }
    }
  }

  // Agent proposal may raise above floor but never lower
  const proposed = proposedSeverity.toLowerCase();
  if ((SEVERITY_ORDER[proposed] ?? 0) > (SEVERITY_ORDER[floor] ?? 0)) {
    return { severity: proposed, severitySource: 'agent_proposed' };
  }

  return { severity: floor, severitySource: source };
}

// ---------------------------------------------------------------------------
// Fingerprinting
// ---------------------------------------------------------------------------

/**
 * Compute a deterministic fingerprint for an agent finding.
 *
 * Inputs (ADR-004): category, synthetic Kase rule key, normalized
 * target/endpoint, and CWE. Enclosing symbol is used instead of
 * line numbers. AI prose is never included.
 *
 * The separator is U+001F (unit separator) — an unprintable character
 * that cannot appear in any of the components.
 */
export function computeFingerprint(input: {
  category: string;
  ruleKey: string;
  target: string;
  endpoint?: string;
  cwe?: string;
  enclosingSymbol?: string;
}): string {
  const parts = [
    input.category,
    input.ruleKey,
    input.target,
    input.endpoint ?? '',
    input.cwe ?? '',
    input.enclosingSymbol ?? '',
  ];

  const material = parts.join('\u001f');
  return createHash('sha256').update(material, 'utf8').digest('hex');
}

/**
 * Construct a synthetic Kase rule key for agent-originated findings.
 *
 * Agent findings don't come from a scanner rule, so we construct a
 * deterministic key from the origin and category to keep fingerprints
 * stable across runs.
 */
export function syntheticRuleKey(origin: 'blackbox' | 'whitebox', category: string): string {
  return `kase.agent.${origin}.${category.toLowerCase().replace(/[^a-z0-9_-]/g, '_')}`;
}

// ---------------------------------------------------------------------------
// Gate eligibility
// ---------------------------------------------------------------------------

/**
 * Agent findings are NOT gate-eligible in M4.
 *
 * M5 will supply verified correlation, at which point correlated findings
 * may become gate-eligible. Until then, agent findings are informational
 * from the gate's perspective.
 */
export const AGENT_FINDING_GATE_ELIGIBLE = false;
