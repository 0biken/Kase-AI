// Kase gate action (13-integrations §2, GATES-M6 G7): start an audit at the
// commit, wait for it, evaluate the release gate, write the report, and exit
// on the outcome with the CLI's codes (PASS 0, FAIL 1, PARTIAL 2).
//
// Fails closed: if the audit cannot start or the gate cannot be read, the job
// fails. It never turns a run it could not evaluate into a pass.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const EXIT = { pass: 0, fail: 1, partial: 2 };

export function parseFailOn(value) {
  const raw = (value ?? '').trim().toLowerCase();
  if (raw === 'none') return new Set();
  const parts = (raw || 'fail,partial').split(',').map(s => s.trim()).filter(Boolean);
  const bad = parts.filter(p => p !== 'fail' && p !== 'partial');
  if (bad.length) throw new Error(`fail-on accepts fail, partial or none, not: ${bad.join(', ')}`);
  return new Set(parts);
}

/** The CLI prints one JSON object per --json command; take the last line that parses. */
export function lastJson(stdout) {
  const lines = String(stdout ?? '').trim().split(/\r?\n/u).reverse();
  for (const line of lines) {
    try { return JSON.parse(line); } catch { /* not JSON */ }
  }
  return null;
}

// GitHub workflow-command escaping, so a finding title cannot start a new command.
const escapeData = s => String(s).replace(/%/gu, '%25').replace(/\r/gu, '%0D').replace(/\n/gu, '%0A');
const escapeProperty = s => escapeData(s).replace(/:/gu, '%3A').replace(/,/gu, '%2C');
const oneLine = s => String(s ?? '').replace(/[\r\n]+/gu, ' ');

export async function runGate({ env, runCli, setOutput, log, appendSummary, readText = p => readFileSync(p, 'utf8'), exists = existsSync }) {
  const get = name => (env[name] ?? '').trim();
  const apiUrl = get('KASE_API_URL').replace(/\/+$/u, '');
  const project = get('KASE_PROJECT');
  if (!apiUrl || !get('KASE_TOKEN') || !project) {
    log.error('api-url, api-token and project are required');
    return 5;
  }
  let failOn;
  try { failOn = parseFailOn(env.KASE_FAIL_ON); } catch (error) { log.error(error.message); return 5; }

  const mode = get('KASE_MODE') || 'security';
  const commit = get('KASE_COMMIT');
  if (!commit) {
    log.warning('No commit was supplied, so build provenance falls back to "assumed" and correlated findings cannot block. Pass commit: ${{ github.sha }}.');
  }
  const optional = (flag, value) => (value ? [flag, value] : []);
  const start = await runCli(['audit', 'start', '--project', project, ...optional('--target', get('KASE_TARGET')),
    ...optional('--repository', get('KASE_REPOSITORY')), '--mode', mode, ...optional('--commit', commit),
    ...optional('--categories', get('KASE_CATEGORIES')), ...optional('--budget-minutes', get('KASE_BUDGET_MINUTES')), '--wait', '--json']);
  const audit = lastJson(start.stdout);
  if (!audit?.id) {
    log.error(`The Kase audit could not be started: ${oneLine(start.stderr).slice(-500) || `exit ${start.status}`}`);
    return start.status || 5;
  }
  setOutput('audit-id', audit.id);
  setOutput('audit-status', audit.status ?? 'unknown');
  setOutput('report-url', `${apiUrl}/audits/${audit.id}/report?format=markdown`);

  const gate = await runCli(['gate', 'evaluate', '--audit', audit.id, '--json']);
  const decision = lastJson(gate.stdout)?.decision;
  if (!decision?.outcome || !(decision.outcome in EXIT)) {
    log.error(`The release gate could not be evaluated for ${audit.id}: ${oneLine(gate.stderr).slice(-500) || `exit ${gate.status}`}`);
    return gate.status || 5;
  }
  const blocking = Array.isArray(decision.blocking) ? decision.blocking : [];
  setOutput('outcome', decision.outcome);
  setOutput('blocking-count', String(blocking.length));
  setOutput('critical-count', String(blocking.filter(b => b.severity === 'critical').length));
  setOutput('degraded', String(Boolean(decision.degraded)));

  for (const b of blocking) {
    const src = b.sourceLocation?.verified ? `${b.sourceLocation.file} ${b.sourceLocation.enclosingSymbol}` : 'source not verified';
    log.command('error', { title: `Kase blocks: ${b.severity} ${b.category}` },
      `${b.findingId} — ${b.rule} — evidence ${(b.evidence ?? []).map(e => `${e.id}(${e.class})`).join(', ') || 'none'} — ${src}`);
  }
  if (decision.outcome === 'partial') log.warning('The audit did not finish cleanly, so the gate is PARTIAL. PARTIAL is never a pass.');

  const reportDir = get('KASE_REPORT_DIR');
  if (reportDir) {
    const report = await runCli(['report', 'get', '--audit', audit.id, '--out', reportDir]);
    const summary = join(reportDir, '00-executive-summary.md');
    if (report.status === 0 && exists(summary)) {
      setOutput('report-dir', reportDir);
      appendSummary(readText(summary));
    } else {
      log.warning(`The report could not be written: ${oneLine(report.stderr).slice(-300) || `exit ${report.status}`}`);
    }
  }

  const code = failOn.has(decision.outcome) ? EXIT[decision.outcome] : 0;
  log.info(`Kase gate: ${decision.outcome.toUpperCase()} (${blocking.length} blocking)${code ? ' — failing the job' : ''}`);
  return code;
}

/* ------------------------------ entry point ------------------------------ */

function spawnCli(cliPath, env) {
  return args => new Promise(resolve => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      // The token goes to the CLI by environment only, never on the command line.
      env: { ...process.env, KASE_API_URL: env.KASE_API_URL, KASE_TOKEN: env.KASE_TOKEN },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; process.stderr.write(chunk); }); // live audit progress
    child.on('close', status => resolve({ status: status ?? 5, stdout, stderr }));
    child.on('error', error => resolve({ status: 5, stdout, stderr: String(error) }));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const env = process.env;
  const here = dirname(fileURLToPath(import.meta.url));
  const cliPath = env.KASE_CLI_PATH || join(here, '../../../apps/cli/dist/main.js');
  const setOutput = (name, value) => {
    if (env.GITHUB_OUTPUT) appendFileSync(env.GITHUB_OUTPUT, `${name}=${oneLine(value)}\n`);
  };
  const log = {
    info: m => console.log(m),
    warning: m => console.log(`::warning::${escapeData(m)}`),
    error: m => console.log(`::error::${escapeData(m)}`),
    command: (cmd, props, m) => console.log(`::${cmd} ${Object.entries(props).map(([k, v]) => `${k}=${escapeProperty(v)}`).join(',')}::${escapeData(m)}`),
  };
  const appendSummary = text => { if (env.GITHUB_STEP_SUMMARY) appendFileSync(env.GITHUB_STEP_SUMMARY, `${text}\n`); };
  runGate({ env, runCli: spawnCli(cliPath, env), setOutput, log, appendSummary })
    .then(code => { process.exitCode = code; })
    .catch(error => { console.log(`::error::${escapeData(error instanceof Error ? error.message : String(error))}`); process.exitCode = 5; });
}

export { escapeData, escapeProperty };
