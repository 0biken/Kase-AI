import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const [compose, proof, apiPackage] = await Promise.all([
  readFile(new URL('../docker-compose.yml', import.meta.url), 'utf8'),
  readFile(new URL('./m2-compose-proof.ps1', import.meta.url), 'utf8'),
  readFile(new URL('../apps/api/package.json', import.meta.url), 'utf8'),
]);

const packageJson = JSON.parse(apiPackage);
const dependencyNames = Object.keys(packageJson.dependencies ?? {});
assert.deepEqual(
  dependencyNames.filter((name) => /(?:openai|anthropic|langchain|ollama|gemini)/iu.test(name)),
  [],
  'M2 API runtime includes an AI/model dependency',
);

const serviceList = proof.match(/\$services\s*=\s*@\(([^)]*)\)/su)?.[1] ?? '';
assert.ok(serviceList, 'proof must declare its explicit Compose service set');
assert.doesNotMatch(serviceList, /agent|blackbox|whitebox|model|llm/iu);
for (const required of ['scheduler', 'worker-sast', 'worker-recon', 'worker-retention']) {
  assert.match(serviceList, new RegExp(`['"]${required}['"]`, 'u'));
}

for (const service of ['scheduler', 'worker-sast', 'worker-retention']) {
  const block = serviceBlock(compose, service);
  assert.doesNotMatch(block, /agent|model|prompt|transcript|openai|anthropic/iu);
}
assert.doesNotMatch(proof, /docker compose[^\r\n]*(?:worker-agent|blackbox-agent|whitebox-agent)/iu);

console.log('KASE_M2_NO_AI_VERIFIED');

function serviceBlock(source, name) {
  const start = source.search(new RegExp(`^  ${name}:`, 'mu'));
  assert.notEqual(start, -1, `service ${name} not found`);
  const remainder = source.slice(start + 1);
  const next = remainder.search(/^  [a-z0-9][a-z0-9-]*:/mu);
  return next === -1 ? source.slice(start) : source.slice(start, start + 1 + next);
}
