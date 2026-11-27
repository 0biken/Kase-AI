/**
 * What Kase publishes on a pull request (13-integrations §1, GATES-M6 G7): a
 * check run that branch protection can require, and exactly one PR comment
 * that is updated in place. Pure and deterministic, so it is golden-testable
 * without GitHub.
 *
 * Two rules matter more than the rest:
 * - PARTIAL is never `success`. It is `neutral`, or `failure` when the project
 *   treats partial as blocking. An incomplete audit must not turn a PR green.
 * - Only verified source locations are annotated. A wrong inline annotation
 *   on a PR is worse than none.
 */
import type { GateDecision, GateOutcome } from '../../assurance/gate/gate-engine';
import type { ReportDocument } from '../../assurance/report/report-builder';
import { inline } from '../../assurance/report/report-builder';

export type CheckConclusion = 'success' | 'failure' | 'neutral';

/** Hidden marker that identifies Kase's own comment on a PR. */
export const COMMENT_MARKER = '<!-- kase:pr-audit -->';
export const CHECK_NAME = 'Kase gate';

// GitHub's documented limits: 65535 characters for check-run summary/text,
// 65536 for an issue comment body, 50 annotations per request.
export const MAX_CHECK_TEXT = 65_535;
export const MAX_COMMENT = 65_536;
export const ANNOTATIONS_PER_REQUEST = 50;

export function conclusionFor(outcome: GateOutcome, partialIsFailure: boolean): CheckConclusion {
  if (outcome === 'pass') return 'success';
  if (outcome === 'fail') return 'failure';
  return partialIsFailure ? 'failure' : 'neutral';
}

/** One finding the gate refers to, with the fields the PR surfaces show. */
export interface PrFinding {
  id: string;
  title: string;
  severity: string;
  /** Only a verified location (and, for a correlated finding, a verified correlation) is passed here. */
  location: { file: string; line: number; endLine: number | null; symbol: string } | null;
}

export interface PrPublishInput {
  decision: GateDecision;
  policyVersion: number;
  report: Pick<ReportDocument, 'summary'>;
  audit: { id: string; mode: string; status: string; commitSha: string | null; startedAt: Date; completedAt: Date | null;
    requestedCategories: number; executedCategories: number };
  findings: Map<string, PrFinding>;
  partialIsFailure: boolean;
  reportUrl: string | null;
}

export interface CheckAnnotation {
  path: string; start_line: number; end_line: number;
  annotation_level: 'failure' | 'warning' | 'notice';
  title: string; message: string;
}

export interface CheckOutput {
  conclusion: CheckConclusion;
  title: string;
  summary: string;
  text: string;
  annotations: CheckAnnotation[];
}

const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low', info: 'Info' };
const label = (severity: string) => SEVERITY_LABEL[severity] ?? inline(severity);
const code = (value: string) => `\`${value.replace(/[`\r\n]/gu, '')}\``;

/** Truncate at a line boundary, saying so, so a huge audit never fails to publish. */
export function fit(markdown: string, max: number): string {
  if (markdown.length <= max) return markdown;
  const notice = '\n\n_…truncated; the full report has every finding._\n';
  const cut = markdown.lastIndexOf('\n', max - notice.length);
  return markdown.slice(0, cut > 0 ? cut : max - notice.length) + notice;
}

function duration(start: Date, end: Date | null): string | null {
  if (!end) return null;
  const minutes = Math.max(0, Math.round((end.getTime() - start.getTime()) / 60_000));
  return minutes < 60 ? `${minutes}m` : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function headline(input: PrPublishInput): string {
  const { decision } = input;
  const blocking = decision.blocking.length;
  if (decision.outcome === 'pass') return 'PASS';
  if (decision.outcome === 'fail') {
    if (blocking) return `FAIL — ${blocking} blocking finding${blocking === 1 ? '' : 's'}`;
    if (decision.notExecutedCategories.length) return 'FAIL — required categories not executed';
    return 'FAIL';
  }
  return `PARTIAL — audit ${inline(input.audit.status)}${decision.degraded ? ', degraded' : ''}`;
}

function locationCell(finding: PrFinding | undefined, fallback?: { file: string; enclosingSymbol: string; verified: boolean } | null): string {
  if (finding?.location) return `${code(`${finding.location.file}:${finding.location.line}`)} · ${code(finding.location.symbol)}`;
  if (fallback?.verified) return `${code(fallback.file)} · ${code(fallback.enclosingSymbol)}`;
  return '—';
}

/** The blocking table: every row cites its rule, its evidence and its source. */
function blockingSection(input: PrPublishInput): string[] {
  const { decision } = input;
  if (!decision.blocking.length) return [];
  const rows = decision.blocking.map(b => {
    const finding = input.findings.get(b.findingId);
    const evidence = b.evidence.map(e => `${code(e.id)} ${inline(e.class)}${e.replayResult ? ` (${inline(e.replayResult)})` : ''}`).join(', ') || '—';
    return `| ${label(b.severity)} | ${inline(finding?.title ?? b.fingerprint)} | ${locationCell(finding, b.sourceLocation)} | ${code(b.rule)} | ${evidence} |`;
  });
  return [`### Blocking (${decision.blocking.length})`, '', '| Severity | Finding | Location | Rule | Evidence |', '|---|---|---|---|---|', ...rows, ''];
}

function warningSection(input: PrPublishInput): string[] {
  const { warnings } = input.decision;
  if (!warnings.length) return [];
  const byReason = new Map<string, number>();
  for (const w of warnings) byReason.set(w.reason, (byReason.get(w.reason) ?? 0) + 1);
  const parts = [...byReason].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([reason, n]) => `${n} × ${inline(reason)}`);
  return [`### Warnings (${warnings.length})`, '', parts.join(' · '), ''];
}

