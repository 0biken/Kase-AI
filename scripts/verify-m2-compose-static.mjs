import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const [compose, dockerfile, proof] = await Promise.all([
  readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8'),
  readFile(new URL('../workers/Dockerfile', import.meta.url), 'utf8'),
  readFile(new URL('./m2-compose-proof.ps1', import.meta.url), 'utf8').catch(() => ''),
]);

for (const service of ['scheduler', 'sast-checkout-init', 'worker-sast', 'worker-recon', 'worker-retention']) {
  assert.match(compose, new RegExp(`^  ${service}:`, 'mu'), `missing Compose service ${service}`);
}
assert.match(compose, /scheduler-main\.js/u);
assert.match(compose, /sast-worker-main\.js/u);
assert.match(compose, /retention-worker-main\.js/u);
assert.match(compose, /target: worker-sast/u);
assert.match(dockerfile, /semgrep==1\.175\.0/u);
assert.match(dockerfile, /COPY --from=builder[^\n]+\/workspace\/rules \.\/rules/u);
assert.match(compose, /\.\/\.m2-proof\/repository:\/proof-repository:ro/u);
assert.match(compose, /sast-checkouts:\/workspace\/\.kase-checkouts/u);
assert.match(serviceBlock(compose, 'sast-checkout-init'), /chown 10001:10001 \/workspace\/\.kase-checkouts/u);
assert.match(serviceBlock(compose, 'worker-sast'), /sast-checkout-init:\s*\r?\n\s*condition: service_completed_successfully/u);
assert.match(compose, /KASE_ALLOW_LOCAL_REPOSITORIES: "true"/u);
assert.match(compose, /KASE_SAST_RULE_PACK_SHA256:/u);

const sast = serviceBlock(compose, 'worker-sast');
for (const control of ['user: "10001:10001"', 'read_only: true', 'cap_drop:', 'no-new-privileges:true']) {
  assert.ok(sast.includes(control), `worker-sast missing ${control}`);
}
assert.ok(!sast.includes('recon-egress'), 'SAST worker must not join the recon egress network');
assert.ok(!sast.includes('target-net'), 'SAST worker must not join the target network');
assert.match(sast, /networks:\s*\r?\n\s*- kase-core/u);

for (const service of ['scheduler', 'worker-retention']) {
  const block = serviceBlock(compose, service);
  assert.ok(block.includes('user: "10001:10001"'));
  assert.ok(block.includes('read_only: true'));
  assert.ok(block.includes('no-new-privileges:true'));
  assert.match(block, /networks:\s*\r?\n\s*- kase-core/u);
}

assert.ok(proof.length > 0, 'scripts/m2-compose-proof.ps1 is missing');
for (const marker of ['M2 proof passed:', 'worker-sast', 'worker-retention', 'scheduler']) {
  assert.ok(proof.includes(marker), `live proof missing ${marker}`);
}

console.log('KASE_M2_COMPOSE_STATIC_VERIFIED');

function serviceBlock(source, name) {
  const start = source.search(new RegExp(`^  ${name}:`, 'mu'));
  assert.notEqual(start, -1, `service ${name} not found`);
  const remainder = source.slice(start + 1);
  const next = remainder.search(/^  [a-z0-9][a-z0-9-]*:/mu);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}
