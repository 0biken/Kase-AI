import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { newId } = require('../packages/db/ids.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const keepStack = argv.includes('--keep-stack');
const skipBuild = argv.includes('--skip-build');
const configOnly = argv.includes('--config-only');
const realProviderName = argv.includes('--real-provider') ? argv[argv.indexOf('--real-provider') + 1] : undefined;

/**
 * Real-provider endpoints for G6. The provider's own API host is the "Agent Router": it is the only
 * entry in the agent Squid allowlist and in KASE_AGENT_ROUTER_HOSTS. API keys are passed through
 * from the driver's environment by name only and are never written to the generated compose file.
 */
export const REAL_PROVIDERS = {
  gemini: { host: 'generativelanguage.googleapis.com', baseUrl: 'https://generativelanguage.googleapis.com', keyEnv: 'GEMINI_API_KEY', baseUrlEnv: 'KASE_GEMINI_BASE_URL', modelEnv: 'KASE_M4_GEMINI_MODEL_ID' },
  anthropic: { host: 'api.anthropic.com', baseUrl: 'https://api.anthropic.com', keyEnv: 'ANTHROPIC_API_KEY', baseUrlEnv: 'KASE_ANTHROPIC_BASE_URL', modelEnv: 'KASE_M4_ANTHROPIC_MODEL_ID' },
  openai: { host: 'api.openai.com', baseUrl: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY', baseUrlEnv: 'KASE_OPENAI_BASE_URL', modelEnv: 'KASE_M4_OPENAI_MODEL_ID' },
};

/** The one-token remediation the correlation spike applies; used for the G6 negative control. */
export function fixController(source) {
  const patched = source.replace('this.invoiceService.find(id, requesterId)', 'this.invoiceService.findScoped(id, requesterId)');
  if (patched === source) throw new Error('Fixed-control patch target not found in invoice.controller.ts');
  return patched;
}

const project = `kase-m4-${realProviderName ? `g6-${realProviderName}-` : ''}${randomBytes(5).toString('hex')}`;
const runRoot = resolve(root, '.m4-proof/compose', project);
const composeFile = resolve(runRoot, 'compose.json');
const envFile = resolve(runRoot, 'proof.env');
const allowFile = resolve(runRoot, 'agent-allowed-hosts.txt');
const fixedControllerFile = resolve(runRoot, 'invoice.controller.fixed.ts');

function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { cwd: root, encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit', input: options.input, env: options.env ?? process.env });
  if (result.status !== 0) throw new Error(`${exe} ${args.slice(0, 3).join(' ')} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  return (result.stdout ?? '').trim();
}
const dc = (args, options = {}) => run('docker', ['compose', '--env-file', envFile, '-p', project, '-f', composeFile, ...args], { capture: true, ...options });

/**
 * paths.real: a REAL_PROVIDERS entry plus { name, modelId } for G6; omitted for the deterministic G5 fixture.
 * paths.fixedController: host path of a remediated controller to mount over the fixture's (G6 negative control).
 */
export function isolateCompose(source, paths) {
  const real = paths.real;
  const selected = ['postgres', 'redis', 'minio', 'minio-init', 'fixture', 'egress-proxy', 'agent-egress-proxy', 'migrate', 'api', 'worker-recon', 'worker-agent-main', 'scheduler', 'worker-agent-check'];
  const services = Object.fromEntries(selected.map(name => [name, structuredClone(source.services[name])]).filter(([, value]) => value));
  for (const service of Object.values(services)) delete service.ports;
  services.api.ports = [{ mode: 'ingress', target: 3000, published: '0', host_ip: '127.0.0.1', protocol: 'tcp' }];
  const agentProxy = services['agent-egress-proxy'];
  agentProxy.volumes = agentProxy.volumes.map(volume => volume.target === '/etc/squid/allowed-hosts.txt' ? { ...volume, source: paths.allowFile } : volume);
  const agent = services['worker-agent-main'];
  const timing = { KASE_JOB_LEASE_MS: '5000', KASE_JOB_HEARTBEAT_MS: '1000', KASE_BULL_LOCK_DURATION_MS: '5000', KASE_BULL_STALLED_INTERVAL_MS: '1000' };
  if (real) {
    // Upstream is the real internet via the agent proxy only; the agent itself stays on internal networks.
    agentProxy.networks = { 'agent-egress': null, 'agent-egress-upstream': null };
    agent.environment = { ...agent.environment, ...timing, KASE_PLATFORM_AI_PROVIDERS: real.name, [real.baseUrlEnv]: real.baseUrl,
      KASE_AGENT_ROUTER_HOSTS: real.host, [real.keyEnv]: null, NODE_USE_ENV_PROXY: '1' };
  } else {
    services['provider-fixture'] = {
      image: 'node:22-alpine', command: ['node', '/proof/m4-provider-fixture.mjs'],
      environment: { PORT: '4010', TEST_IDENTITY_ID: paths.testIdentityId, PROBE_URL: 'http://fixture:3000/api/invoices/inv_1001' },
      volumes: [{ type: 'bind', source: paths.providerFixture, target: '/proof/m4-provider-fixture.mjs', read_only: true, bind: { create_host_path: false } }],
      networks: { 'agent-provider-upstream': null },
      healthcheck: { test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:4010/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], interval: '1s', timeout: '3s', retries: 60 },
    };
    agentProxy.networks = { 'agent-egress': null, 'agent-provider-upstream': null };
    agent.environment = { ...agent.environment, ...timing, OPENAI_API_KEY: 'fixture-only', KASE_PLATFORM_AI_PROVIDERS: 'openai', KASE_OPENAI_BASE_URL: 'http://provider-fixture:4010/v1', KASE_AGENT_ROUTER_HOSTS: 'provider-fixture' };
  }
  agent.depends_on = Object.fromEntries(Object.entries(agent.depends_on ?? {}).filter(([name]) => name !== 'sast-checkout-init'));
  delete agent.volumes;
  if (paths.fixedController) {
    services.fixture.volumes = [...(services.fixture.volumes ?? []), { type: 'bind', source: paths.fixedController, target: '/workspace/fixtures/vulnerable-app/invoices/invoice.controller.ts', read_only: true, bind: { create_host_path: false } }];
  }
  services.scheduler.environment = { ...services.scheduler.environment, KASE_JOB_LEASE_MS: '5000', KASE_SCHEDULER_RECOVERY_MS: '1000' };
  services['worker-agent-check'].profiles = ['security-check'];
  services['worker-agent-check'].networks = { 'kase-core': null, 'agent-egress': null };
  services['worker-agent-check'].command = real
    ? ['sh', '-ec', `curl -sS -o /dev/null --max-time 10 --proxy http://agent-egress-proxy:3128 https://${real.host}/; ! curl -sS -o /dev/null --max-time 5 https://${real.host}/; ! curl -fsS --max-time 3 --proxy http://agent-egress-proxy:3128 http://fixture:3000/healthz`]
    : ['sh', '-ec', 'curl -fsS --max-time 5 --proxy http://agent-egress-proxy:3128 http://provider-fixture:4010/healthz >/dev/null; ! curl -fsS --max-time 3 http://provider-fixture:4010/healthz; ! curl -fsS --max-time 3 --proxy http://agent-egress-proxy:3128 http://fixture:3000/healthz'];
  services['replay-check'] = {
    ...structuredClone(services['worker-agent-check']), profiles: ['replay-check'],
    networks: { 'recon-egress': null },
    command: ['sh', '-ec', "curl -fsS --max-time 5 --proxy http://egress-proxy:3128 -H 'Authorization: Bearer tok_bob' http://fixture:3000/api/invoices/inv_1001 | grep -q user_alice"],
  };
  for (const service of Object.values(services)) {
    if (service.depends_on) service.depends_on = Object.fromEntries(Object.entries(service.depends_on).filter(([name]) => services[name]));
  }
  const keep = ['kase-core', 'api-host', 'recon-egress', 'agent-egress', 'target-net', ...(real ? ['agent-egress-upstream'] : [])];
  const networks = Object.fromEntries(Object.entries(source.networks).filter(([name]) => keep.includes(name)));
  if (!real) networks['agent-provider-upstream'] = { internal: true };
  return { name: project, services, networks, volumes: source.volumes };
}

function renderCompose(testIdentityId, real, fixed = false) {
  const base = resolve(root, 'docker-compose.yml');
  const rendered = run('docker', ['compose', '--env-file', envFile, '--profile', 'security-check', '-f', base, 'config', '--format', 'json'], { capture: true });
  const isolated = isolateCompose(JSON.parse(rendered), { testIdentityId, providerFixture: resolve(root, 'scripts/m4-provider-fixture.mjs'), allowFile, real, ...(fixed ? { fixedController: fixedControllerFile } : {}) });
  writeFileSync(composeFile, JSON.stringify(isolated, null, 2) + '\n');
  run('docker', ['compose', '--env-file', envFile, '-p', project, '-f', composeFile, 'config', '--quiet'], { capture: true });
}

const sql = statement => dc(['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-At', '-U', 'kase', '-d', 'kase'], { input: statement });
const fixtureControl = (path, method = 'GET') => JSON.parse(dc(['exec', '-T', 'provider-fixture', 'node', '-e',
  `fetch('http://127.0.0.1:4010${path}',{method:'${method}'}).then(r=>r.text()).then(t=>process.stdout.write(t))`]));

async function waitFor(description, probe, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    try { const value = await probe(); if (value) return value; }
    catch (error) { last = error; }
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1000));
  }
  throw new Error(`Timed out waiting for ${description}${last ? `: ${last.message}` : ''}`);
}
const terminal = (auditId, timeoutMs = 300000) => waitFor(`audit ${auditId} terminal state`, () => {
  const row = sql(`SELECT "status" || '|' || "degraded"::text FROM "Audit" WHERE "id"='${auditId}';`);
  return /^(completed|partial|failed|cancelled)\|/u.test(row) ? row : undefined;
}, timeoutMs);
const counts = queries => sql(`SELECT ${queries.map(q => `(${q})`).join(` || '|' || `)};`).split('|').map(Number);

