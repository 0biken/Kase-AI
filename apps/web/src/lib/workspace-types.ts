/**
 * Shapes the workspace screens read from apps/api. They mirror the Prisma
 * models (packages/db/schema.prisma) as the API serialises them: only the
 * fields the screens use are listed, and dates arrive as ISO strings.
 */

export type AuditStatus = 'queued' | 'running' | 'completed' | 'partial' | 'failed' | 'cancelled';

export interface ProjectRow {
  id: string;
  name?: string;
}

export interface AuditRow {
  id: string;
  projectId: string;
  mode: string;
  status: AuditStatus;
  degraded: boolean;
  requestedCommitSha: string | null;
  executedCategories: string[];
  startedAt: string;
  completedAt: string | null;
}

export interface SourceLocationRow {
  file: string;
  enclosingSymbol: string;
  line: number;
  verified: boolean;
}

export interface FindingRow {
  id: string;
  title: string;
  severity: string;
  category: string;
  origin: string;
  confidenceBand: string;
  aiGenerated: boolean;
  gateEligible: boolean;
  sourceLocations: SourceLocationRow[];
  findingEvidence: unknown[];
}

export type GateOutcome = 'pass' | 'fail' | 'partial';

export interface GateEvaluationRow {
  id: string;
  auditId: string;
  gatePolicyVersion: number;
  outcome: GateOutcome;
  blockingFindingIds: string[];
  waivedFindingIds: string[];
  notExecutedCategories: string[];
  commitSha: string | null;
  evaluatedAt: string;
}

export interface FindingFilters {
  severity?: string;
  category?: string;
  gateEligible?: string;
}

/** Most severe first. Unknown severities sort last rather than vanish. */
export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'] as const;

export function bySeverity(a: FindingRow, b: FindingRow): number {
  const rank = (s: string) => {
    const i = SEVERITY_ORDER.indexOf(s as (typeof SEVERITY_ORDER)[number]);
    return i === -1 ? SEVERITY_ORDER.length : i;
  };
  return rank(a.severity) - rank(b.severity) || a.id.localeCompare(b.id);
}

/** The same three filters the API applies, for data already in hand. */
export function applyFindingFilters(findings: FindingRow[], filters: FindingFilters): FindingRow[] {
  return findings.filter(
    (f) =>
      (!filters.severity || f.severity === filters.severity) &&
      (!filters.category || f.category === filters.category) &&
      (filters.gateEligible === undefined || filters.gateEligible === '' || f.gateEligible === (filters.gateEligible === 'true')),
  );
}
