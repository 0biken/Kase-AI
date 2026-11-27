import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { block, buildReport, effortOf, fenced, inline, reportToMarkdown, sectionFor, type ReportFinding, type ReportInput } from './report-builder';
import { extractSeverityRubric } from './report.service';

const NOW = new Date('2026-11-26T12:00:00.000Z');
const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000);

function finding(over: Partial<ReportFinding> & Pick<ReportFinding, 'id' | 'fingerprint'>): ReportFinding {
  return {
    status: 'new', origin: 'blackbox', category: 'authz', cwe: 'CWE-639', title: 'IDOR on invoices', severity: 'high',
    affectedTarget: 'GET https://staging.example.com/api/invoices/42', description: 'Another tenant can read invoice 42.',
    reproduction: { request: 'GET /api/invoices/42', as: 'tenant-b' }, impact: 'Cross-tenant data exposure.', rootCause: null,
    fix: 'Scope the query by tenantId. Effort: S', fixPatch: null, confidenceBand: 'high', aiGenerated: true,
    sourceLocations: [{ file: 'src/invoices/invoices.service.ts', enclosingSymbol: 'InvoicesService.find', line: 42, verified: true }],
    evidence: [{ id: 'ev_1', type: 'http_exchange', replayable: true, sha256: 'a'.repeat(64) }],
    correlation: { method: 'runtime_dump', verified: true }, suppressed: false, ...over,
  };
}

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    project: { name: 'Acme Billing', slug: 'acme-billing' },
    audit: {
      id: 'aud_report1', mode: 'full', status: 'completed', degraded: false, degradationReasons: [],
      target: 'https://staging.example.com', repository: 'https://github.com/acme/billing', commitSha: 'abc1234', provenanceVerified: true,
      startedAt: new Date('2026-11-26T10:00:00Z'), completedAt: new Date('2026-11-26T11:00:00Z'),
      requestedCategories: ['authz', 'static_security', 'dependencies'], executedCategories: ['authz', 'static_security'],
      notExecutedCategories: [{ category: 'dependencies', reason: 'timed_out' }],
    },
    findings: [
      finding({ id: 'fnd_a', fingerprint: 'fp-a' }),
      finding({ id: 'fnd_b', fingerprint: 'fp-b', title: 'Admin route lacks role check', severity: 'critical', fix: 'Add @Roles(admin). Effort: M' }),
      finding({ id: 'fnd_c', fingerprint: 'fp-c', origin: 'tool', category: 'static_security', cwe: 'CWE-89', title: 'SQL built from input',
        severity: 'critical', fix: 'Use a parameterised query. Effort: S', aiGenerated: false, correlation: null,
        sourceLocations: [{ file: 'src/reports/report.repo.ts', enclosingSymbol: 'ReportRepo.search', line: 17, verified: true }],
        evidence: [{ id: 'ev_2', type: 'sast_result', replayable: false, sha256: 'b'.repeat(64) }] }),
      finding({ id: 'fnd_d', fingerprint: 'fp-d', title: 'Verbose error page', severity: 'low', fix: 'Turn off stack traces.' }),
      finding({ id: 'fnd_e', fingerprint: 'fp-e', title: 'Rate limit missing', severity: 'medium', status: 'accepted_risk', fix: 'Add a limiter.' }),
      finding({ id: 'fnd_f', fingerprint: 'fp-f', title: 'Known noisy rule', severity: 'high', status: 'false_positive' }),
    ],
    passingChecks: [
      { category: 'authz', checkId: 'authz.unauthenticated-admin', target: 'GET /admin' },
      { category: 'static_security', checkId: 'sast.no-eval', target: null },
    ],
    waivers: [
      { fingerprint: 'fp-a', reason: 'Fix ships in 1.4', requestedBy: 'usr_dev', approvedBy: 'usr_lead', expiresAt: days(3) },
      { fingerprint: 'fp-d', reason: 'Cosmetic', requestedBy: 'usr_dev', approvedBy: 'usr_lead', expiresAt: days(20) },
      { fingerprint: 'fp-x', reason: 'Expired', requestedBy: 'usr_dev', approvedBy: 'usr_lead', expiresAt: days(-1) },
    ],
    gate: { outcome: 'fail', policyVersion: 3, blockingFindingIds: ['fnd_b', 'fnd_c'], waivedFindingIds: ['fnd_a'], evaluatedAt: NOW },
    warnBeforeExpiryDays: 7,
    severityRubric: '| Severity | Meaning |\n|---|---|\n| Critical | Exploitable now |',
    generatedAt: NOW,
    ...over,
  };
}

