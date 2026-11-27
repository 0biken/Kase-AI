/**
 * Audit report generation (12-policy-gate §5, 15-cli §2, GATES-M6 G6).
 *
 * Follows the skills' report structure (methodology/v1/{blackbox,whitebox}/
 * report-structure*.md): a folder of markdown files, one per tested
 * category, a scope/coverage file, an evidence index, and an executive
 * summary that is built LAST, from the category files already assembled.
 *
 * Everything here is deterministic: no model writes any of this prose, so two
 * reports of the same audit state are byte-identical apart from `generatedAt`.
 * Finding text was written by tools or agents and is untrusted, so every
 * interpolated value is escaped for the markdown context it lands in.
 */

export const SEVERITIES = ['critical', 'high', 'medium', 'low', 'info'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface ReportFinding {
  id: string;
  fingerprint: string;
  status: string;
  origin: string;
  category: string;
  cwe: string | null;
  title: string;
  severity: string;
  affectedTarget: string | null;
  description: string;
  reproduction: unknown;
  impact: string;
  rootCause: string | null;
  fix: string;
  fixPatch: string | null;
  confidenceBand: string;
  aiGenerated: boolean;
  sourceLocations: Array<{ file: string; enclosingSymbol: string; line: number; verified: boolean }>;
  evidence: Array<{ id: string; type: string; replayable: boolean; sha256: string | null }>;
  correlation: { method: string; verified: boolean } | null;
  suppressed: boolean;
}

export interface ReportInput {
  project: { name: string; slug: string };
  audit: {
    id: string; mode: string; status: string; degraded: boolean; degradationReasons: string[];
    target: string | null; repository: string | null; commitSha: string | null; provenanceVerified: boolean;
    startedAt: Date; completedAt: Date | null;
    requestedCategories: string[]; executedCategories: string[];
    notExecutedCategories: Array<{ category: string; reason: string }>;
  };
  findings: ReportFinding[];
  passingChecks: Array<{ category: string; checkId: string; target: string | null }>;
  waivers: Array<{ fingerprint: string; reason: string; requestedBy: string; approvedBy: string; expiresAt: Date }>;
  gate: { outcome: string; policyVersion: number; blockingFindingIds: string[]; waivedFindingIds: string[]; evaluatedAt: Date } | null;
  warnBeforeExpiryDays: number;
  /** The severity rubric copied verbatim from the methodology, so the report is self-contained. */
  severityRubric: string;
  generatedAt: Date;
}

export interface ReportFile { path: string; title: string; markdown: string }
export interface MustFixRow { rank: number; severity: string; title: string; location: string; effort: string; ref: string; blocking: boolean; waived: boolean }
export interface ReportDocument {
  schema: 'kase.report/v1';
  auditId: string;
  generatedAt: string;
  files: ReportFile[];
  summary: {
    counts: Record<Severity, number>;
    mustFix: MustFixRow[];
    gate: { outcome: string; policyVersion: number } | null;
    expiringWaivers: Array<{ fingerprint: string; daysRemaining: number; approvedBy: string }>;
  };
}

/* ----------------------------- escaping ---------------------------------- */

/** Inline text: no raw HTML, no markdown control characters, single line. */
export function inline(value: string | null | undefined): string {
  return (value ?? '').replace(/\r?\n|\r/gu, ' ').replace(/[\\`*_[\]<>|#]/gu, ch => `\\${ch}`).trim();
}

/** Block text: keeps paragraphs, but no raw HTML and no headings smuggled in. */
export function block(value: string | null | undefined): string {
  return (value ?? '').replace(/\r\n?/gu, '\n').split('\n')
    .map(line => line.replace(/[<>]/gu, ch => (ch === '<' ? '&lt;' : '&gt;')).replace(/^(\s*)([#>]|```|~~~)/u, '$1\\$2'))
    .join('\n').trim();
}

