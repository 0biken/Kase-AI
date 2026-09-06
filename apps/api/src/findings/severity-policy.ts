export type FindingSeverity = 'critical' | 'high' | 'medium' | 'low' | 'info';
export interface SeverityDecision { severity: FindingSeverity; severitySource: string }

const FLOORS: Readonly<Record<string, FindingSeverity>> = {
  'kase.idor.missing-ownership-predicate': 'high',
};

export function assignSeverity(ruleId: string, _advisory?: string): SeverityDecision {
  const severity = FLOORS[ruleId] ?? 'medium';
  return { severity, severitySource: JSON.stringify({ authority: 'kase-policy', policyVersion: 1,
    ruleId, rationale: FLOORS[ruleId] ? 'rule severity floor' : 'default tool finding severity' }) };
}
