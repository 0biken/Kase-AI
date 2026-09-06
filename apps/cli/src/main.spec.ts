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