/** A fenced code block whose fence is longer than any backtick run inside. */
export function fenced(content: string, lang = ''): string {
  const longest = Math.max(2, ...[...content.matchAll(/`+/gu)].map(m => m[0].length));
  const fence = '`'.repeat(longest + 1);
  return `${fence}${lang}\n${content.replace(/\r\n?/gu, '\n').trimEnd()}\n${fence}`;
}

/* --------------------------- classification ------------------------------ */

interface Section { slug: string; title: string; prefix: string }
const SECTIONS: Array<{ test: RegExp; section: Section }> = [
  { test: /^(authz|authn|authorization|authentication|access[_-]?control|idor)/iu, section: { slug: 'authn-authz', title: 'Authentication & Authorization', prefix: 'AUTHZ' } },
  { test: /^(static[_-]?security|sast)/iu, section: { slug: 'security-static-analysis', title: 'Security — Static Analysis', prefix: 'SEC' } },
  { test: /^secret/iu, section: { slug: 'secrets-and-config', title: 'Secrets & Configuration', prefix: 'SECRET' } },
  { test: /^(dependenc|deps|supply)/iu, section: { slug: 'dependency-audit', title: 'Dependency Audit', prefix: 'DEP' } },
  { test: /^(injection|xss|ssrf|csrf|security|crypto|deserial)/iu, section: { slug: 'security', title: 'Security', prefix: 'SEC' } },
];
export function sectionFor(category: string): Section {
  const known = SECTIONS.find(entry => entry.test.test(category));
  if (known) return known.section;
  const slug = category.toLowerCase().replace(/[^a-z0-9]+/gu, '-').replace(/^-|-$/gu, '') || 'other';
  const title = slug.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  return { slug, title, prefix: slug.replace(/-/gu, '').slice(0, 6).toUpperCase() || 'OTHER' };
}

export function severityOf(value: string): Severity {
  const v = value.toLowerCase();
  return (SEVERITIES as readonly string[]).includes(v) ? v as Severity : 'info';
}
const RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

/** Effort tag (S/M/L) only when the fix text states one; never guessed. */
export function effortOf(fix: string): 'S' | 'M' | 'L' | '—' {
  const match = /\b[Ee]ffort\W{0,3}(S|M|L)\b|\((S|M|L)\)\s*$/u.exec(fix);
  return (match?.[1] ?? match?.[2] ?? '—') as 'S' | 'M' | 'L' | '—';
}
const EFFORT_RANK = { S: 0, M: 1, L: 2, '—': 3 };

const NOT_ACTIONABLE = new Set(['false_positive', 'accepted_risk', 'fixed', 'verified']);
function actionable(f: ReportFinding): boolean { return !f.suppressed && !NOT_ACTIONABLE.has(f.status); }

function location(f: ReportFinding): string {
  const src = f.sourceLocations.find(s => s.verified) ?? f.sourceLocations[0];
  if (src) return `${src.file}:${src.line}`;
  return f.affectedTarget ?? '—';
}

function day(date: Date): string { return date.toISOString().slice(0, 10); }
function daysBetween(later: Date, earlier: Date): number { return Math.ceil((later.getTime() - earlier.getTime()) / 86_400_000); }

/* ------------------------------ assembly --------------------------------- */

interface Numbered { finding: ReportFinding; ref: string; anchor: string }

function findingMarkdown(n: Numbered, input: ReportInput): string {
  const f = n.finding;
  const lines: string[] = [];
  const flags = [f.status !== 'new' && f.status !== 'open' ? `status: ${inline(f.status)}` : '', f.suppressed ? 'suppressed' : '',
    f.aiGenerated ? 'agent-reported' : 'tool-reported', input.gate?.blockingFindingIds.includes(f.id) ? '**blocks release**' : '',
    input.gate?.waivedFindingIds.includes(f.id) ? 'waived' : ''].filter(Boolean);
  lines.push(`## ${n.anchor} · ${inline(f.title)} — **${severityOf(f.severity).toUpperCase()}**`, '');
  if (f.cwe) lines.push(`- **${inline(f.cwe)}**`);
  lines.push(`- **Affected:** ${inline(f.affectedTarget) || '—'}`);
  for (const src of f.sourceLocations) lines.push(`- **Location:** \`${src.file.replace(/`/gu, '')}:${src.line}\` (${inline(src.enclosingSymbol)})${src.verified ? '' : ' — unverified'}`);
  if (f.correlation) lines.push(`- **Correlation:** ${inline(f.correlation.method)}, ${f.correlation.verified ? 'verified' : 'unverified (advisory only)'}`);
  lines.push(`- **Fingerprint:** \`${f.fingerprint.replace(/`/gu, '')}\` · **Confidence:** ${inline(f.confidenceBand)} · ${flags.join(' · ')}`, '');
  if (f.description) lines.push(block(f.description), '');
  if (f.rootCause) lines.push('**Root cause:**', block(f.rootCause), '');
  lines.push('**Repro:**', fenced(JSON.stringify(f.reproduction ?? {}, null, 2), 'json'), '');
  if (f.evidence.length) lines.push(`**Evidence:** ${f.evidence.map(e => `\`${e.id}\` (${inline(e.type)}${e.replayable ? ', replayable' : ''})`).join(', ')}`, '');
  lines.push('**Impact:**', block(f.impact) || '—', '');
  lines.push('**Fix:**', block(f.fix) || '—');
  if (f.fixPatch) lines.push('', fenced(f.fixPatch, 'diff'));
  return lines.join('\n');
}

export function buildReport(input: ReportInput): ReportDocument {
  const reviewed = day(input.generatedAt);
  const targets = [input.audit.target, input.audit.repository].filter((t): t is string => !!t);
  const header = (title: string) => [`# ${title}`, '', `**Reviewer:** Kase, on behalf of ${inline(input.project.name)}`, `**Date:** ${reviewed}`,
    `**Targets:** ${targets.map(inline).join(', ') || '—'}`, `**Audit:** \`${input.audit.id}\`${input.audit.commitSha ? ` at \`${input.audit.commitSha}\`` : ''}`, ''];

  // 1. Group and number findings per category section, worst first.
  const sorted = [...input.findings].sort((a, b) => RANK[severityOf(a.severity)] - RANK[severityOf(b.severity)] || a.fingerprint.localeCompare(b.fingerprint));
  const bySection = new Map<string, { section: Section; items: Numbered[] }>();
  for (const finding of sorted) {
    const section = sectionFor(finding.category);
    const group = bySection.get(section.slug) ?? { section, items: [] };
    group.items.push({ finding, ref: '', anchor: `${section.prefix}-${String(group.items.length + 1).padStart(2, '0')}` });
    bySection.set(section.slug, group);
  }
  const passingBySection = new Map<string, ReportInput['passingChecks']>();
  for (const check of input.passingChecks) {
    const slug = sectionFor(check.category).slug;
    passingBySection.set(slug, [...(passingBySection.get(slug) ?? []), check]);
    if (!bySection.has(slug)) bySection.set(slug, { section: sectionFor(check.category), items: [] });
  }
  const groups = [...bySection.values()].sort((a, b) => {
    const worst = (g: typeof a) => Math.min(5, ...g.items.map(i => RANK[severityOf(i.finding.severity)]));
    return worst(a) - worst(b) || a.section.slug.localeCompare(b.section.slug);
  });

  // 2. Scope & coverage, then one file per category actually tested.
  const files: ReportFile[] = [];
  const scopeLines = [...header('Scope & Coverage'),
    `**Mode:** ${inline(input.audit.mode)} · **Status:** ${inline(input.audit.status)}${input.audit.degraded ? ' · **degraded**' : ''}`,
    `**Build provenance:** ${input.audit.commitSha ? `\`${input.audit.commitSha}\` (${input.audit.provenanceVerified ? 'verified' : 'unverified — correlated findings are advisory'})` : 'none recorded'}`, '',
    '## Categories executed', '', ...(input.audit.executedCategories.length ? input.audit.executedCategories.map(c => `- ${inline(c)}`) : ['- none']), ''];
  if (input.audit.notExecutedCategories.length) scopeLines.push('## Not executed', '', ...input.audit.notExecutedCategories.map(n => `- ${inline(n.category)} — ${inline(n.reason)}`), '');
  if (input.audit.degradationReasons.length) scopeLines.push('## Degradation', '', ...input.audit.degradationReasons.map(r => `- ${inline(r)}`), '');
  scopeLines.push('## Passing checks', '', input.passingChecks.length ? `${input.passingChecks.length} check${input.passingChecks.length === 1 ? ' was' : 's were'} tested and found clean; each category file lists its own.` : 'No passing checks were recorded. Untested is not the same as clean.', '');
  files.push({ path: '01-scope-and-coverage.md', title: 'Scope & Coverage', markdown: scopeLines.join('\n').trimEnd() + '\n' });

  groups.forEach((group, index) => {
    const path = `${String(index + 2).padStart(2, '0')}-${group.section.slug}.md`;
    for (const item of group.items) item.ref = `${path} §${item.anchor}`;
    const body = [...header(group.section.title), 'Format: **ID · Title · Severity · Affected · Repro · Impact · Fix**', '', '---', ''];
    body.push(group.items.length ? group.items.map(item => findingMarkdown(item, input)).join('\n\n---\n\n') : 'No findings in this category.', '');
    const passing = passingBySection.get(group.section.slug) ?? [];
    if (passing.length) body.push('## Passing checks', '', ...passing.map(p => `- **PASS** ✅ \`${p.checkId.replace(/`/gu, '')}\`${p.target ? ` — ${inline(p.target)}` : ''}`), '');
    files.push({ path, title: group.section.title, markdown: body.join('\n').trimEnd() + '\n' });
  });

  // 3. Evidence index.
  const evidence = new Map<string, { type: string; replayable: boolean; sha256: string | null; refs: string[] }>();
  for (const group of groups) for (const item of group.items) for (const e of item.finding.evidence) {
    const entry = evidence.get(e.id) ?? { type: e.type, replayable: e.replayable, sha256: e.sha256, refs: [] };
    entry.refs.push(item.anchor);
    evidence.set(e.id, entry);
  }
  files.push({ path: 'evidence-index.md', title: 'Evidence Index', markdown: [...header('Evidence Index'),
    '| Evidence | Type | Replayable | SHA-256 | Findings |', '|---|---|---|---|---|',
    ...[...evidence].sort(([a], [b]) => a.localeCompare(b)).map(([id, e]) => `| \`${id}\` | ${inline(e.type)} | ${e.replayable ? 'yes' : 'no'} | ${e.sha256 ? `\`${e.sha256}\`` : '—'} | ${e.refs.join(', ')} |`),
    ...(evidence.size ? [] : ['| — | — | — | — | — |'])].join('\n') + '\n' });

  // 4. Executive summary — LAST, built only from what the files above contain.
  const counts = Object.fromEntries(SEVERITIES.map(s => [s, 0])) as Record<Severity, number>;
  const numbered = groups.flatMap(g => g.items);
  for (const item of numbered) if (actionable(item.finding)) counts[severityOf(item.finding.severity)]++;
  const blocking = new Set(input.gate?.blockingFindingIds ?? []);
  const mustFix: MustFixRow[] = numbered.filter(item => actionable(item.finding) && RANK[severityOf(item.finding.severity)] <= RANK.medium)
    .sort((a, b) => RANK[severityOf(a.finding.severity)] - RANK[severityOf(b.finding.severity)]
      || EFFORT_RANK[effortOf(a.finding.fix)] - EFFORT_RANK[effortOf(b.finding.fix)]
      || Number(blocking.has(b.finding.id)) - Number(blocking.has(a.finding.id))
      || a.finding.fingerprint.localeCompare(b.finding.fingerprint))
    .slice(0, 10)
    .map((item, i) => ({ rank: i + 1, severity: severityOf(item.finding.severity), title: item.finding.title, location: location(item.finding),
      effort: effortOf(item.finding.fix), ref: item.ref, blocking: blocking.has(item.finding.id),
      waived: input.gate?.waivedFindingIds.includes(item.finding.id) ?? false }));
  const expiringWaivers = input.waivers
    .filter(w => w.expiresAt.getTime() > input.generatedAt.getTime())
    .map(w => ({ fingerprint: w.fingerprint, daysRemaining: daysBetween(w.expiresAt, input.generatedAt), approvedBy: w.approvedBy, reason: w.reason, requestedBy: w.requestedBy }))
    .sort((a, b) => a.daysRemaining - b.daysRemaining || a.fingerprint.localeCompare(b.fingerprint));
  const soon = expiringWaivers.filter(w => w.daysRemaining <= input.warnBeforeExpiryDays);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const countLine = SEVERITIES.filter(s => counts[s]).map(s => `${counts[s]} ${s}`).join(', ');

  const tldr: string[] = [];
  tldr.push(total ? `${total} open finding${total === 1 ? '' : 's'}: ${countLine}.` : 'No open findings in the executed categories.');
  if (input.gate) tldr.push(`Release gate: **${input.gate.outcome.toUpperCase()}** under policy v${input.gate.policyVersion}${blocking.size ? `, blocked by ${blocking.size} finding${blocking.size === 1 ? '' : 's'}` : ''}.`);
  else tldr.push('The release gate has not been evaluated for this audit.');
  if (mustFix.length) {
    const top = mustFix.slice(0, 3).map(row => `${inline(row.title)} (\`${row.location.replace(/`/gu, '')}\`)`);
    tldr.push(`${RANK[severityOf(mustFix[0].severity)] <= RANK.high ? 'Most urgent' : 'Top issues'}: ${top.join('; ')}.`);
  }
  if (input.audit.status !== 'completed' || input.audit.degraded) tldr.push(`This audit is **${inline(input.audit.status)}${input.audit.degraded ? ', degraded' : ''}**: absence of findings is not evidence of absence.`);

  const accepted = numbered.filter(item => item.finding.status === 'accepted_risk');
  const scopeNotes = [
    ...input.audit.notExecutedCategories.map(n => `- Not executed: ${inline(n.category)} (${inline(n.reason)}).`),
    ...input.audit.degradationReasons.map(r => `- Degraded: ${inline(r)}.`),
    ...(input.audit.provenanceVerified ? [] : ['- Build provenance is unverified, so correlated findings are advisory and cannot block.']),
    ...accepted.map(item => `- Accepted risk: ${inline(item.finding.title)} (${item.ref}).`),
  ];

  const mode = inline(input.audit.mode);
  const summary = [`# Executive Summary — ${inline(input.project.name)} ${mode.charAt(0).toUpperCase() + mode.slice(1)} Audit`, '',
    `**Reviewer:** Kase, on behalf of ${inline(input.project.name)}`, `**Date:** ${reviewed}`, `**Targets:** ${targets.map(inline).join(', ') || '—'}`,
    `**Repo/commit reviewed:** ${input.audit.commitSha ? `\`${input.audit.commitSha}\`` : '—'}`,
    `**Methodology:** ${input.audit.executedCategories.map(inline).join(', ') || 'none executed'} (deterministic tools and typed-capability agents)`, '',
    '---', '', '## TL;DR', '', tldr.join(' '), '', '---', '',
    `## Top ${mustFix.length} Must-Fix Before Launch (ranked)`, ''];
  if (mustFix.length) {
    summary.push('| # | Severity | Finding | Location | Effort | Report |', '|---|---|---|---|---|---|',
      ...mustFix.map(r => `| ${r.rank} | ${r.severity.charAt(0).toUpperCase() + r.severity.slice(1)}${r.blocking ? ' ⛔' : ''} | ${inline(r.title)}${r.waived ? ' _(waived)_' : ''} | \`${r.location.replace(/[`|]/gu, '')}\` | ${r.effort} | \`${r.ref}\` |`),
      '', '⛔ blocks the release under the evaluated gate policy. Effort is shown only where the fix states it.');
  } else summary.push('Nothing at medium severity or above is open.');
  summary.push('', '---', '', '## Waivers', '');
  if (expiringWaivers.length) {
    summary.push('| Fingerprint | Expires in | Approved by | Reason |', '|---|---|---|---|',
      ...expiringWaivers.map(w => `| \`${w.fingerprint.replace(/[`|]/gu, '')}\` | ${w.daysRemaining}d${w.daysRemaining <= input.warnBeforeExpiryDays ? ' ⚠' : ''} | ${inline(w.approvedBy)} | ${inline(w.reason)} |`));
    if (soon.length) summary.push('', `⚠ ${soon.length} waiver${soon.length === 1 ? '' : 's'} expire${soon.length === 1 ? 's' : ''} within ${input.warnBeforeExpiryDays} days; the gate will block again when ${soon.length === 1 ? 'it lapses' : 'they lapse'}.`);
  } else summary.push('No active waivers.');
  summary.push('', '---', '', '## Severity model used', '', input.severityRubric.trim(), '', '---', '', '## Scope notes', '',
    ...(scopeNotes.length ? scopeNotes : ['- All requested categories executed; build provenance verified.']), '', '---', '', '## Index', '',
    ...files.map(file => `- [\`${file.path}\`](${file.path}) — ${file.title}`));
  files.unshift({ path: '00-executive-summary.md', title: 'Executive Summary', markdown: summary.join('\n') + '\n' });

  return {
    schema: 'kase.report/v1', auditId: input.audit.id, generatedAt: input.generatedAt.toISOString(), files,
    summary: { counts, mustFix, gate: input.gate ? { outcome: input.gate.outcome, policyVersion: input.gate.policyVersion } : null,
      expiringWaivers: soon.map(({ fingerprint, daysRemaining, approvedBy }) => ({ fingerprint, daysRemaining, approvedBy })) },
  };
}

/** Single-document markdown: every file in order, separated by rules. */
export function reportToMarkdown(report: ReportDocument): string {
  return report.files.map(file => `<!-- ${file.path} -->\n${file.markdown}`).join('\n---\n\n');
}
