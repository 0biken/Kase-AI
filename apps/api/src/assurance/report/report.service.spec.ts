import { ReportService } from './report.service';
import { ReportController } from './report.controller';
import { parsePolicy } from '../policy/policy-schema';
import { newId } from '../../common/ids';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const inDays = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function policy(warn: number) {
  return parsePolicy({
    version: 2, name: 'default', mode: 'full', block_on: [{ severity: ['critical'] }],
    waivers: { max_duration_days: 30, require_separate_approver: true, warn_before_expiry_days: warn },
  });
}

function findingRow(id: string, fingerprint: string, over: Record<string, unknown> = {}) {
  return {
    id, auditId: 'aud_1', origin: 'tool', category: 'static_security', cwe: 'CWE-89', title: `Finding ${id}`, severity: 'critical',
    affectedTarget: null, description: 'd', reproduction: { step: 1 }, impact: 'i', rootCause: null, fix: 'Parameterise. Effort: S',
    fixPatch: null, confidenceBand: 'high', aiGenerated: false,
    identity: { fingerprint, status: 'open' },
    sourceLocations: [{ file: 'src/a.ts', enclosingSymbol: 'A.run', line: 9, verified: true }],
    findingEvidence: [{ evidence: { id: `ev_${id}`, type: 'sast_result', replayable: false, sha256: 'c'.repeat(64) } }],
    ...over,
  };
}

function harness(opts: { audit?: unknown; findings?: unknown[]; waivers?: unknown[]; suppressions?: unknown[]; gate?: unknown; active?: jest.Mock } = {}) {
  const audit = opts.audit === undefined ? {
    id: 'aud_1', projectId: 'prj_1', mode: 'whitebox', status: 'completed', degraded: false, degradationReasons: [],
    requestedCategories: ['static_security'], executedCategories: ['static_security'],
    notExecutedCategories: [{ category: 'dependencies', reason: 'failed' }, 'secrets', 42],
    requestedCommitSha: 'deadbeef', startedAt: NOW, completedAt: NOW,
    project: { name: 'Acme', slug: 'acme' }, target: null, repository: { url: 'https://github.com/acme/app' }, buildProvenance: { verified: true },
  } : opts.audit;
  const prisma = {
    audit: { findUnique: jest.fn(async () => audit) },
    finding: { findMany: jest.fn(async () => opts.findings ?? []) },
    correlation: { findMany: jest.fn(async () => [{ blackboxFindingId: 'fnd_x', whiteboxFindingId: 'fnd_1', method: 'static_parse', verified: false }]) },
    passingCheck: { findMany: jest.fn(async () => [{ category: 'static_security', checkId: 'sast.no-eval', target: null }]) },
    waiver: { findMany: jest.fn(async () => opts.waivers ?? []) },
    suppression: { findMany: jest.fn(async () => opts.suppressions ?? []) },
    gateEvaluation: { findFirst: jest.fn(async () => opts.gate ?? null) },
  };
  const policies = { getActiveParsed: opts.active ?? jest.fn(async () => ({ id: 'gpol_1', version: 2, policy: policy(10) })) };
  return { service: new ReportService(prisma as never, policies as never), prisma, policies };
}

describe('ReportService', () => {
  it('maps audit state into the report and reads warn_before_expiry_days from the active policy', async () => {
    const h = harness({
      findings: [findingRow('fnd_1', 'fp1'), findingRow('fnd_2', 'fp2', { severity: 'low' })],
      waivers: [
        { fingerprint: 'fp1', reason: 'r', requestedBy: 'usr_a', approvedBy: 'usr_b', expiresAt: inDays(9) },
        { fingerprint: 'fp-other-audit', reason: 'r', requestedBy: 'usr_a', approvedBy: 'usr_b', expiresAt: inDays(1) },
      ],
      suppressions: [{ fingerprint: 'fp2' }],
      gate: { outcome: 'fail', gatePolicyVersion: 2, blockingFindingIds: ['fnd_1'], waivedFindingIds: [], evaluatedAt: NOW },
    });
    const report = await h.service.build('aud_1', NOW);
    expect(report.schema).toBe('kase.report/v1');
    // 9 days left is inside the policy's 10-day window; a waiver for another audit's finding is not this report's.
    expect(report.summary.expiringWaivers).toEqual([{ fingerprint: 'fp1', daysRemaining: 9, approvedBy: 'usr_b' }]);
    expect(report.summary.counts).toMatchObject({ critical: 1, low: 0 }); // the suppressed low finding is not counted
    expect(report.summary.gate).toEqual({ outcome: 'fail', policyVersion: 2 });
    const summary = report.files[0].markdown;
    expect(summary).toContain('**Repo/commit reviewed:** `deadbeef`');
    expect(summary).toContain('- Not executed: dependencies (failed).');
    expect(summary).toContain('- Not executed: secrets (not executed).');
    expect(summary).toContain('## Severity model used');
    const category = report.files.find(f => f.path === '02-security-static-analysis.md')!.markdown;
    expect(category).toContain('**Correlation:** static\\_parse, unverified (advisory only)');
    expect(category).toContain('- **PASS** ✅ `sast.no-eval`');
  });

  it('falls back to a 7-day warning window when no policy can be loaded', async () => {
    const h = harness({
      findings: [findingRow('fnd_1', 'fp1')],
      waivers: [{ fingerprint: 'fp1', reason: 'r', requestedBy: 'usr_a', approvedBy: 'usr_b', expiresAt: inDays(9) }],
      active: jest.fn(async () => { throw new Error('no policy'); }),
    });
    const report = await h.service.build('aud_1', NOW);
    expect(report.summary.expiringWaivers).toEqual([]);
    expect(report.files[0].markdown).toContain('| `fp1` | 9d |');
  });

  it('404s an unknown audit', async () => {
    await expect(harness({ audit: null }).service.build('aud_missing', NOW)).rejects.toMatchObject({ status: 404 });
  });
});

describe('ReportController', () => {
  const report = { schema: 'kase.report/v1', auditId: 'aud_1', generatedAt: NOW.toISOString(), files: [
    { path: '00-executive-summary.md', title: 'Executive Summary', markdown: '# Summary\n' },
    { path: 'evidence-index.md', title: 'Evidence Index', markdown: '# Evidence\n' },
  ], summary: {} };
  const service = { build: jest.fn(async () => report) };
  const controller = new ReportController(service as never);
  const AUDIT = newId('audit');

  it('returns json by default and markdown on request', async () => {
    const res = { type: jest.fn() };
    await expect(controller.get(AUDIT, res as never)).resolves.toBe(report);
    const md = await controller.get(AUDIT, res as never, 'markdown');
    expect(res.type).toHaveBeenCalledWith('text/markdown; charset=utf-8');
    expect(md).toContain('<!-- 00-executive-summary.md -->\n# Summary');
    expect(md).toContain('<!-- evidence-index.md -->\n# Evidence');
  });

  it('rejects html (not built yet) and an invalid audit id', async () => {
    await expect(controller.get(AUDIT, {} as never, 'html')).rejects.toMatchObject({ status: 422 });
    await expect(controller.get('not-an-id', {} as never)).rejects.toMatchObject({ status: 404 });
  });
});
