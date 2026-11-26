import assert from 'node:assert/strict';
import test from 'node:test';
import { run } from './main';

const env = { KASE_TOKEN: 'test-token', KASE_API_URL: 'http://kase/api/v1' };

function response(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(typeof value === 'string' ? value : JSON.stringify(value), { status, headers });
}

function sequenceFetch(values: Response[]): typeof fetch & { calls: string[] } {
  const calls: string[] = [];
  const fn = (async (url: RequestInfo | URL) => { calls.push(String(url)); const value = values.shift(); if (!value) throw new Error('unexpected fetch'); return value; }) as typeof fetch & { calls: string[] };
  fn.calls = calls;
  return fn;
}

test('starts a security audit and emits exactly one JSON object', async () => {
    const fetcher = sequenceFetch([
      response([{ id: 'prj_1', slug: 'acme' }]), response([{ id: 'tgt_1', name: 'staging' }]),
      response([{ id: 'repo_1', url: 'https://example.test/acme.git' }]), response({ id: 'aud_1', status: 'queued' }),
    ]);
    const output: string[] = [];
    const code = await run(['audit', 'start', '--project', 'acme', '--target', 'staging', '--mode', 'security', '--json'], env, { out: (v) => output.push(v), err: () => undefined }, fetcher);
    assert.equal(code, 0);
    assert.equal(output.length, 1);
    assert.equal(JSON.parse(output[0]).id, 'aud_1');
  });

test('maps finding filters onto query parameters', async () => {
    const fetcher = sequenceFetch([response([{ id: 'fnd_1' }])]);
    const output: string[] = [];
    await run(['findings', 'list', '--audit', 'aud_1', '--severity', 'critical,high', '--gate-eligible', 'true', '--json'], env, { out: (v) => output.push(v), err: () => undefined }, fetcher);
    assert.match(fetcher.calls[0], /severity=critical%2Chigh/);
    assert.match(fetcher.calls[0], /gateEligible=true/);
    assert.equal(output.length, 1);
  });

test('rejects unsupported modes before dispatch', async () => {
    await assert.rejects(run(['audit', 'start', '--project', 'p', '--target', 't', '--mode', 'regression'], env, { out: () => undefined, err: () => undefined }, sequenceFetch([])), /smoke, security, or full/);
});

function gateDecision(outcome: 'pass' | 'fail' | 'partial', over: Record<string, unknown> = {}) {
  return { evaluation: { id: 'gate_1', outcome }, decision: { outcome, mode: 'full', blocking: [], warnings: [], waived: [], notExecutedCategories: [], degraded: false, ...over } };
}

test('gate evaluate exits 1 on FAIL and posts to the evaluate endpoint', async () => {
  const fetcher = sequenceFetch([response(gateDecision('fail', {
    blocking: [{ findingId: 'fnd_1', fingerprint: 'fp1', severity: 'critical', category: 'authz', rule: 'block_on[0] severity=critical', evidence: [{ id: 'ev1', class: 'http_replay', replayResult: 'reproduced' }], sourceLocation: { file: 's.ts', enclosingSymbol: 'S.find', verified: true } }],
  }))]);
  const output: string[] = [];
  const code = await run(['gate', 'evaluate', '--audit', 'aud_1'], env, { out: (v) => output.push(v), err: () => undefined }, fetcher);
  assert.equal(code, 1);
  assert.match(fetcher.calls[0], /\/audits\/aud_1\/gate\/evaluate$/);
  assert.match(output.join('\n'), /BLOCK critical authz fnd_1/);
  assert.match(output.join('\n'), /rule: block_on\[0\]/);
  assert.match(output.join('\n'), /source: s\.ts S\.find \(verified\)/);
});

test('gate evaluate exits 0 on PASS and 2 on PARTIAL', async () => {
  const pass = await run(['gate', 'evaluate', '--audit', 'aud_1', '--json'], env, { out: () => undefined, err: () => undefined }, sequenceFetch([response(gateDecision('pass'))]));
  assert.equal(pass, 0);
  const partial = await run(['gate', 'evaluate', '--audit', 'aud_1', '--json'], env, { out: () => undefined, err: () => undefined }, sequenceFetch([response(gateDecision('partial'))]));
  assert.equal(partial, 2);
});

test('gate show reads the latest evaluation', async () => {
  const fetcher = sequenceFetch([response({ id: 'gate_1', outcome: 'pass' })]);
  const output: string[] = [];
  const code = await run(['gate', 'show', '--audit', 'aud_1', '--json'], env, { out: (v) => output.push(v), err: () => undefined }, fetcher);
  assert.equal(code, 0);
  assert.match(fetcher.calls[0], /\/audits\/aud_1\/gate$/);
  assert.equal(JSON.parse(output[0]).outcome, 'pass');
});

test('imports security-audit findings.json to the flat audit import route', async () => {
    const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const dir = await mkdtemp(join(tmpdir(), 'kase-import-'));
    try {
      const file = join(dir, 'findings.json');
      await writeFile(file, JSON.stringify([{ verdict: 'rejected' }]));
      const bodies: string[] = [];
      const fetcher = (async (url: RequestInfo | URL, init?: RequestInit) => {
        bodies.push(`${String(url)} ${init?.method} ${init?.body}`);
        return response({ imported: 0, rejected: 1 });
      }) as typeof fetch;
      const output: string[] = [];
      const code = await run(['import', 'security-audit', '--audit', 'aud_1', file, '--json'], env, { out: (v) => output.push(v), err: () => undefined }, fetcher);
      assert.equal(code, 0);
      assert.equal(bodies[0], 'http://kase/api/v1/audits/aud_1/import/security-audit POST [{"verdict":"rejected"}]');
      assert.equal(JSON.parse(output[0]).rejected, 1);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });

test('import security-audit requires --audit and a file', async () => {
    await assert.rejects(run(['import', 'security-audit', '--audit', 'aud_1'], env, { out: () => undefined, err: () => undefined }, sequenceFetch([])), /Usage: kase import security-audit/);
  });
