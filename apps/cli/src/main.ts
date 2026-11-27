#!/usr/bin/env node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { ApiError, AuditRecord, GateDecision, GateOutcome, KaseClient, resolveNamed, resolveProject } from './client';

export interface Io {
  out(value: string): void;
  err(value: string): void;
}

const terminalExit: Record<AuditRecord['status'], number> = {
  queued: 0, running: 0, completed: 0, partial: 2, failed: 5, cancelled: 130,
};

// CI exit codes for a gate outcome (12-policy-gate §6): PASS 0, FAIL 1, PARTIAL 2.
const gateExit: Record<GateOutcome, number> = { pass: 0, fail: 1, partial: 2 };

export async function run(argv: string[], env: NodeJS.ProcessEnv, io: Io, fetcher: typeof fetch = fetch): Promise<number> {
  const [group, action, ...rest] = argv;
  if (!env.KASE_TOKEN) throw new Error('KASE_TOKEN is required');
  const client = new KaseClient(env.KASE_API_URL ?? 'http://localhost:3002/api/v1', env.KASE_TOKEN, fetcher);
  if (group === 'audit' && action === 'start') return startAudit(client, rest, io);
  if (group === 'findings' && action === 'list') return listFindings(client, rest, io);
  if (group === 'gate' && action === 'evaluate') return evaluateGate(client, rest, io);
  if (group === 'gate' && action === 'show') return showGate(client, rest, io);
  if (group === 'report' && action === 'get') return getReport(client, rest, io);
  if (group === 'import' && action === 'security-audit') return importSecurityAudit(client, rest, io);
  if (group === 'findings' && action === 'transition') return transitionFinding(client, rest, io);
  if (group === 'dedup' && action === 'list') return listDedup(client, rest, io);
  if (group === 'dedup' && action === 'decide') return decideDedup(client, rest, io);
  throw new Error('Usage: kase audit start ... | kase findings list|transition ... | kase dedup list|decide ... | kase gate evaluate|show ... | kase report get ... | kase import security-audit ...');
}

const DECISIONS = ['false_positive', 'accepted_risk', 'reopen', 'confirm_fixed'];

/** Records a lifecycle decision on a finding identity; the API enforces who may make it. */
async function transitionFinding(client: KaseClient, args: string[], io: Io): Promise<number> {
  const v = parseArgs({ args, strict: true, options: { project: { type: 'string' }, identity: { type: 'string' }, decision: { type: 'string' },
    reason: { type: 'string' }, json: { type: 'boolean', default: false } } }).values;
  if (!v.project || !v.identity || !v.decision || !v.reason) throw new Error('Usage: kase findings transition --project <id> --identity <id> --decision <decision> --reason <text>');
  if (!DECISIONS.includes(v.decision)) throw new Error(`--decision must be one of ${DECISIONS.join(', ')}`);
  const result = await client.transitionFinding(await resolveProject(client, v.project), v.identity, v.decision, v.reason);
  if (v.json) io.out(JSON.stringify(result)); else io.out(`${v.identity}: ${String(result.status)}`);
  return 0;
}

/** Lists POSSIBLE_MATCH proposals waiting for a human decision. */
async function listDedup(client: KaseClient, args: string[], io: Io): Promise<number> {
  const v = parseArgs({ args, strict: true, options: { project: { type: 'string' }, json: { type: 'boolean', default: false } } }).values;
  if (!v.project) throw new Error('--project is required');
  const queue = await client.dedupQueue(await resolveProject(client, v.project)) as Array<Record<string, any>>;
  if (v.json) { io.out(JSON.stringify(queue)); return 0; }
  if (!queue.length) { io.out('no proposals waiting'); return 0; }
  for (const item of queue) {
    io.out(`${item.id}  level ${item.level} (${item.confidenceBand})`);
    io.out(`  new:       ${item.finding?.title ?? '?'} [${item.finding?.identity?.fingerprint ?? '?'}]`);
    io.out(`  candidate: ${item.candidate?.title ?? '?'} [${item.candidate?.identity?.fingerprint ?? '?'}]`);
  }
  return 0;
}

async function decideDedup(client: KaseClient, args: string[], io: Io): Promise<number> {
  const v = parseArgs({ args, strict: true, options: { project: { type: 'string' }, proposal: { type: 'string' }, decision: { type: 'string' },
    rationale: { type: 'string' }, json: { type: 'boolean', default: false } } }).values;
  if (!v.project || !v.proposal || !v.decision || !v.rationale) throw new Error('Usage: kase dedup decide --project <id> --proposal <id> --decision confirm|reject --rationale <text>');
  if (v.decision !== 'confirm' && v.decision !== 'reject') throw new Error('--decision must be confirm or reject');
  const result = await client.decideDedup(await resolveProject(client, v.project), v.proposal, v.decision, v.rationale);
  if (v.json) io.out(JSON.stringify(result)); else io.out(`${v.proposal}: ${String(result.status)}`);
  return 0;
}