function waiverSection(input: PrPublishInput): string[] {
  const { waived } = input.decision;
  const expiring = input.report.summary.expiringWaivers;
  if (!waived.length && !expiring.length) return [];
  const lines = ['### Waivers', ''];
  const findingCount = new Set(waived.flatMap(w => w.findingIds)).size;
  if (waived.length) lines.push(`- ${findingCount} finding${findingCount === 1 ? ' is' : 's are'} waived by ${waived.length === 1 ? 'an active waiver' : `${waived.length} active waivers`}.`);
  for (const w of expiring) {
    lines.push(`- ⚠ Waiver ${code(w.fingerprint.slice(0, 12))} expires in ${w.daysRemaining} day${w.daysRemaining === 1 ? '' : 's'} (approved by ${inline(w.approvedBy)}); the gate blocks again when it lapses.`);
  }
  lines.push('');
  return lines;
}

function coverageLine(input: PrPublishInput): string {
  const { decision, audit } = input;
  const parts = [`Coverage: ${audit.executedCategories}/${audit.requestedCategories} requested categories executed`];
  if (decision.notExecutedCategories.length) parts.push(`not executed: ${decision.notExecutedCategories.map(inline).join(', ')}`);
  parts.push(decision.degraded ? '**Degraded**' : 'Not degraded');
  parts.push(`policy v${input.policyVersion}`);
  return `<sub>${parts.join(' · ')}</sub>`;
}

function body(input: PrPublishInput, heading: string): string[] {
  const { audit } = input;
  const meta = [`**Commit** ${audit.commitSha ? code(audit.commitSha.slice(0, 12)) : 'unknown'}`, `**Mode** ${inline(audit.mode)}`];
  const took = duration(audit.startedAt, audit.completedAt);
  if (took) meta.push(`**Duration** ${took}`);
  if (input.reportUrl) meta.push(`[Full report](${encodeURI(input.reportUrl)})`);
  const counts = input.report.summary.counts;
  const open = Object.entries(counts).filter(([, n]) => n > 0).map(([s, n]) => `${n} ${s}`).join(', ');
  return [heading, '', meta.join(' · '), '',
    ...(input.decision.outcome === 'partial' ? ['The audit did not finish cleanly, so this result cannot pass. Absence of findings here is not evidence of absence.', ''] : []),
    ...blockingSection(input), ...warningSection(input), ...waiverSection(input),
    `Open findings: ${open || 'none'}.`, '', coverageLine(input)];
}

/** The single PR comment, identified by `COMMENT_MARKER` and updated in place. */
export function renderPrComment(input: PrPublishInput): string {
  return fit([COMMENT_MARKER, ...body(input, `## Kase audit — ${headline(input)}`)].join('\n') + '\n', MAX_COMMENT);
}

/**
 * Check-run annotations: blocking findings as `failure`, other gate warnings
 * that name a finding as `warning`, and only where a verified location exists.
 */
export function annotationsFor(input: PrPublishInput): CheckAnnotation[] {
  const out: CheckAnnotation[] = [];
  const seen = new Set<string>();
  const add = (findingId: string, level: CheckAnnotation['annotation_level'], message: string) => {
    const f = input.findings.get(findingId);
    if (!f?.location || seen.has(findingId)) return;
    seen.add(findingId);
    out.push({ path: f.location.file, start_line: f.location.line, end_line: Math.max(f.location.line, f.location.endLine ?? f.location.line),
      annotation_level: level, title: `${label(f.severity)}: ${f.title}`.slice(0, 255), message: message.slice(0, 64_000) });
  };
  for (const b of input.decision.blocking) {
    add(b.findingId, 'failure', `Blocks the release under ${b.rule}. Evidence: ${b.evidence.map(e => `${e.id} (${e.class})`).join(', ') || 'none'}.`);
  }
  for (const w of input.decision.warnings) if (w.findingId) add(w.findingId, 'warning', w.reason);
  return out;
}

export function renderCheckOutput(input: PrPublishInput): CheckOutput {
  const conclusion = conclusionFor(input.decision.outcome, input.partialIsFailure);
  const summary = fit(body(input, `**Kase gate: ${headline(input)}**`).join('\n') + '\n', MAX_CHECK_TEXT);
  const text = fit(input.report.summary.mustFix.length
    ? ['### Must fix (from the audit report)', '', '| # | Severity | Finding | Location | Effort |', '|---|---|---|---|---|',
      ...input.report.summary.mustFix.map(r => `| ${r.rank} | ${label(r.severity)}${r.blocking ? ' ⛔' : ''} | ${inline(r.title)} | ${code(r.location)} | ${r.effort} |`)].join('\n') + '\n'
    : 'Nothing at medium severity or above is open.\n', MAX_CHECK_TEXT);
  return { conclusion, title: `Kase gate: ${headline(input)}`.slice(0, 255), summary, text, annotations: annotationsFor(input) };
}

/** The check run shown while the audit is still running. */
export function inProgressOutput(auditId: string): { title: string; summary: string } {
  return { title: 'Kase audit running', summary: `Audit ${code(auditId)} is running. This check completes when the release gate has been evaluated.` };
}
