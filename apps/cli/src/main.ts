#!/usr/bin/env node
import { parseArgs } from 'node:util';
import { ApiError, AuditRecord, KaseClient, resolveNamed, resolveProject } from './client';

export interface Io {
  out(value: string): void;
  err(value: string): void;
}

const terminalExit: Record<AuditRecord['status'], number> = {
  queued: 0, running: 0, completed: 0, partial: 2, failed: 5, cancelled: 130,
};

export async function run(argv: string[], env: NodeJS.ProcessEnv, io: Io, fetcher: typeof fetch = fetch): Promise<number> {
  const [group, action, ...rest] = argv;
  if (!env.KASE_TOKEN) throw new Error('KASE_TOKEN is required');
  const client = new KaseClient(env.KASE_API_URL ?? 'http://localhost:3002/api/v1', env.KASE_TOKEN, fetcher);
  if (group === 'audit' && action === 'start') return startAudit(client, rest, io);
  if (group === 'findings' && action === 'list') return listFindings(client, rest, io);
  throw new Error('Usage: kase audit start ... | kase findings list ...');
}

async function startAudit(client: KaseClient, args: string[], io: Io): Promise<number> {
  const parsed = parseArgs({ args, strict: true, options: {
    project: { type: 'string' }, target: { type: 'string' }, repository: { type: 'string' },
    mode: { type: 'string', default: 'full' }, commit: { type: 'string' }, categories: { type: 'string' },
    'budget-minutes': { type: 'string' }, wait: { type: 'boolean', default: false }, json: { type: 'boolean', default: false },
  }}).values;
  if (!parsed.project || !parsed.target) throw new Error('--project and --target are required');
  if (!['smoke', 'security', 'full'].includes(parsed.mode!)) throw new Error('--mode must be smoke, security, or full');
  const projectId = await resolveProject(client, parsed.project);
  const targetId = await resolveNamed(await client.listTargets(projectId), parsed.target, 'tgt', ['id', 'name'], 'target');
  const repositories = await client.listRepositories(projectId);
  let repositoryId: string | undefined;
  if (parsed.mode !== 'smoke' || parsed.repository) {
    if (!parsed.repository && repositories.length !== 1) throw new Error('--repository is required when a project does not have exactly one repository');
    repositoryId = await resolveNamed(repositories, parsed.repository ?? String(repositories[0].id), 'repo', ['id', 'url'], 'repository');
  }
  const budget = parsed['budget-minutes'] === undefined ? undefined : Number(parsed['budget-minutes']);
  if (budget !== undefined && (!Number.isInteger(budget) || budget < 1 || budget > 90)) throw new Error('--budget-minutes must be an integer from 1 to 90');
  const audit = await client.startAudit(projectId, {
    targetId, ...(repositoryId ? { repositoryId } : {}), mode: parsed.mode,
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