/** Imports cloudflare/security-audit-skill `findings.json`; imported findings are warn-only and never gate-eligible. */
async function importSecurityAudit(client: KaseClient, args: string[], io: Io): Promise<number> {
  const parsed = parseArgs({ args, strict: true, allowPositionals: true,
    options: { audit: { type: 'string' }, json: { type: 'boolean', default: false } } });
  const file = parsed.positionals[0];
  if (!parsed.values.audit || !file) throw new Error('Usage: kase import security-audit --audit <id> <findings.json>');
  let body: unknown;
  try { body = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { throw new Error(`Cannot read ${file} as JSON: ${error instanceof Error ? error.message : String(error)}`); }
  emit(io, parsed.values.json!, await client.importSecurityAudit(parsed.values.audit, body));
  return 0;
}

async function evaluateGate(client: KaseClient, args: string[], io: Io): Promise<number> {
  const parsed = parseArgs({ args, strict: true, options: { audit: { type: 'string' }, json: { type: 'boolean', default: false } } }).values;
  if (!parsed.audit) throw new Error('--audit is required');
  const result = await client.evaluateGate(parsed.audit);
  if (parsed.json) io.out(JSON.stringify(result));
  else io.out(formatGate(result.decision));
  return gateExit[result.decision.outcome];
}

async function showGate(client: KaseClient, args: string[], io: Io): Promise<number> {
  const parsed = parseArgs({ args, strict: true, options: { audit: { type: 'string' }, json: { type: 'boolean', default: false } } }).values;
  if (!parsed.audit) throw new Error('--audit is required');
  emit(io, parsed.json!, await client.getGate(parsed.audit));
  return 0;
}

// A report file name comes from the server; only flat, plain names are written.
const REPORT_FILE = /^[a-z0-9][a-z0-9-]*\.md$/;

/**
 * `kase report get --audit <id> [--format markdown|json] [--out dir]` (15-cli §2).
 * With --out, markdown writes the report folder (00-executive-summary.md, one
 * file per category, evidence-index.md) and json writes report.json.
 */
async function getReport(client: KaseClient, args: string[], io: Io): Promise<number> {
  const parsed = parseArgs({ args, strict: true, options: {
    audit: { type: 'string' }, format: { type: 'string', default: 'markdown' }, out: { type: 'string' },
  } }).values;
  if (!parsed.audit) throw new Error('--audit is required');
  const format = parsed.format === 'md' ? 'markdown' : parsed.format;
  if (format !== 'markdown' && format !== 'json') throw new Error('--format must be markdown or json');
  const report = await client.getReport(parsed.audit);
  for (const file of report.files) if (!REPORT_FILE.test(file.path)) throw new Error(`Refusing report file name "${file.path}"`);
  if (!parsed.out) {
    io.out(format === 'json' ? JSON.stringify(report) : report.files.map((f) => f.markdown).join('\n---\n\n'));
    return 0;
  }
  await mkdir(parsed.out, { recursive: true });
  if (format === 'json') {
    await writeFile(join(parsed.out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    io.out(`wrote ${join(parsed.out, 'report.json')}`);
  } else {
    for (const file of report.files) await writeFile(join(parsed.out, file.path), file.markdown);
    io.out(`wrote ${report.files.length} files to ${parsed.out}`);
  }
  return 0;
}

/** Explainable gate output: every block cites its rule, evidence, and source. */
function formatGate(d: GateDecision): string {
  const lines: string[] = [`gate: ${d.outcome.toUpperCase()} (mode=${d.mode})`];
  if (d.notExecutedCategories.length) lines.push(`required categories not executed: ${d.notExecutedCategories.join(', ')}`);
  for (const b of d.blocking) {
    lines.push(`BLOCK ${b.severity} ${b.category} ${b.findingId}`);
    lines.push(`  rule: ${b.rule}`);
    lines.push(`  evidence: ${b.evidence.map((e) => `${e.id}(${e.class}${e.replayResult ? `:${e.replayResult}` : ''})`).join(', ')}`);
    if (b.sourceLocation) lines.push(`  source: ${b.sourceLocation.file} ${b.sourceLocation.enclosingSymbol}${b.sourceLocation.verified ? ' (verified)' : ''}`);
  }
  for (const w of d.waived) lines.push(`WAIVED ${w.fingerprint} — expires in ${w.daysRemaining}d (approved by ${w.approvedBy})`);
  for (const w of d.warnings) lines.push(`warn: ${w.reason}`);
  return lines.join('\n');
}

async function startAudit(client: KaseClient, args: string[], io: Io): Promise<number> {
  const parsed = parseArgs({ args, strict: true, options: {
    project: { type: 'string' }, target: { type: 'string' }, repository: { type: 'string' },
    mode: { type: 'string', default: 'full' }, commit: { type: 'string' }, categories: { type: 'string' },
    'budget-minutes': { type: 'string' }, wait: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
  }}).values;
  if (!parsed.project) throw new Error('--project is required');
  // A security audit reads the repository only; smoke and full audits also probe a running target.
  if (!parsed.target && parsed.mode !== 'security') throw new Error('--target is required for smoke and full audits');
  if (!['smoke', 'security', 'full'].includes(parsed.mode!)) throw new Error('--mode must be smoke, security, or full');
  // Valid categories: sast, http, blackbox, whitebox (M4); security adds the security-audit methodology to the whitebox agent
  const validCategories = ['sast', 'http', 'blackbox', 'whitebox', 'security'];
  if (parsed.categories) {
    const cats = parsed.categories.split(',').filter(Boolean);
    const invalid = cats.filter(c => !validCategories.includes(c));
    if (invalid.length) throw new Error(`Invalid categories: ${invalid.join(', ')}. Valid: ${validCategories.join(', ')}`);
  }
  const projectId = await resolveProject(client, parsed.project);
  const targetId = parsed.target ? await resolveNamed(await client.listTargets(projectId), parsed.target, 'tgt', ['id', 'name'], 'target') : undefined;
  const repositories = await client.listRepositories(projectId);
  let repositoryId: string | undefined;
  if (parsed.mode !== 'smoke' || parsed.repository) {
    if (!parsed.repository && repositories.length !== 1) throw new Error('--repository is required when a project does not have exactly one repository');
    repositoryId = await resolveNamed(repositories, parsed.repository ?? String(repositories[0].id), 'repo', ['id', 'url'], 'repository');
  }
  const budget = parsed['budget-minutes'] === undefined ? undefined : Number(parsed['budget-minutes']);
  if (budget !== undefined && (!Number.isInteger(budget) || budget < 1 || budget > 90)) throw new Error('--budget-minutes must be an integer from 1 to 90');
  const audit = await client.startAudit(projectId, {
    ...(targetId ? { targetId } : {}), ...(repositoryId ? { repositoryId } : {}), mode: parsed.mode,
    ...(parsed.commit ? { commitSha: parsed.commit } : {}),
    ...(parsed.categories ? { categories: parsed.categories.split(',').filter(Boolean) } : {}),
    ...(budget ? { maxWallTimeMs: budget * 60_000 } : {}),
  });
  if (!parsed.wait) { emit(io, parsed.json!, audit); return 0; }
  if (!parsed.commit && parsed.mode !== 'smoke' && !parsed.json) io.err('warning: no --commit supplied; provenance may be assumed and unverified');

  const aborter = new AbortController();
  let interrupted = false;
  const onSigint = () => { interrupted = true; aborter.abort(); };
  process.once('SIGINT', onSigint);
  try {
    const terminal = await client.waitForAudit(audit.id, (event) => {
      if (!parsed.json) io.err(`${event.type}: ${JSON.stringify(event.data)}`);
    }, aborter.signal);
    emit(io, parsed.json!, terminal);
    return terminalExit[terminal.status];
  } catch (error) {
    if (!interrupted) throw error;
    const cancelled = await client.cancelAudit(audit.id);
    emit(io, parsed.json!, cancelled);
    return 130;
  } finally {
    process.removeListener('SIGINT', onSigint);
  }
}

async function listFindings(client: KaseClient, args: string[], io: Io): Promise<number> {
  const parsed = parseArgs({ args, strict: true, options: {
    audit: { type: 'string' }, severity: { type: 'string' }, category: { type: 'string' },
    'gate-eligible': { type: 'string' }, json: { type: 'boolean', default: false },
  }}).values;
  if (!parsed.audit) throw new Error('--audit is required');
  if (parsed['gate-eligible'] && !['true', 'false'].includes(parsed['gate-eligible'])) throw new Error('--gate-eligible must be true or false');
  const result = await client.listFindings(parsed.audit, {
    severity: parsed.severity, category: parsed.category, gateEligible: parsed['gate-eligible'],
  });
  emit(io, parsed.json!, result);
  return 0;
}

function emit(io: Io, json: boolean, value: unknown): void {
  if (json) io.out(JSON.stringify(value));
  else io.out(formatHuman(value));
}

function formatHuman(value: unknown): string {
  if (Array.isArray(value)) return value.map((item) => formatHuman(item)).join('\n');
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${typeof item === 'object' ? JSON.stringify(item) : String(item)}`).join('\n');
  }
  return String(value);
}

export function errorExit(error: unknown): number {
  if (!(error instanceof ApiError)) return 5;
  if (error.status === 401 || error.status === 403) return 4;
  if (error.code.includes('SCOPE') || error.code.includes('ATTESTATION')) return 3;
  return 5;
}

if (require.main === module) {
  run(process.argv.slice(2), process.env, { out: console.log, err: console.error })
    .then((code) => { process.exitCode = code; })
    .catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = errorExit(error); });
}
