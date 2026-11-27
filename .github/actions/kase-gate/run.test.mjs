import assert from 'node:assert/strict';
import test from 'node:test';
import { escapeData, escapeProperty, lastJson, parseFailOn, runGate } from './run.mjs';

const ENV = { KASE_API_URL: 'https://kase.test/api/v1/', KASE_TOKEN: 'tok_secret', KASE_PROJECT: 'acme', KASE_COMMIT: 'a'.repeat(40), KASE_REPORT_DIR: 'kase-report' };

function harness(responses, env = ENV) {
  const calls = [];
  const outputs = {};
  const logs = [];
  const summaries = [];
  const runCli = async args => { calls.push(args); const next = responses.shift(); if (!next) throw new Error(`unexpected CLI call ${args.join(' ')}`); return next; };
  const log = { info: m => logs.push(['info', m]), warning: m => logs.push(['warning', m]), error: m => logs.push(['error', m]),
    command: (c, p, m) => logs.push([c, p.title, m]) };
  const run = () => runGate({ env, runCli, setOutput: (k, v) => { outputs[k] = v; }, log, appendSummary: s => summaries.push(s),
    readText: () => '# Executive Summary\n', exists: () => true });
  return { run, calls, outputs, logs, summaries };
}

const ok = value => ({ status: 0, stdout: `${JSON.stringify(value)}\n`, stderr: '' });
const decision = (outcome, over = {}) => ok({ evaluation: { id: 'gate_1' }, decision: { outcome, mode: 'full', blocking: [], warnings: [], waived: [], notExecutedCategories: [], degraded: false, ...over } });
const BLOCK = { findingId: 'fnd_1', fingerprint: 'fp', severity: 'critical', category: 'authz', rule: 'block_on[0] severity=critical',
  evidence: [{ id: 'ev_1', class: 'http_replay' }], sourceLocation: { file: 'src/a.ts', enclosingSymbol: 'A.find', verified: true } };

test('FAIL exits 1 with outputs, a cited block, and the report in the job summary', async () => {
  const h = harness([ok({ id: 'aud_1', status: 'completed' }), decision('fail', { blocking: [BLOCK] }), { status: 0, stdout: 'wrote 4 files', stderr: '' }]);
  assert.equal(await h.run(), 1);
  assert.deepEqual(h.calls[0], ['audit', 'start', '--project', 'acme', '--mode', 'security', '--commit', 'a'.repeat(40), '--wait', '--json']);
  assert.deepEqual(h.calls[1], ['gate', 'evaluate', '--audit', 'aud_1', '--json']);
  assert.deepEqual(h.calls[2], ['report', 'get', '--audit', 'aud_1', '--out', 'kase-report']);
  assert.deepEqual(h.outputs, { 'audit-id': 'aud_1', 'audit-status': 'completed', 'report-url': 'https://kase.test/api/v1/audits/aud_1/report?format=markdown',
    outcome: 'fail', 'blocking-count': '1', 'critical-count': '1', degraded: 'false', 'report-dir': 'kase-report' });
  const block = h.logs.find(l => l[0] === 'error');
  assert.equal(block[1], 'Kase blocks: critical authz');
  assert.match(block[2], /fnd_1 — block_on\[0\] severity=critical — evidence ev_1\(http_replay\) — src\/a\.ts A\.find/u);
  assert.deepEqual(h.summaries, ['# Executive Summary\n']);
  assert.ok(!h.calls.flat().includes('tok_secret'), 'the token never appears in CLI arguments');
});

test('PASS exits 0; PARTIAL exits 2 by default and 0 when fail-on is fail only', async () => {
  assert.equal(await harness([ok({ id: 'aud_1' }), decision('pass'), ok({})]).run(), 0);
  const partial = harness([ok({ id: 'aud_1', status: 'partial' }), decision('partial', { degraded: true }), ok({})]);
  assert.equal(await partial.run(), 2);
  assert.equal(partial.outputs.degraded, 'true');
  assert.ok(partial.logs.some(l => l[0] === 'warning' && /PARTIAL is never a pass/u.test(l[1])));
  assert.equal(await harness([ok({ id: 'aud_1' }), decision('partial'), ok({})], { ...ENV, KASE_FAIL_ON: 'fail' }).run(), 0);
  assert.equal(await harness([ok({ id: 'aud_1' }), decision('fail'), ok({})], { ...ENV, KASE_FAIL_ON: 'none' }).run(), 0);
});