/** Boots the isolated stack and seeds an organization, project, scope, admin token and the bob/alice identities. */
async function bootstrap(ids, real) {
  run('docker', ['version', '--format', '{{json .Server.Version}}'], { capture: true });
  const services = ['postgres', 'redis', 'minio', 'minio-init', 'fixture', 'egress-proxy', ...(real ? [] : ['provider-fixture']), 'agent-egress-proxy', 'migrate', 'api', 'scheduler', 'worker-recon', 'worker-agent-main'];
  dc(['up', ...(skipBuild ? [] : ['--build']), '-d', '--wait', ...services], { capture: false });
  const port = dc(['port', 'api', '3000']).match(/:(\d+)$/u)?.[1];
  if (!port) throw new Error('Could not resolve the isolated API port');
  const api = `http://127.0.0.1:${port}`;
  await waitFor('API readiness', async () => (await fetch(`${api}/projects`)).status === 401);
  const plaintext = `kase_${randomBytes(30).toString('base64url')}`;
  const tokenHash = createHash('sha256').update(plaintext).digest('hex');
  const suffix = ids.project.slice(-10).toLowerCase();
  sql(`
INSERT INTO "Organization" ("id","name","slug") VALUES ('${ids.organization}','M4 Compose Proof','m4-${suffix}');
INSERT INTO "Project" ("id","organizationId","name","slug","defaultGatePolicyId") VALUES ('${ids.project}','${ids.organization}','M4 Compose Proof','m4-${suffix}','${ids.gate}');
INSERT INTO "GatePolicy" ("id","projectId","version","name","rules") VALUES ('${ids.gate}','${ids.project}',1,'default','{"blockOn":{"requiresReplayableEvidence":true}}');
INSERT INTO "Target" ("id","projectId","name","baseUrl","environment","authMode") VALUES ('${ids.target}','${ids.project}','fixture','http://fixture:3000','local','header');
INSERT INTO "ScopePolicy" ("id","projectId","allowedHosts","deniedPaths","maxRequestsPerSecond","maxRequestsPerAudit","destructiveAllowed","authorizationAttestedBy","authorizationAttestedAt") VALUES ('${ids.scope}','${ids.project}',ARRAY['fixture'],ARRAY['/admin'],10,${real ? 200 : 20},false,'m4-proof',CURRENT_TIMESTAMP);
INSERT INTO "ApiToken" ("id","projectId","name","tokenHash","displayPrefix","role","createdBy") VALUES ('${ids.token}','${ids.project}','M4 proof','${tokenHash}','${plaintext.slice(0, 8)}','admin','m4-proof');`);
  const call = async (method, path, body, expected = [200, 201, 202]) => {
    const response = await fetch(`${api}${path}`, { method, headers: { authorization: `Bearer ${plaintext}`, 'content-type': 'application/json', 'idempotency-key': randomBytes(12).toString('hex') }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!expected.includes(response.status)) throw new Error(`${method} ${path} returned ${response.status}`);
    return response.status === 204 ? undefined : response.json().catch(() => undefined);
  };
  for (const [label, identityId, token] of [['bob', ids.identity, 'tok_bob'], ['alice', ids.identityAlice, 'tok_alice']]) {
    const secret = await call('POST', `/projects/${ids.project}/secrets`, { name: `${label}-fixture`, kind: 'target_header', value: `Authorization: Bearer ${token}` });
    sql(`INSERT INTO "TestIdentity" ("id","projectId","targetId","label","credentialSecretId","createdBy") VALUES ('${identityId}','${ids.project}','${ids.target}','${label}','${secret.id}','m4-proof');`);
  }
  return { api, call };
}

/** Inserts a blackbox-only audit wired to the deterministic provider fixture (G5). */
function insertFixtureAudit(ids) {
  const audit = newId('audit'), job = newId('auditJob');
  const manifestRaw = readFileSync(resolve(root, 'methodology/v1/manifest.json'));
  const manifest = JSON.parse(manifestRaw.toString('utf8'));
  const digest = createHash('sha256').update(manifestRaw).digest('hex');
  sql(`
INSERT INTO "Audit" ("id","projectId","targetId","mode","status","degradationReasons","requestedCategories","executedCategories","notExecutedCategories") VALUES ('${audit}','${ids.project}','${ids.target}','security','queued',ARRAY[]::TEXT[],ARRAY['blackbox'],ARRAY[]::TEXT[],'[]');
INSERT INTO "ReconRequestBudget" ("auditId","maxRequests","reconLimit") VALUES ('${audit}',20,0);
INSERT INTO "AuditAiSnapshot" ("auditId","provider","modelId","catalogRevision","modelContextLimit","modelOutputLimit","credentialMode","promptVersion","methodologyDigest","budgetTotalTokens","budgetMaxCalls","budgetMaxContextBytes","budgetMaxOutputTokens","budgetBlackboxTokens","budgetBlackboxCalls","budgetWhiteboxTokens","budgetWhiteboxCalls") VALUES ('${audit}','openai','fixture-model',1,200000,4096,'platform','${manifest.kasePromptVersion}','${digest}',100000,12,500000,1024,100000,12,1000,1);
INSERT INTO "AuditAiBudget" ("auditId","totalTokensLimit","totalCallsLimit","contextBytesLimit","deadlineAt") VALUES ('${audit}',100000,12,500000,CURRENT_TIMESTAMP + INTERVAL '5 minutes');
INSERT INTO "AuditJob" ("id","auditId","kind","status","dependsOn","timeoutMs","maxRetries","required") VALUES ('${job}','${audit}','blackbox_agent','queued',ARRAY[]::TEXT[],240000,2,true);`);
  return audit;
}

const agentFacts = audit => counts([
  `SELECT count(*) FROM "AgentToolInvocation" i JOIN "AgentRun" r ON r."id"=i."agentRunId" WHERE r."auditId"='${audit}' AND i."capability"='run_http_probe' AND i."status"='delivered'`,
  `SELECT count(*) FROM "Finding" WHERE "auditId"='${audit}'`,
  `SELECT count(*) FROM "Evidence" WHERE "auditId"='${audit}' AND "type"='http_exchange' AND "replayable"`,
  `SELECT count(*) FROM "Evidence" WHERE "auditId"='${audit}' AND "type"='agent_transcript'`,
  `SELECT count(*) FROM "AiUsage" WHERE "auditId"='${audit}' AND "outcome"='success'`,
  `SELECT count(*) FROM "AiBudgetReservation" WHERE "auditId"='${audit}' AND "status"='active'`,
  `SELECT count(*) FROM "AiBudgetReservation" WHERE "auditId"='${audit}' AND "status"='settled'`,
  `SELECT count(*) FROM "AiBudgetReservation" WHERE "auditId"='${audit}' AND "status"='expired'`,
]);
const factNames = ['probeContinuations', 'findings', 'replayableHttpEvidence', 'transcriptEvidence', 'successfulProviderCalls', 'activeReservations', 'settledReservations', 'expiredReservations'];
const named = facts => Object.fromEntries(factNames.map((name, i) => [name, facts[i]]));
function expect(condition, scenario, detail) { if (!condition) throw new Error(`${scenario} failed: ${JSON.stringify(detail)}`); }

/** G5: deterministic happy path, agent-worker crash recovery, and cancellation of an in-flight turn. */
async function runFixtureProof(ids, call) {
  const scenarios = {};

  const happy = insertFixtureAudit(ids);
  const happyFinal = await terminal(happy);
  const h = named(agentFacts(happy));
  expect(happyFinal === 'completed|false' && h.probeContinuations === 2 && h.findings === 1 && h.replayableHttpEvidence >= 1 && h.transcriptEvidence >= 1 && h.successfulProviderCalls >= 4 && h.activeReservations === 0, 'happy path', { happyFinal, ...h });
  dc(['--profile', 'security-check', 'run', '--rm', '--no-deps', 'worker-agent-check']);
  dc(['--profile', 'replay-check', 'run', '--rm', '--no-deps', 'replay-check']);
  scenarios.happyPath = { auditId: happy, terminal: happyFinal, ...h, agentProviderProxyPositive: true, agentTargetEgressNegative: true, independentHttpReplay: true };

  // Crash: kill the agent worker while a provider turn is in flight; lease recovery must resume from the checkpoint.
  fixtureControl('/control/hold', 'POST');
  const crash = insertFixtureAudit(ids);
  await waitFor('held provider turn (crash)', () => fixtureControl('/control/state').held >= 1);
  const abortedBefore = fixtureControl('/control/state').aborted;
  dc(['kill', 'worker-agent-main']);
  await waitFor('fixture to observe the killed connection', () => fixtureControl('/control/state').aborted > abortedBefore, 30000);
  dc(['up', '-d', '--no-deps', 'worker-agent-main']);
  const crashFinal = await terminal(crash);
  const c = named(agentFacts(crash));
  expect(crashFinal === 'completed|false' && c.findings === 1 && c.activeReservations === 0 && c.settledReservations === c.successfulProviderCalls && c.expiredReservations >= 1, 'crash recovery', { crashFinal, ...c });
  scenarios.crashRecovery = { auditId: crash, terminal: crashFinal, ...c };

  // Cancel: cancel through the API while a provider turn is in flight; the request must abort and nothing may settle.
  fixtureControl('/control/hold', 'POST');
  const cancel = insertFixtureAudit(ids);
  await waitFor('held provider turn (cancel)', () => fixtureControl('/control/state').held >= 2);
  const abortedBeforeCancel = fixtureControl('/control/state').aborted;
  await call('POST', `/audits/${cancel}/cancel`, undefined, [202]);
  await waitFor('provider request abort after cancel', () => fixtureControl('/control/state').aborted > abortedBeforeCancel, 60000);
  const cancelFinal = await terminal(cancel, 120000);
  const k = named(agentFacts(cancel));
  expect(cancelFinal.startsWith('cancelled|') && k.findings === 0 && k.activeReservations === 0 && k.settledReservations === 0 && k.successfulProviderCalls === 0, 'cancellation', { cancelFinal, ...k });
  scenarios.cancellation = { auditId: cancel, terminal: cancelFinal, ...k, providerRequestAborted: true };

  return { gate: 'G5', scenarios, scope: 'G5 happy path, child continuation, evidence persistence, independent replay, network boundaries, agent-worker crash recovery and in-flight cancellation; G6 is separate' };
}

/** G6 part B: one unaided audit against the vulnerable fixture, then the same model against the fixed fixture. */
async function runRealProof(ids, call, real) {
  const contextLimit = Number(process.env[`KASE_M4_${real.name.toUpperCase()}_CONTEXT_LIMIT`] ?? 200000);
  const outputLimit = Number(process.env[`KASE_M4_${real.name.toUpperCase()}_OUTPUT_LIMIT`] ?? 16000);
  sql(`INSERT INTO "ModelCatalogEntry" ("id","provider","modelId","catalogRevision","displayName","contextLimit","outputLimit","capabilities","status") VALUES ('${newId('modelCatalogEntry')}','${real.name}','${real.modelId}',1,'G6 proof model',${contextLimit},${outputLimit},ARRAY['streaming','tool_use'],'available');`);
  await call('PUT', `/projects/${ids.project}/ai-configuration`, { provider: real.name, modelId: real.modelId, catalogRevision: 1, credentialMode: 'platform', budgetMaxOutputTokens: Math.min(16000, outputLimit) });
  const audit = async () => {
    const created = await call('POST', `/projects/${ids.project}/audits`, { mode: 'full', targetId: ids.target, categories: ['blackbox'] });
    const auditId = created?.id ?? created?.auditId;
    if (!auditId) throw new Error('Audit creation did not return an id');
    const final = await terminal(auditId, 60 * 60_000);
    const [authorizationFindings, replayable, providerCalls] = counts([
      `SELECT count(*) FROM "Finding" WHERE "auditId"='${auditId}' AND "category"='authorization'`,
      `SELECT count(*) FROM "Evidence" WHERE "auditId"='${auditId}' AND "type"='http_exchange' AND "replayable"`,
      `SELECT count(*) FROM "AiUsage" WHERE "auditId"='${auditId}' AND "outcome"='success'`,
    ]);
    const usage = sql(`SELECT coalesce(sum("inputTokens"),0) || '|' || coalesce(sum("outputTokens"),0) || '|' || coalesce(sum("costUsd"),0) FROM "AiUsage" WHERE "auditId"='${auditId}';`).split('|');
    return { auditId, terminal: final, authorizationFindings, replayableHttpEvidence: replayable, successfulProviderCalls: providerCalls, inputTokens: Number(usage[0]), outputTokens: Number(usage[1]), costUsd: usage[2] };
  };
  // Exactly one bounded attempt per control: never re-run discovery to obtain a passing result.
  const vulnerable = await audit();
  expect(vulnerable.terminal.startsWith('completed|') && vulnerable.authorizationFindings >= 1 && vulnerable.replayableHttpEvidence >= 1, 'unaided seeded-IDOR discovery', vulnerable);
  dc(['--profile', 'security-check', 'run', '--rm', '--no-deps', 'worker-agent-check']);
  dc(['--profile', 'replay-check', 'run', '--rm', '--no-deps', 'replay-check']);

  writeFileSync(fixedControllerFile, fixController(readFileSync(resolve(root, 'fixtures/vulnerable-app/invoices/invoice.controller.ts'), 'utf8')));
  renderCompose(ids.identity, real, true);
  dc(['up', '-d', '--no-deps', '--force-recreate', '--wait', 'fixture'], { capture: false });
  const fixed = await audit();
  expect(fixed.terminal.startsWith('completed|') && fixed.authorizationFindings === 0, 'ownership-fixed negative control', fixed);

  return { gate: 'G6-B', provider: real.name, modelId: real.modelId, vulnerable: { ...vulnerable, independentHttpReplay: true, agentProviderProxyPositive: true, agentTargetEgressNegative: true }, fixed,
    scope: 'G6 part B for one provider: unaided seeded-IDOR audit and ownership-fixed negative control with the same pinned model, independent replay and network boundaries' };
}

async function main() {
  let real;
  if (realProviderName) {
    const entry = REAL_PROVIDERS[realProviderName];
    if (!entry) throw new Error(`--real-provider must be one of ${Object.keys(REAL_PROVIDERS).join(', ')}`);
    const modelId = process.env[entry.modelEnv] ?? (configOnly ? 'config-only-model' : undefined);
    if (!modelId) throw new Error(`G6 INCOMPLETE: set ${entry.modelEnv} to the exact pinned model ID`);
    if (!configOnly && !process.env[entry.keyEnv]) throw new Error(`G6 INCOMPLETE: set ${entry.keyEnv}`);
    real = { ...entry, name: realProviderName, modelId };
  }
  mkdirSync(runRoot, { recursive: true });
  writeFileSync(envFile, `KASE_LOCAL_KEK=${randomBytes(32).toString('base64')}\nKASE_JOB_LEASE_MS=5000\nKASE_JOB_HEARTBEAT_MS=1000\nKASE_BULL_LOCK_DURATION_MS=5000\nKASE_BULL_STALLED_INTERVAL_MS=1000\nKASE_SCHEDULER_RECOVERY_MS=1000\n`);
  writeFileSync(allowFile, `${real ? real.host : 'provider-fixture'}\n`);
  const ids = {
    organization: newId('organization'), project: newId('project'), gate: newId('gatePolicy'), target: newId('target'),
    scope: newId('scopePolicy'), token: newId('apiToken'), identity: newId('testIdentity'), identityAlice: newId('testIdentity'),
  };
  renderCompose(ids.identity, real);
  if (configOnly) { console.log(`M4 isolated Compose config valid (${real ? `real provider ${real.name}` : 'deterministic fixture'}): ${composeFile}`); return; }
  const startedAt = new Date().toISOString();
  try {
    const { call } = await bootstrap(ids, real);
    const result = real ? await runRealProof(ids, call, real) : await runFixtureProof(ids, call);
    const proof = { startedAt, finishedAt: new Date().toISOString(), project, revision: run('git', ['rev-parse', 'HEAD'], { capture: true }), ...result, passed: true };
    const evidence = resolve(runRoot, 'evidence.json');
    writeFileSync(evidence, JSON.stringify(proof, null, 2) + '\n');
    console.log(real ? `M4 G6 audit proof passed: provider=${real.name}, evidence=${evidence}` : `M4 agent proof passed: evidence=${evidence}`);
  } catch (error) {
    console.error(`M4 Compose proof incomplete: ${error.message}`);
    try { console.error(dc(['ps', '-a'])); console.error(dc(['logs', '--tail', '120', 'api', 'scheduler', 'worker-recon', 'worker-agent-main', ...(real ? [] : ['provider-fixture'])])); } catch {}
    process.exitCode = 1;
  } finally {
    if (!keepStack) { try { dc(['down', '--volumes', '--remove-orphans']); } catch {} }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { await main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
