import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), 'utf8');
const [schema, graph, queues, consumer, scope, normalizer, dockerfile, compose, tools, controller, migration, katana, httpx, proof] = await Promise.all([
  read('packages/db/schema.prisma'), read('apps/api/src/orchestrator/job-graph.ts'), read('apps/api/src/queue/queue.constants.ts'),
  read('apps/api/src/worker/recon-pipeline-consumer.service.ts'), read('apps/api/src/recon/recon-scope.service.ts'),
  read('apps/api/src/recon/endpoint-normalizer.ts'), read('workers/Dockerfile'), read('docker-compose.yml'),
  read('workers/tool-inventory.json'), read('apps/api/src/recon/inventory.controller.ts'),
  read('packages/db/migrations/20260906000000_m3_recon_inventory/migration.sql'),
  read('apps/api/src/adapters/recon/katana.adapter.ts'), read('apps/api/src/adapters/recon/httpx.adapter.ts'),
  read('scripts/m3-compose-proof.ps1'),
]);

for (const kind of ['katana_discover','scope_filter','httpx_verify','inventory_merge','inventory_drift']) {
  assert.match(graph, new RegExp(`kind: '${kind}'`, 'u'), `graph missing ${kind}`);
  assert.match(queues, new RegExp(`${kind}:`, 'u'), `queue mapping missing ${kind}`);
}
assert.ok(graph.indexOf("kind: 'katana_discover'") < graph.indexOf("kind: 'scope_filter'"));
assert.ok(graph.indexOf("kind: 'scope_filter'") < graph.indexOf("kind: 'httpx_verify'"));
assert.match(consumer, /Object\.keys\(payload\)\.sort/u);
assert.match(consumer, /ReconScopeService/u);
assert.match(consumer, /budget\.reserve/u);
assert.match(consumer, /hostLeases\.acquire/u);
assert.match(consumer, /KASE_EGRESS_PROXY is required/u);
assert.match(consumer, /parseHttpxJsonl\(await this\.evidence\.load/u);
assert.doesNotMatch(consumer, /openai|anthropic|model sdk/iu);
assert.match(scope, /credentials_forbidden/u);
assert.match(scope, /port_not_allowed/u);
assert.match(scope, /path_denied/u);
assert.match(normalizer, /UUID/u);
assert.match(normalizer, /ULID/u);
for (const model of ['ReconRequestBudget','EndpointInventory','Endpoint','EndpointDrift']) assert.match(schema, new RegExp(`model ${model}`, 'u'));
assert.match(schema, /@@unique\(\[inventoryId, method, pathTemplate\]\)/u);
assert.match(migration, /ReconRequestBudget_nonnegative_check/u);
const inventory = JSON.parse(tools);
assert.deepEqual(inventory.tools.map((tool) => `${tool.name}@${tool.version}`), ['katana@1.6.1','httpx@1.10.0']);
for (const tool of inventory.tools) {
  assert.match(tool.sha256, /^[a-f0-9]{64}$/u);
  assert.match(tool.source, /^https:\/\/github\.com\/projectdiscovery\//u);
  assert.match(tool.artifact, /^https:\/\/github\.com\/projectdiscovery\//u);
  assert.equal(tool.license, 'MIT');
}
assert.match(dockerfile, /echo "\$\{KATANA_SHA256\}  \/tmp\/katana\.zip" \| sha256sum -c -/u);
assert.match(dockerfile, /echo "\$\{HTTPX_SHA256\}  \/tmp\/httpx\.zip" \| sha256sum -c -/u);
assert.match(compose, /KASE_EGRESS_PROXY: http:\/\/egress-proxy:3128/u);
assert.doesNotMatch(katana, /-no-scope/u);
for (const flag of ['-jsonl','-duc','-display-out-scope','-max-domain-pages','-rl','-dr']) assert.ok(katana.includes(`'${flag}'`), `Katana adapter missing ${flag}`);
for (const flag of ['-json','-duc','-tech-detect','-rate-limit','-threads']) assert.ok(httpx.includes(`'${flag}'`), `httpx adapter missing ${flag}`);
assert.match(controller, /audits\/:auditId\/inventory/u);
for (const assertion of ['M3 recon proof passed:', 'worker.egress.denied', 'denied-count', 'EndpointDrift', 'ReconRequestBudget', 'cancel']) assert.ok(proof.includes(assertion), `M3 proof missing ${assertion}`);
console.log('KASE_M3_STATIC_VERIFIED');