test('fails closed when the audit cannot start or the gate cannot be read', async () => {
  const noStart = harness([{ status: 3, stdout: '', stderr: 'Target host "x" is not allowlisted\n' }]);
  assert.equal(await noStart.run(), 3);
  assert.match(noStart.logs.find(l => l[0] === 'error')[1], /not allowlisted/u);
  const noGate = harness([ok({ id: 'aud_1' }), { status: 0, stdout: 'not json', stderr: '' }]);
  assert.equal(await noGate.run(), 5);
  const badOutcome = harness([ok({ id: 'aud_1' }), decision('maybe')]);
  assert.equal(await badOutcome.run(), 5);
});

test('warns loudly when no commit is supplied, and passes target and categories through', async () => {
  const h = harness([ok({ id: 'aud_1' }), decision('pass')], { ...ENV, KASE_COMMIT: '', KASE_REPORT_DIR: '', KASE_MODE: 'full', KASE_TARGET: 'staging', KASE_CATEGORIES: 'sast,http' });
  assert.equal(await h.run(), 0);
  assert.ok(h.logs.some(l => l[0] === 'warning' && /provenance falls back to "assumed"/u.test(l[1])));
  assert.deepEqual(h.calls[0], ['audit', 'start', '--project', 'acme', '--target', 'staging', '--mode', 'full', '--categories', 'sast,http', '--wait', '--json']);
  assert.equal(h.calls.length, 2, 'no report call when report-dir is empty');
});

test('rejects missing inputs and an unknown fail-on value', async () => {
  assert.equal(await harness([], { KASE_PROJECT: 'acme' }).run(), 5);
  assert.equal(await harness([], { ...ENV, KASE_FAIL_ON: 'warn' }).run(), 5);
  assert.deepEqual([...parseFailOn('')], ['fail', 'partial']);
  assert.throws(() => parseFailOn('fail,maybe'), /fail-on accepts/u);
});

test('a report failure warns but does not change the gate exit code', async () => {
  const h = harness([ok({ id: 'aud_1' }), decision('pass'), { status: 5, stdout: '', stderr: 'boom' }]);
  assert.equal(await h.run(), 0);
  assert.ok(h.logs.some(l => l[0] === 'warning' && /report could not be written/u.test(l[1])));
  assert.equal(h.outputs['report-dir'], undefined);
});

test('helpers: JSON line picking and workflow-command escaping', () => {
  assert.deepEqual(lastJson('progress\n{"id":"a"}\n'), { id: 'a' });
  assert.equal(lastJson('nothing'), null);
  assert.equal(escapeData('50%\n::error::x'), '50%25%0A::error::x');
  assert.equal(escapeProperty('a:b,c'), 'a%3Ab%2Cc');
});

test('entry point: spawns the CLI, writes GITHUB_OUTPUT and exits on the outcome', async () => {
  const { mkdtemp, readFile, rm, writeFile } = await import('node:fs/promises');
  const { spawnSync } = await import('node:child_process');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const dir = await mkdtemp(join(tmpdir(), 'kase-action-'));
  try {
    const cli = join(dir, 'fake-cli.cjs');
    await writeFile(cli, `
      const [group] = process.argv.slice(2);
      if (process.env.KASE_TOKEN !== 'tok_secret') { console.error('no token'); process.exit(4); }
      if (process.argv.includes('tok_secret')) process.exit(9);
      if (group === 'audit') { console.error('progress: running'); console.log(JSON.stringify({ id: 'aud_9', status: 'completed' })); }
      if (group === 'gate') { console.log(JSON.stringify({ decision: { outcome: 'fail', blocking: [{ findingId: 'f', severity: 'high', category: 'c', rule: 'r', evidence: [] }], degraded: false } })); process.exit(1); }
    `);
    const output = join(dir, 'out.txt');
    await writeFile(output, '');
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./run.mjs', import.meta.url))], {
      env: { ...process.env, ...ENV, KASE_REPORT_DIR: '', KASE_CLI_PATH: cli, GITHUB_OUTPUT: output, GITHUB_STEP_SUMMARY: '' }, encoding: 'utf8',
    });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stderr, /progress: running/u);
    assert.match(result.stdout, /::error title=Kase blocks%3A high c::f — r/u);
    const written = await readFile(output, 'utf8');
    assert.match(written, /^audit-id=aud_9$/mu);
    assert.match(written, /^outcome=fail$/mu);
    assert.match(written, /^blocking-count=1$/mu);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
