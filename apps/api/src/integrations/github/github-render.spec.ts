import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GateDecision } from '../../assurance/gate/gate-engine';
import {
  COMMENT_MARKER, MAX_COMMENT, annotationsFor, conclusionFor, fit, renderCheckOutput, renderPrComment, type PrFinding, type PrPublishInput,
} from './github-render';

const START = new Date('2026-11-27T10:00:00Z');

function decision(over: Partial<GateDecision> = {}): GateDecision {
  return {
    outcome: 'fail', mode: 'full', degraded: false, notExecutedCategories: [],
    blocking: [
      { findingId: 'fnd_1', fingerprint: 'fp1', severity: 'critical', category: 'authz', rule: 'block_on[0] source=deterministic severity=critical',
        evidence: [{ id: 'ev_1', class: 'http_replay', replayResult: 'reproduced' }], sourceLocation: { file: 'src/invoices/invoice.service.ts', enclosingSymbol: 'InvoiceService.find', verified: true } },
      { findingId: 'fnd_2', fingerprint: 'fp2', severity: 'high', category: 'secrets', rule: 'block_on[1] severity=high',
        evidence: [{ id: 'ev_2', class: 'scanner' }], sourceLocation: { file: 'src/config/stripe.ts', enclosingSymbol: 'stripeConfig', verified: false } },
    ],
    warnings: [
      { findingId: 'fnd_3', fingerprint: 'fp3', reason: 'correlation is ai_inference; not gate-eligible' },
      { findingId: 'fnd_4', fingerprint: 'fp4', reason: 'correlation is ai_inference; not gate-eligible' },
      { reason: 'high severity without replayable evidence' },
    ],
    waived: [{ fingerprint: 'fp9', expiresAt: new Date('2026-12-06T00:00:00Z'), approvedBy: 'alex@example.com', daysRemaining: 9, findingIds: ['fnd_9'] }],
    ...over,
  };
}

function findings(): Map<string, PrFinding> {
  return new Map<string, PrFinding>([
    ['fnd_1', { id: 'fnd_1', title: 'IDOR allows invoice access across users', severity: 'critical', location: { file: 'src/invoices/invoice.service.ts', line: 42, endLine: 44, symbol: 'InvoiceService.find' } }],
    ['fnd_2', { id: 'fnd_2', title: 'Hardcoded API key in source', severity: 'high', location: null }],
    ['fnd_3', { id: 'fnd_3', title: 'Possible mass assignment', severity: 'medium', location: { file: 'src/users/users.controller.ts', line: 10, endLine: null, symbol: 'UsersController.update' } }],
    ['fnd_4', { id: 'fnd_4', title: 'Unverified', severity: 'medium', location: null }],
  ]);
}

function input(over: Partial<PrPublishInput> = {}): PrPublishInput {
  return {
    decision: decision(), policyVersion: 3,
    report: { summary: { counts: { critical: 1, high: 1, medium: 2, low: 0, info: 0 }, gate: { outcome: 'fail', policyVersion: 3 },
      mustFix: [{ rank: 1, severity: 'critical', title: 'IDOR allows invoice access across users', location: 'src/invoices/invoice.service.ts:42', effort: 'S', ref: '02-authn-authz.md §AUTHZ-01', blocking: true, waived: false }],
      expiringWaivers: [{ fingerprint: 'fp9abcdef0123456789', daysRemaining: 9, approvedBy: 'alex@example.com' }] } },
    audit: { id: 'aud_1', mode: 'full', status: 'completed', commitSha: 'a3f9c1e0b2d4f6a8c0e2a4b6d8f0a2c4e6a8b0c2', startedAt: START,
      completedAt: new Date(START.getTime() + 24 * 60_000), requestedCategories: 12, executedCategories: 12 },
    findings: findings(), partialIsFailure: false, reportUrl: 'https://kase.example.com/dashboard/audits/aud_1',
    ...over,
  };
}

const GOLDEN = join(__dirname, '__golden__', 'pr-comment.md');

