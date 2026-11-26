import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createFixtureServer, extractEvidenceId, responsePlan, sseEvents } from './m4-provider-fixture.mjs';
import { fixController, isolateCompose, REAL_PROVIDERS } from './m4-compose-driver.mjs';

const wrapped = id => `<UNTRUSTED_DATA>\n${JSON.stringify({ success: true, data: { evidenceIds: [id] } })}\n</UNTRUSTED_DATA>`;

test('fixture performs two real HTTP probes before creating and finishing a finding', () => {
  const first = responsePlan({ input: [] });
  const second = responsePlan({ input: [{ type: 'function_call_output', output: wrapped('ev_one') }] });
  const finding = responsePlan({ input: [{ type: 'function_call_output', output: wrapped('ev_one') }, { type: 'function_call_output', output: wrapped('ev_two') }] });
  const finish = responsePlan({ input: [1, 2, 3].map(i => ({ type: 'function_call_output', output: wrapped(`ev_${i}`) })) });
  assert.equal(first.name, 'run_http_probe');
  assert.equal(second.name, 'run_http_probe');
  assert.deepEqual(finding.arguments.evidenceIds, ['ev_two']);
  assert.equal(finding.name, 'create_finding');
  assert.equal(finish.name, 'finish_audit');
});

test('fixture parses only structured tool result evidence and emits a complete tool-call stream', () => {
  assert.equal(extractEvidenceId(wrapped('ev_safe')), 'ev_safe');
  assert.equal(extractEvidenceId('not json'), undefined);
  const events = sseEvents({ name: 'finish_audit', arguments: { summary: 'done' } }, 3);
  assert.equal(events[0].item.name, 'finish_audit');
  assert.equal(events.at(-1).type, 'response.completed');
  assert.equal(events.at(-1).response.usage.output_tokens, 17);
});

test('generated topology keeps the agent off target and provider networks', () => {
  const names = ['postgres', 'redis', 'minio', 'minio-init', 'fixture', 'egress-proxy', 'migrate', 'api', 'worker-recon'];
  const services = Object.fromEntries(names.map(name => [name, {}]));
  services['agent-egress-proxy'] = { volumes: [{ source: 'old', target: '/etc/squid/allowed-hosts.txt' }] };
  services['worker-agent-main'] = { environment: {}, depends_on: { migrate: {}, 'sast-checkout-init': {} }, networks: { 'kase-core': null, 'agent-egress': null }, volumes: [{}] };
  services.scheduler = { environment: {} };
  services['worker-agent-check'] = {};
  const compose = isolateCompose({ services, networks: { 'kase-core': { internal: true }, 'api-host': {}, 'recon-egress': { internal: true }, 'agent-egress': { internal: true }, 'target-net': { internal: true }, 'agent-egress-upstream': {} }, volumes: {} }, { testIdentityId: 'tid_fixture', providerFixture: 'fixture.mjs', allowFile: 'allow.txt' });
  assert.deepEqual(Object.keys(compose.services['worker-agent-main'].networks).sort(), ['agent-egress', 'kase-core']);
  assert.deepEqual(Object.keys(compose.services['provider-fixture'].networks), ['agent-provider-upstream']);
  assert.deepEqual(Object.keys(compose.services['agent-egress-proxy'].networks).sort(), ['agent-egress', 'agent-provider-upstream']);
  assert.equal(compose.networks['agent-provider-upstream'].internal, true);
  assert.equal(compose.services['worker-agent-main'].depends_on['sast-checkout-init'], undefined);
  assert.equal(compose.services.api.ports[0].host_ip, '127.0.0.1');
});

function sourceCompose() {
  const names = ['postgres', 'redis', 'minio', 'minio-init', 'egress-proxy', 'migrate', 'api', 'worker-recon'];
  const services = Object.fromEntries(names.map(name => [name, {}]));
  services.fixture = { volumes: [] };
  services['agent-egress-proxy'] = { volumes: [{ source: 'old', target: '/etc/squid/allowed-hosts.txt' }], networks: { 'agent-egress': null, 'agent-egress-upstream': null } };
  services['worker-agent-main'] = { environment: { HTTPS_PROXY: 'http://agent-egress-proxy:3128' }, depends_on: { migrate: {} }, networks: { 'kase-core': null, 'agent-egress': null }, volumes: [{}] };
  services.scheduler = { environment: {} };
  services['worker-agent-check'] = {};
  return { services, networks: { 'kase-core': { internal: true }, 'api-host': {}, 'recon-egress': { internal: true }, 'agent-egress': { internal: true }, 'target-net': { internal: true }, 'agent-egress-upstream': {} }, volumes: {} };
}

