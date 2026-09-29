import assert from 'node:assert/strict';
import { test } from 'node:test';
import { extractEvidenceId, responsePlan, sseEvents } from './m4-provider-fixture.mjs';
import { isolateCompose } from './m4-compose-driver.mjs';

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