describe('GitHub renderer', () => {
  it('maps gate outcomes to check conclusions, and PARTIAL is never success', () => {
    expect(conclusionFor('pass', false)).toBe('success');
    expect(conclusionFor('fail', false)).toBe('failure');
    expect(conclusionFor('partial', false)).toBe('neutral');
    expect(conclusionFor('partial', true)).toBe('failure');
    for (const strict of [true, false]) expect(conclusionFor('partial', strict)).not.toBe('success');
    expect(renderCheckOutput(input({ decision: decision({ outcome: 'partial', blocking: [], degraded: true }) })).conclusion).toBe('neutral');
  });

  it('matches the golden PR comment', () => {
    const comment = renderPrComment(input());
    // Regenerate deliberately with UPDATE_GOLDEN=1 and review the diff; a missing golden fails.
    if (process.env.UPDATE_GOLDEN === '1') {
      mkdirSync(join(__dirname, '__golden__'), { recursive: true });
      writeFileSync(GOLDEN, comment);
    }
    expect(existsSync(GOLDEN)).toBe(true);
    expect(comment).toBe(readFileSync(GOLDEN, 'utf8').replace(/\r\n/gu, '\n'));
  });

  it('cites rule, evidence and source location for every blocking finding', () => {
    const comment = renderPrComment(input());
    expect(comment.startsWith(COMMENT_MARKER)).toBe(true);
    expect(comment).toContain('## Kase audit — FAIL — 2 blocking findings');
    expect(comment).toContain('| Critical | IDOR allows invoice access across users | `src/invoices/invoice.service.ts:42` · `InvoiceService.find` | `block_on[0] source=deterministic severity=critical` | `ev_1` http\\_replay (reproduced) |');
    // An unverified location is not shown as a source.
    expect(comment).toContain('| High | Hardcoded API key in source | — | `block_on[1] severity=high` | `ev_2` scanner |');
    expect(comment).toContain('### Warnings (3)');
    expect(comment).toContain('2 × correlation is ai\\_inference; not gate-eligible · 1 × high severity without replayable evidence');
    expect(comment).toContain('⚠ Waiver `fp9abcdef012` expires in 9 days (approved by alex@example.com)');
    expect(comment).toContain('**Duration** 24m');
  });

  it('annotates only verified locations: blocking as failure, named warnings as warning', () => {
    const annotations = annotationsFor(input());
    expect(annotations).toEqual([
      { path: 'src/invoices/invoice.service.ts', start_line: 42, end_line: 44, annotation_level: 'failure',
        title: 'Critical: IDOR allows invoice access across users',
        message: 'Blocks the release under block_on[0] source=deterministic severity=critical. Evidence: ev_1 (http_replay).' },
      { path: 'src/users/users.controller.ts', start_line: 10, end_line: 10, annotation_level: 'warning',
        title: 'Medium: Possible mass assignment', message: 'correlation is ai_inference; not gate-eligible' },
    ]);
  });

  it('says plainly that a PARTIAL result is not a pass', () => {
    const partial = input({ decision: decision({ outcome: 'partial', blocking: [], warnings: [], waived: [], degraded: true }), audit: { ...input().audit, status: 'partial' } });
    const comment = renderPrComment(partial);
    expect(comment).toContain('## Kase audit — PARTIAL — audit partial, degraded');
    expect(comment).toContain('cannot pass');
    expect(comment).toContain('**Degraded**');
  });

  it('a FAIL with no blocking findings explains itself', () => {
    const comment = renderPrComment(input({ decision: decision({ blocking: [], warnings: [], waived: [], notExecutedCategories: ['dependencies'] }) }));
    expect(comment).toContain('FAIL — required categories not executed');
    expect(comment).toContain('not executed: dependencies');
  });

  it('escapes untrusted finding titles so they cannot break the table or inject HTML', () => {
    const hostile = new Map(findings());
    hostile.set('fnd_1', { ...hostile.get('fnd_1')!, title: 'x | y <img src=x onerror=alert(1)>\n## fake heading' });
    const comment = renderPrComment(input({ findings: hostile }));
    expect(comment).not.toMatch(/(?<!\\)<img/u); // `\<` renders as a literal character, never as HTML
    expect(comment).toContain('\\<img');
    expect(comment).not.toMatch(/^## fake heading/mu);
    const row = comment.split('\n').find(l => l.startsWith('| Critical'))!;
    expect(row.split(/(?<!\\)\|/u)).toHaveLength(7);
  });

  it('keeps the comment and check text within GitHub limits', () => {
    const many = Array.from({ length: 3000 }, (_, i) => ({ ...decision().blocking[0], findingId: `fnd_x${i}`, rule: `block_on[0] ${'r'.repeat(40)}` }));
    const comment = renderPrComment(input({ decision: decision({ blocking: many }) }));
    expect(comment.length).toBeLessThanOrEqual(MAX_COMMENT);
    expect(comment).toContain('truncated');
    expect(fit('short', 100)).toBe('short');
    const out = renderCheckOutput(input({ decision: decision({ blocking: many }) }));
    expect(out.summary.length).toBeLessThanOrEqual(65_535);
    expect(out.title.length).toBeLessThanOrEqual(255);
  });

  it('builds the check title and must-fix text from the report', () => {
    const out = renderCheckOutput(input());
    expect(out.title).toBe('Kase gate: FAIL — 2 blocking findings');
    expect(out.text).toContain('| 1 | Critical ⛔ | IDOR allows invoice access across users | `src/invoices/invoice.service.ts:42` | S |');
    expect(renderCheckOutput(input({ decision: decision({ outcome: 'pass', blocking: [], warnings: [], waived: [] }) })).title).toBe('Kase gate: PASS');
  });
});