const GOLDEN = join(__dirname, '__golden__', 'executive-summary.md');

describe('report builder', () => {
  it('matches the golden executive summary', () => {
    const summary = buildReport(input()).files[0];
    expect(summary.path).toBe('00-executive-summary.md');
    // Regenerate deliberately with UPDATE_GOLDEN=1 and review the diff; a missing golden fails.
    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(join(__dirname, '__golden__'), { recursive: true });
      writeFileSync(GOLDEN, summary.markdown);
    }
    expect(existsSync(GOLDEN)).toBe(true);
    expect(summary.markdown).toBe(readFileSync(GOLDEN, 'utf8').replace(/\r\n/gu, '\n'));
  });

  it('is deterministic for the same input', () => {
    expect(JSON.stringify(buildReport(input()))).toBe(JSON.stringify(buildReport(input())));
  });

  it('builds the executive summary last, from the files already assembled, and indexes every file', () => {
    const report = buildReport(input());
    const paths = report.files.map(f => f.path);
    expect(paths).toEqual(['00-executive-summary.md', '01-scope-and-coverage.md', '02-authn-authz.md', '03-security-static-analysis.md', 'evidence-index.md']);
    const summary = report.files[0].markdown;
    for (const path of paths.slice(1)) expect(summary).toContain(`[\`${path}\`](${path})`);
    // Every must-fix reference points at an anchor that exists in its category file.
    for (const row of report.summary.mustFix) {
      const [file, anchor] = row.ref.split(' §');
      expect(report.files.find(f => f.path === file)?.markdown).toContain(`## ${anchor} · `);
    }
  });

  it('ranks must-fix by severity, then effort, then gate-blocking, and leaves out non-actionable findings', () => {
    const { mustFix } = buildReport(input()).summary;
    expect(mustFix.map(r => [r.severity, r.effort, r.title])).toEqual([
      ['critical', 'S', 'SQL built from input'],
      ['critical', 'M', 'Admin route lacks role check'],
      ['high', 'S', 'IDOR on invoices'],
    ]);
    expect(mustFix[0]).toMatchObject({ blocking: true, location: 'src/reports/report.repo.ts:17', ref: '03-security-static-analysis.md §SEC-01' });
    expect(mustFix.some(r => /Rate limit|noisy/u.test(r.title))).toBe(false);
  });

  it('counts only actionable findings by severity', () => {
    expect(buildReport(input()).summary.counts).toEqual({ critical: 2, high: 1, medium: 0, low: 1, info: 0 });
  });

  it('warns about waivers expiring within warn_before_expiry_days and omits expired ones', () => {
    const report = buildReport(input());
    expect(report.summary.expiringWaivers).toEqual([{ fingerprint: 'fp-a', daysRemaining: 3, approvedBy: 'usr_lead' }]);
    const summary = report.files[0].markdown;
    expect(summary).toContain('| `fp-a` | 3d ⚠ | usr\\_lead | Fix ships in 1.4 |');
    expect(summary).toContain('| `fp-d` | 20d | usr\\_lead | Cosmetic |');
    expect(summary).toContain('⚠ 1 waiver expires within 7 days');
    expect(summary).not.toContain('fp-x');
    const wider = buildReport(input({ warnBeforeExpiryDays: 30 }));
    expect(wider.summary.expiringWaivers.map(w => w.fingerprint)).toEqual(['fp-a', 'fp-d']);
  });

  it('records scope notes for not-executed categories, accepted risks and unverified provenance', () => {
    const report = buildReport(input({ audit: { ...input().audit, provenanceVerified: false } }));
    const summary = report.files[0].markdown;
    expect(summary).toContain('- Not executed: dependencies (timed\\_out).');
    expect(summary).toContain('- Accepted risk: Rate limit missing (02-authn-authz.md §AUTHZ-');
    expect(summary).toContain('Build provenance is unverified');
    expect(report.files[1].markdown).toContain('## Not executed');
  });

  it('logs passing checks as PASS in their category and never ships an empty category', () => {
    const report = buildReport(input());
    expect(report.files.find(f => f.path === '02-authn-authz.md')?.markdown).toContain('- **PASS** ✅ `authz.unauthenticated-admin` — GET /admin');
    const clean = buildReport(input({ findings: [], passingChecks: [], waivers: [], gate: null }));
    expect(clean.files.map(f => f.path)).toEqual(['00-executive-summary.md', '01-scope-and-coverage.md', 'evidence-index.md']);
    expect(clean.files[0].markdown).toContain('No open findings in the executed categories.');
    expect(clean.files[0].markdown).toContain('The release gate has not been evaluated');
    expect(clean.files[1].markdown).toContain('Untested is not the same as clean.');
  });

  it('flags a partial or degraded audit so a short list is not read as clean', () => {
    const summary = buildReport(input({ audit: { ...input().audit, status: 'partial', degraded: true, degradationReasons: ['agent budget exhausted'] } })).files[0].markdown;
    expect(summary).toContain('This audit is **partial, degraded**');
    expect(summary).toContain('- Degraded: agent budget exhausted.');
  });

  it('indexes evidence back to the findings that cite it', () => {
    const index = buildReport(input()).files.find(f => f.path === 'evidence-index.md')!.markdown;
    expect(index).toMatch(/\| `ev_1` \| http\\_exchange \| yes \| `a{64}` \| AUTHZ-01, AUTHZ-02/u);
    expect(index).toContain('| `ev_2` | sast\\_result | no |');
  });

  it('escapes untrusted finding text in every context', () => {
    const hostile = finding({ id: 'fnd_h', fingerprint: 'fp-h', severity: 'critical', title: 'x | y <script>alert(1)</script>\n# injected',
      description: '# Fake heading\n<img src=x onerror=alert(1)>\n```\nbreak out', impact: '> quoted', fix: 'Do it. Effort: S',
      reproduction: { payload: '````' } });
    const report = buildReport(input({ findings: [hostile] }));
    const md = reportToMarkdown(report);
    expect(md).not.toContain('<script>');
    expect(md).not.toContain('<img');
    expect(md).not.toMatch(/^# Fake heading/mu);
    expect(md).not.toMatch(/^# injected/mu);
    const row = report.files[0].markdown.split('\n').find(l => l.startsWith('| 1 |'))!;
    expect(row.split(/(?<!\\)\|/u)).toHaveLength(8); // 6 columns, no injected cell
    const category = report.files.find(f => f.path === '02-authn-authz.md')!.markdown;
    expect(category).toContain('`````json'); // fence longer than the 4-backtick run inside
  });

  it('helpers', () => {
    expect(inline('a|b\nc')).toBe('a\\|b c');
    expect(block('# h\n<b>')).toBe('\\# h\n&lt;b&gt;');
    expect(fenced('x ``` y')).toBe('````\nx ``` y\n````');
    expect(effortOf('Fix it. Effort: L')).toBe('L');
    expect(effortOf('Fix it (M)')).toBe('M');
    expect(effortOf('Fix it soon')).toBe('—');
    expect(sectionFor('authz').slug).toBe('authn-authz');
    expect(sectionFor('dependencies').prefix).toBe('DEP');
    expect(sectionFor('Weird Category!')).toEqual({ slug: 'weird-category', title: 'Weird Category', prefix: 'WEIRDC' });
  });

  it('copies the severity rubric section from the methodology finding format', () => {
    const real = readFileSync(join(__dirname, '../../../../../methodology/v1/blackbox/finding-format.md'), 'utf8');
    const rubric = extractSeverityRubric(real);
    expect(rubric.length).toBeGreaterThan(50);
    expect(rubric).not.toMatch(/^## /mu);
    expect(extractSeverityRubric('# x\n## Severity rubric\nA\nB\n## Next\nC')).toBe('A\nB');
    expect(extractSeverityRubric('no rubric')).toBe('');
  });
});