test('real-provider topology allowlists only the provider host and never writes the API key', () => {
  const real = { ...REAL_PROVIDERS.gemini, name: 'gemini', modelId: 'gemini-4-carbon' };
  const compose = isolateCompose(sourceCompose(), { testIdentityId: 'tid', providerFixture: 'f.mjs', allowFile: 'allow.txt', real });
  assert.equal(compose.services['provider-fixture'], undefined);
  assert.equal(compose.networks['agent-provider-upstream'], undefined);
  assert.ok(compose.networks['agent-egress-upstream']);
  assert.deepEqual(Object.keys(compose.services['worker-agent-main'].networks).sort(), ['agent-egress', 'kase-core']);
  assert.deepEqual(Object.keys(compose.services['agent-egress-proxy'].networks).sort(), ['agent-egress', 'agent-egress-upstream']);
  const env = compose.services['worker-agent-main'].environment;
  assert.equal(env.KASE_AGENT_ROUTER_HOSTS, 'generativelanguage.googleapis.com');
  assert.equal(env.KASE_GEMINI_BASE_URL, 'https://generativelanguage.googleapis.com');
  assert.equal(env.KASE_PLATFORM_AI_PROVIDERS, 'gemini');
  assert.equal(env.NODE_USE_ENV_PROXY, '1');
  assert.equal(env.GEMINI_API_KEY, null, 'key is passed through by name, never by value');
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.match(compose.services['worker-agent-check'].command[2], /generativelanguage\.googleapis\.com/u);
});

test('negative control mounts the remediated controller read-only over the fixture source', () => {
  const compose = isolateCompose(sourceCompose(), { testIdentityId: 'tid', providerFixture: 'f.mjs', allowFile: 'allow.txt', fixedController: 'fixed.ts' });
  const mount = compose.services.fixture.volumes.at(-1);
  assert.equal(mount.target, '/workspace/fixtures/vulnerable-app/invoices/invoice.controller.ts');
  assert.equal(mount.read_only, true);
  const original = readFileSync(new URL('../fixtures/vulnerable-app/invoices/invoice.controller.ts', import.meta.url), 'utf8');
  const fixed = fixController(original);
  assert.match(fixed, /this\.invoiceService\.findScoped\(id, requesterId\)/u);
  assert.doesNotMatch(fixed, /this\.invoiceService\.find\(id, requesterId\)/u);
  assert.throws(() => fixController('no target here'), /patch target not found/u);
});

async function withFixture(fn) {
  const server = createFixtureServer();
  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise));
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await fn(base); } finally { server.closeAllConnections(); await new Promise(resolvePromise => server.close(resolvePromise)); }
}
const providerCall = (base, signal) => fetch(`${base}/v1/responses`, { method: 'POST', signal, headers: { authorization: 'Bearer fixture-only', 'content-type': 'application/json' }, body: JSON.stringify({ input: [] }) });
const state = async base => (await fetch(`${base}/control/state`)).json();

test('hold control stalls exactly one provider turn until released', async () => {
  await withFixture(async base => {
    await fetch(`${base}/control/hold`, { method: 'POST' });
    const pending = providerCall(base).then(r => r.text());
    for (let i = 0; i < 50 && (await state(base)).held < 1; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal((await state(base)).held, 1);
    await fetch(`${base}/control/release`, { method: 'POST' });
    const body = await pending;
    assert.match(body, /response\.completed/u);
    assert.match(await (await providerCall(base)).text(), /response\.completed/u, 'hold is one-shot');
    assert.deepEqual(await state(base), { armed: false, held: 1, aborted: 0, released: 1 });
  });
});

test('hold control records a client that disconnects mid-turn as aborted', async () => {
  await withFixture(async base => {
    await fetch(`${base}/control/hold`, { method: 'POST' });
    const controller = new AbortController();
    const response = await providerCall(base, controller.signal);
    const reader = response.body.getReader();
    await reader.read();
    controller.abort();
    for (let i = 0; i < 50 && (await state(base)).aborted < 1; i++) await new Promise(r => setTimeout(r, 20));
    assert.equal((await state(base)).aborted, 1);
  });
});
