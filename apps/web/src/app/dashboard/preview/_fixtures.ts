import { notFound } from 'next/navigation';
import type { AuditRow, FindingRow, GateEvaluationRow } from '@/lib/workspace-types';

/**
 * SAMPLE DATA for the dev-only dashboard preview. None of this is real: the
 * ids, findings and gate result exist so the screens can be designed and
 * checked without a signed-in session or a running API. Preview pages show a
 * "Sample data" badge and are unavailable in production.
 */

export const PREVIEW_BASE = '/dashboard/preview';
export const PREVIEW_EMAIL = 'preview@localhost';

/** Preview routes answer 404 in production, so they are never a way around sign-in. */
export function devOnly(): void {
  if (process.env.NODE_ENV === 'production') notFound();
}

const EVALUATED = 'aud_01SAMPLE0000000000EVALUATED';
const RUNNING = 'aud_01SAMPLE00000000000000RUNNING';

export const SAMPLE_AUDITS: AuditRow[] = [
  {
    id: RUNNING, projectId: 'prj_01SAMPLE', mode: 'security', status: 'running', degraded: false,
    requestedCommitSha: '9f2c1ab7d3e04c55a1b2c3d4e5f60718293a4b5c', executedCategories: ['sast'],
    startedAt: '2026-10-11T09:12:00.000Z', completedAt: null,
  },
  {
    id: EVALUATED, projectId: 'prj_01SAMPLE', mode: 'full', status: 'partial', degraded: true,
    requestedCommitSha: '4be81d09c7a2f3e6b5d4c3b2a1908f7e6d5c4b3a', executedCategories: ['sast', 'http', 'whitebox'],
    startedAt: '2026-10-09T14:02:00.000Z', completedAt: '2026-10-09T14:31:00.000Z',
  },
];

/** The sample audit that has findings and a gate result. */
export const SAMPLE_DEFAULT_AUDIT_ID = EVALUATED;

const loc = (file: string, enclosingSymbol: string, line: number, verified: boolean) => [{ file, enclosingSymbol, line, verified }];

const SAMPLE_FINDINGS: Record<string, FindingRow[]> = {
  [RUNNING]: [],
  [EVALUATED]: [
    { id: 'fnd_01SAMPLEA', title: 'Invoice can be read by any signed-in user', severity: 'critical', category: 'http', origin: 'correlated', confidenceBand: 'high', aiGenerated: false, gateEligible: true, sourceLocations: loc('src/invoices/invoices.controller.ts', 'InvoicesController.findOne', 48, true), findingEvidence: [1, 2] },
    { id: 'fnd_01SAMPLEB', title: 'SQL built by string concatenation in report export', severity: 'high', category: 'sast', origin: 'tool', confidenceBand: 'high', aiGenerated: false, gateEligible: true, sourceLocations: loc('src/reports/export.service.ts', 'ExportService.buildQuery', 112, true), findingEvidence: [1] },
    { id: 'fnd_01SAMPLEC', title: 'Password reset token is not invalidated after use', severity: 'high', category: 'whitebox', origin: 'whitebox', confidenceBand: 'medium', aiGenerated: true, gateEligible: false, sourceLocations: loc('src/auth/reset.service.ts', 'ResetService.consume', 67, false), findingEvidence: [1] },
    { id: 'fnd_01SAMPLED', title: 'Verbose stack trace returned on malformed JSON', severity: 'medium', category: 'http', origin: 'blackbox', confidenceBand: 'high', aiGenerated: false, gateEligible: true, sourceLocations: [], findingEvidence: [1] },
    { id: 'fnd_01SAMPLEE', title: 'Session cookie set without SameSite attribute', severity: 'medium', category: 'http', origin: 'blackbox', confidenceBand: 'high', aiGenerated: false, gateEligible: false, sourceLocations: loc('src/main.ts', 'bootstrap', 22, true), findingEvidence: [1] },
    { id: 'fnd_01SAMPLEF', title: 'Unused dependency with a known advisory', severity: 'low', category: 'sast', origin: 'tool', confidenceBand: 'low', aiGenerated: false, gateEligible: false, sourceLocations: loc('package.json', 'dependencies', 31, true), findingEvidence: [] },
  ],
};

const SAMPLE_GATES: Record<string, GateEvaluationRow | null> = {
  [RUNNING]: null,
  [EVALUATED]: {
    id: 'gate_01SAMPLE', auditId: EVALUATED, gatePolicyVersion: 3, outcome: 'fail',
    blockingFindingIds: ['fnd_01SAMPLEA', 'fnd_01SAMPLEB'], waivedFindingIds: ['fnd_01SAMPLED'],
    notExecutedCategories: ['blackbox'], commitSha: '4be81d09c7a2f3e6b5d4c3b2a1908f7e6d5c4b3a',
    evaluatedAt: '2026-10-09T14:33:00.000Z',
  },
};

export function sampleAudit(auditId: string) {
  const audit = SAMPLE_AUDITS.find((a) => a.id === auditId);
  if (!audit) notFound();
  return { audit, findings: SAMPLE_FINDINGS[auditId] ?? [], gate: SAMPLE_GATES[auditId] ?? null };
}
