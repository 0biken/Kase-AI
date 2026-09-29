import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const { newId } = require('../packages/db/ids.js');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const keepStack = process.argv.includes('--keep-stack');
const skipBuild = process.argv.includes('--skip-build');
const configOnly = process.argv.includes('--config-only');
const project = `kase-m4-${randomBytes(5).toString('hex')}`;
const runRoot = resolve(root, '.m4-proof/compose', project);
const composeFile = resolve(runRoot, 'compose.json');
const envFile = resolve(runRoot, 'proof.env');
const allowFile = resolve(runRoot, 'agent-allowed-hosts.txt');
mkdirSync(runRoot, { recursive: true });

const kek = randomBytes(32).toString('base64');
writeFileSync(envFile, `KASE_LOCAL_KEK=${kek}\nKASE_JOB_LEASE_MS=5000\nKASE_JOB_HEARTBEAT_MS=1000\nKASE_BULL_LOCK_DURATION_MS=5000\nKASE_BULL_STALLED_INTERVAL_MS=1000\nKASE_SCHEDULER_RECOVERY_MS=1000\n`);
writeFileSync(allowFile, 'provider-fixture\n');

function run(exe, args, options = {}) {
  const result = spawnSync(exe, args, { cwd: root, encoding: 'utf8', stdio: options.capture ? 'pipe' : 'inherit', input: options.input, env: options.env ?? process.env });
  if (result.status !== 0) throw new Error(`${exe} ${args.slice(0, 3).join(' ')} failed${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
  return (result.stdout ?? '').trim();
}
const dc = (args, options = {}) => run('docker', ['compose', '--env-file', envFile, '-p', project, '-f', composeFile, ...args], { capture: true, ...options });

export function isolateCompose(source, paths) {
  const selected = ['postgres', 'redis', 'minio', 'minio-init', 'fixture', 'egress-proxy', 'agent-egress-proxy', 'migrate', 'api', 'worker-recon', 'worker-agent-main', 'scheduler', 'worker-agent-check'];
  const services = Object.fromEntries(selected.map(name => [name, structuredClone(source.services[name])]).filter(([, value]) => value));
  for (const service of Object.values(services)) delete service.ports;
  services.api.ports = [{ mode: 'ingress', target: 3000, published: '0', host_ip: '127.0.0.1', protocol: 'tcp' }];
  services['provider-fixture'] = {
    image: 'node:22-alpine', command: ['node', '/proof/m4-provider-fixture.mjs'],
    environment: { PORT: '4010', TEST_IDENTITY_ID: paths.testIdentityId, PROBE_URL: 'http://fixture:3000/api/invoices/inv_1001' },
    volumes: [{ type: 'bind', source: paths.providerFixture, target: '/proof/m4-provider-fixture.mjs', read_only: true, bind: { create_host_path: false } }],
    networks: { 'agent-provider-upstream': null },
    healthcheck: { test: ['CMD', 'node', '-e', "fetch('http://127.0.0.1:4010/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"], interval: '1s', timeout: '3s', retries: 60 },
  };
  const agentProxy = services['agent-egress-proxy'];
  agentProxy.networks = { 'agent-egress': null, 'agent-provider-upstream': null };
  agentProxy.volumes = agentProxy.volumes.map(volume => volume.target === '/etc/squid/allowed-hosts.txt' ? { ...volume, source: paths.allowFile } : volume);
  const agent = services['worker-agent-main'];
  agent.environment = { ...agent.environment, OPENAI_API_KEY: 'fixture-only', KASE_PLATFORM_AI_PROVIDERS: 'openai', KASE_OPENAI_BASE_URL: 'http://provider-fixture:4010/v1', KASE_AGENT_ROUTER_HOSTS: 'provider-fixture', KASE_JOB_LEASE_MS: '5000', KASE_JOB_HEARTBEAT_MS: '1000', KASE_BULL_LOCK_DURATION_MS: '5000', KASE_BULL_STALLED_INTERVAL_MS: '1000' };
  agent.depends_on = Object.fromEntries(Object.entries(agent.depends_on ?? {}).filter(([name]) => name !== 'sast-checkout-init'));
  delete agent.volumes;
  services.scheduler.environment = { ...services.scheduler.environment, KASE_JOB_LEASE_MS: '5000', KASE_SCHEDULER_RECOVERY_MS: '1000' };
  services['worker-agent-check'].profiles = ['security-check'];
  services['worker-agent-check'].networks = { 'kase-core': null, 'agent-egress': null };
  services['worker-agent-check'].command = ['sh', '-ec', 'curl -fsS --max-time 5 --proxy http://agent-egress-proxy:3128 http://provider-fixture:4010/healthz >/dev/null; ! curl -fsS --max-time 3 http://provider-fixture:4010/healthz; ! curl -fsS --max-time 3 --proxy http://agent-egress-proxy:3128 http://fixture:3000/healthz'];
  services['replay-check'] = {
    ...structuredClone(services['worker-agent-check']), profiles: ['replay-check'],
    networks: { 'recon-egress': null },
    command: ['sh', '-ec', "curl -fsS --max-time 5 --proxy http://egress-proxy:3128 -H 'Authorization: Bearer tok_bob' http://fixture:3000/api/invoices/inv_1001 | grep -q user_alice"],
  };
  for (const service of Object.values(services)) {
    if (service.depends_on) service.depends_on = Object.fromEntries(Object.entries(service.depends_on).filter(([name]) => services[name]));
  }
  const networks = Object.fromEntries(Object.entries(source.networks).filter(([name]) => ['kase-core', 'api-host', 'recon-egress', 'agent-egress', 'target-net'].includes(name)));
  networks['agent-provider-upstream'] = { internal: true };
  return { name: project, services, networks, volumes: source.volumes };
}

function renderCompose(testIdentityId) {
  const base = resolve(root, 'docker-compose.yml');
  const rendered = run('docker', ['compose', '--env-file', envFile, '--profile', 'security-check', '-f', base, 'config', '--format', 'json'], { capture: true });
  const isolated = isolateCompose(JSON.parse(rendered), { testIdentityId, providerFixture: resolve(root, 'scripts/m4-provider-fixture.mjs'), allowFile });
  writeFileSync(composeFile, JSON.stringify(isolated, null, 2) + '\n');
  run('docker', ['compose', '--env-file', envFile, '-p', project, '-f', composeFile, 'config', '--quiet'], { capture: true });
}

function sql(statement) {
  return dc(['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-At', '-U', 'kase', '-d', 'kase'], { input: statement });
}

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

async function main() {
  const ids = {
    organization: newId('organization'), project: newId('project'), gate: newId('gatePolicy'), target: newId('target'),
    scope: newId('scopePolicy'), token: newId('apiToken'), identity: newId('testIdentity'), audit: newId('audit'), job: newId('auditJob'),
  };
  renderCompose(ids.identity);
  if (configOnly) { console.log(`M4 isolated Compose config valid: ${composeFile}`); return; }
  const startedAt = new Date().toISOString();
  try {
    run('docker', ['version', '--format', '{{json .Server.Version}}'], { capture: true });
    dc(['up', ...(skipBuild ? [] : ['--build']), '-d', '--wait', 'postgres', 'redis', 'minio', 'minio-init', 'fixture', 'egress-proxy', 'provider-fixture', 'agent-egress-proxy', 'migrate', 'api', 'scheduler', 'worker-recon', 'worker-agent-main'], { capture: false });
    const port = dc(['port', 'api', '3000']).match(/:(\d+)$/u)?.[1];
    if (!port) throw new Error('Could not resolve the isolated API port');
    const api = `http://127.0.0.1:${port}`;
    await waitFor('API readiness', async () => { const response = await fetch(`${api}/projects`); return response.status === 401; });
    const plaintext = `kase_${randomBytes(30).toString('base64url')}`;
    const tokenHash = createHash('sha256').update(plaintext).digest('hex');
    const suffix = ids.project.slice(-10).toLowerCase();
    sql(`
INSERT INTO "Organization" ("id","name","slug") VALUES ('${ids.organization}','M4 Compose Proof','m4-${suffix}');
INSERT INTO "Project" ("id","organizationId","name","slug","defaultGatePolicyId") VALUES ('${ids.project}','${ids.organization}','M4 Compose Proof','m4-${suffix}','${ids.gate}');
INSERT INTO "GatePolicy" ("id","projectId","version","name","rules") VALUES ('${ids.gate}','${ids.project}',1,'default','{"blockOn":{"requiresReplayableEvidence":true}}');
INSERT INTO "Target" ("id","projectId","name","baseUrl","environment","authMode") VALUES ('${ids.target}','${ids.project}','fixture','http://fixture:3000','local','header');
INSERT INTO "ScopePolicy" ("id","projectId","allowedHosts","deniedPaths","maxRequestsPerSecond","maxRequestsPerAudit","destructiveAllowed","authorizationAttestedBy","authorizationAttestedAt") VALUES ('${ids.scope}','${ids.project}',ARRAY['fixture'],ARRAY['/admin'],10,20,false,'m4-proof',CURRENT_TIMESTAMP);
INSERT INTO "ApiToken" ("id","projectId","name","tokenHash","displayPrefix","role","createdBy") VALUES ('${ids.token}','${ids.project}','M4 proof','${tokenHash}','${plaintext.slice(0, 8)}','admin','m4-proof');`);
    const secretResponse = await fetch(`${api}/projects/${ids.project}/secrets`, { method: 'POST', headers: { authorization: `Bearer ${plaintext}`, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'bob-fixture', kind: 'target_header', value: 'Authorization: Bearer tok_bob' }) });
    if (!secretResponse.ok) throw new Error(`Secret creation failed with ${secretResponse.status}`);
    const secret = await secretResponse.json();
    const manifestRaw = readFileSync(resolve(root, 'methodology/v1/manifest.json'));
    const manifest = JSON.parse(manifestRaw.toString('utf8'));
    const digest = createHash('sha256').update(manifestRaw).digest('hex');
    sql(`
INSERT INTO "TestIdentity" ("id","projectId","targetId","label","credentialSecretId","createdBy") VALUES ('${ids.identity}','${ids.project}','${ids.target}','bob','${secret.id}','m4-proof');
INSERT INTO "Audit" ("id","projectId","targetId","mode","status","degradationReasons","requestedCategories","executedCategories","notExecutedCategories") VALUES ('${ids.audit}','${ids.project}','${ids.target}','security','queued',ARRAY[]::TEXT[],ARRAY['blackbox'],ARRAY[]::TEXT[],'[]');
INSERT INTO "ReconRequestBudget" ("auditId","maxRequests","reconLimit") VALUES ('${ids.audit}',20,0);
INSERT INTO "AuditAiSnapshot" ("auditId","provider","modelId","catalogRevision","modelContextLimit","modelOutputLimit","credentialMode","promptVersion","methodologyDigest","budgetTotalTokens","budgetMaxCalls","budgetMaxContextBytes","budgetMaxOutputTokens","budgetBlackboxTokens","budgetBlackboxCalls","budgetWhiteboxTokens","budgetWhiteboxCalls") VALUES ('${ids.audit}','openai','fixture-model',1,200000,4096,'platform','${manifest.kasePromptVersion}','${digest}',100000,12,500000,1024,100000,12,1000,1);
INSERT INTO "AuditAiBudget" ("auditId","totalTokensLimit","totalCallsLimit","contextBytesLimit","deadlineAt") VALUES ('${ids.audit}',100000,12,500000,CURRENT_TIMESTAMP + INTERVAL '5 minutes');
INSERT INTO "AuditJob" ("id","auditId","kind","status","dependsOn","timeoutMs","maxRetries","required") VALUES ('${ids.job}','${ids.audit}','blackbox_agent','queued',ARRAY[]::TEXT[],240000,2,true);`);
    const final = await waitFor('agent audit completion', () => {
      const row = sql(`SELECT "status" || '|' || "degraded"::text FROM "Audit" WHERE "id"='${ids.audit}';`);
      return /^(completed|partial|failed|cancelled)\|/u.test(row) ? row : undefined;
    }, 300000);
    if (final !== 'completed|false') throw new Error(`Audit ended unexpectedly: ${final}`);
    const result = sql(`SELECT
      (SELECT "status" FROM "AgentRun" WHERE "auditId"='${ids.audit}') || '|' ||
      (SELECT count(*) FROM "AgentToolInvocation" i JOIN "AgentRun" r ON r."id"=i."agentRunId" WHERE r."auditId"='${ids.audit}' AND i."capability"='run_http_probe' AND i."status"='delivered') || '|' ||
      (SELECT count(*) FROM "Finding" WHERE "auditId"='${ids.audit}') || '|' ||
      (SELECT count(*) FROM "Evidence" WHERE "auditId"='${ids.audit}' AND "type"='http_exchange' AND "replayable") || '|' ||
      (SELECT count(*) FROM "Evidence" WHERE "auditId"='${ids.audit}' AND "type"='agent_transcript') || '|' ||
      (SELECT count(*) FROM "AiUsage" WHERE "auditId"='${ids.audit}' AND "outcome"='success');`);
    const parts = result.split('|').map((value, index) => index ? Number(value) : value);
    if (parts[0] !== 'completed' || parts[1] !== 2 || parts[2] !== 1 || parts[3] < 1 || parts[4] < 1 || parts[5] < 4) throw new Error(`Persisted agent result is incomplete: ${result}`);
    dc(['--profile', 'security-check', 'run', '--rm', '--no-deps', 'worker-agent-check']);
    dc(['--profile', 'replay-check', 'run', '--rm', '--no-deps', 'replay-check']);
    const proof = { startedAt, finishedAt: new Date().toISOString(), project, revision: run('git', ['rev-parse', 'HEAD'], { capture: true }), auditId: ids.audit, assertions: { terminal: final, probeContinuations: parts[1], findings: parts[2], replayableHttpEvidence: parts[3], transcriptEvidence: parts[4], successfulProviderCalls: parts[5], agentProviderProxyPositive: true, agentTargetEgressNegative: true, independentHttpReplay: true }, passed: true, scope: 'G5 happy path, child continuation, evidence persistence, independent replay and network boundaries; crash recovery and cancellation remain separate required G5 scenarios; G6 is deferred' };
    writeFileSync(resolve(runRoot, 'evidence.json'), JSON.stringify(proof, null, 2) + '\n');
    console.log(`M4 Compose proof subset passed: audit=${ids.audit}, evidence=${resolve(runRoot, 'evidence.json')}`);
  } catch (error) {
    console.error(`M4 Compose proof incomplete: ${error.message}`);
    try { console.error(dc(['ps', '-a'])); console.error(dc(['logs', '--tail', '120', 'api', 'scheduler', 'worker-recon', 'worker-agent-main', 'provider-fixture'])); } catch {}
    process.exitCode = 1;
  } finally {
    if (!keepStack) { try { dc(['down', '--volumes', '--remove-orphans']); } catch {} }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
