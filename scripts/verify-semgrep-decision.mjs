import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifestPath = path.join(root, 'rules', 'manifest.json');
const stackPath = path.join(root, 'docs', '02-stack', 'README.md');
const adaptersPath = path.join(root, 'docs', '07-tool-adapters', 'README.md');

const EXPECTED_PACK = 'kase/typescript-security';
const EXPECTED_VERSION = '1.0.0';
const EXPECTED_RULE = 'kase.idor.missing-ownership-predicate';
const FORBIDDEN_TEXT = [
  /(?:^|[\s"'])p\/[a-z0-9_-]+/iu,
  /semgrep\s+(?:registry|community edition pack|pro rule)/iu,
  /https?:\/\/(?:[^\s/]+\.)?semgrep\.dev\/[^\s"']*(?:rule|registry)/iu,
];

function validateInventory(manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== 1) errors.push('schemaVersion must be 1');
  if (!Array.isArray(manifest?.packs) || manifest.packs.length !== 1) {
    errors.push('inventory must contain exactly one pack');
    return errors;
  }

  const [pack] = manifest.packs;
  if (pack.name !== EXPECTED_PACK) errors.push('unapproved built-in pack');
  if (pack.version !== EXPECTED_VERSION) errors.push('unapproved built-in pack version');
  if (pack.origin !== 'kase-owned') errors.push('built-in pack must be Kase-owned');
  if (pack.license !== 'LicenseRef-Kase-First-Party') errors.push('unexpected built-in license');
  if (pack.distribution !== 'bundled') errors.push('unexpected distribution mode');
  if (!Array.isArray(pack.rules) || pack.rules.length !== 1) {
    errors.push('built-in pack must contain exactly one rule');
    return errors;
  }

  const [rule] = pack.rules;
  if (rule.id !== EXPECTED_RULE) errors.push('unapproved built-in rule');
  if (rule.provenance !== 'kase-correlation-spike') errors.push('unexpected rule provenance');
  if (rule.source !== 'rules/kase/typescript-security/idor/missing-ownership-predicate.yml') {
    errors.push('unexpected rule source');
  }

  const serialized = JSON.stringify(manifest);
  for (const forbidden of FORBIDDEN_TEXT) {
    if (forbidden.test(serialized)) errors.push(`forbidden rule origin: ${forbidden}`);
  }
  return errors;
}

function requireValidInventory(manifest) {
  const errors = validateInventory(manifest);
  assert.deepEqual(errors, [], errors.join('; '));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function assertRejected(manifest, label) {
  assert.ok(validateInventory(manifest).length > 0, `negative control was accepted: ${label}`);
}

function runInventoryNegativeControls(valid) {
  const extraPack = clone(valid);
  extraPack.packs.push(clone(extraPack.packs[0]));
  assertRejected(extraPack, 'second built-in pack');

  const registryAlias = clone(valid);
  registryAlias.packs[0].rules[0].source = 'p/default';
  assertRejected(registryAlias, 'registry alias');

  const remoteRegistry = clone(valid);
  remoteRegistry.packs[0].rules[0].source = 'https://semgrep.dev/r/typescript';
  assertRejected(remoteRegistry, 'remote registry URL');

  const communityPack = clone(valid);
  communityPack.packs[0].origin = 'Semgrep Community Edition pack';
  assertRejected(communityPack, 'Community Edition pack');

  const proRule = clone(valid);
  proRule.packs[0].rules[0].provenance = 'Semgrep Pro rule';
  assertRejected(proRule, 'Pro rule');

  const semgrepAuthored = clone(valid);
  semgrepAuthored.packs[0].origin = 'semgrep-authored';
  assertRejected(semgrepAuthored, 'Semgrep-authored rule');
}

function validateContracts(stack, adapters) {
  const requiredStack = [
    '**Status: decided.**',
    'LGPL-2.1-licensed Semgrep Community Edition engine',
    'does **not** ship, mirror, fetch, or serve Registry rules',
    '`kase/typescript-security@1.0.0`',
    '`kase.idor.missing-ownership-predicate`',
    'tenant-scoped',
    'immutable SHA-256',
    'not external legal advice',
  ];
  const requiredAdapter = [
    'tenantId:',
    'name: acme/typescript-security',
    'version: 2026.09.0',
    'sha256:',
    'kind: customer-upload',
    'fileName:',
    'label: LicenseRef-Acme-Internal',
    'attestedByActorId:',
    'attestedAt:',
    'never shared across tenants',
    'interface ResolvedRulePackRef',
    "provenance: 'kase-built-in' | 'customer-upload'",
    'interface RunSastInput',
    'localUri: string',
    'verifies the local bytes against `sha256`',
    'never receive `semgrep.*` namespaces',
  ];

  const errors = [];
  for (const token of requiredStack) if (!stack.includes(token)) errors.push(`stack contract missing: ${token}`);
  for (const token of requiredAdapter) if (!adapters.includes(token)) errors.push(`adapter contract missing: ${token}`);

  const customerExamples = [...adapters.matchAll(/```ya?ml\r?\n([\s\S]*?)```/giu)]
    .map((match) => match[1])
    .filter((example) => /^\s*kind:\s*customer-upload\s*$/imu.test(example));
  if (customerExamples.length === 0) errors.push('customer upload example missing');
  const exampleFields = [
    [/^tenantId:\s*\S+/mu, 'tenant scope'],
    [/^name:\s*\S+/mu, 'name'],
    [/^version:\s*\S+/mu, 'version'],
    [/^sha256:\s*[a-f0-9]{64}\s*$/imu, 'immutable SHA-256'],
    [/^source:\s*$/mu, 'provenance object'],
    [/^\s+kind:\s*customer-upload\s*$/mu, 'customer-upload provenance'],
    [/^\s+fileName:\s*\S+/mu, 'source filename'],
    [/^license:\s*$/mu, 'license attestation'],
    [/^\s+label:\s*\S+/mu, 'license label'],
    [/^\s+attestedByActorId:\s*\S+/mu, 'attesting actor'],
    [/^\s+attestedAt:\s*\d{4}-\d{2}-\d{2}T\S+/mu, 'attestation time'],
  ];
  customerExamples.forEach((example, index) => {
    for (const [pattern, label] of exampleFields) {
      if (!pattern.test(example)) errors.push(`customer example ${index + 1} missing ${label}`);
    }
  });

  if (/Open item:\s*Semgrep licensing/iu.test(stack)) errors.push('stack still marks licensing open');
  if (/Ruleset licensing\s*[—-]\s*see/iu.test(adapters)) errors.push('adapter still marks licensing open');
  return errors;
}

function requireValidContracts(stack, adapters) {
  const errors = validateContracts(stack, adapters);
  assert.deepEqual(errors, [], errors.join('; '));
}

function runContractNegativeControls(stack, adapters) {
  const withoutDigest = adapters.replaceAll('sha256:', 'digestRemoved:');
  assert.ok(validateContracts(stack, withoutDigest).length > 0, 'missing digest contract was accepted');

  const withoutTenant = adapters.replaceAll('tenantId:', 'tenantRemoved:');
  assert.ok(validateContracts(stack, withoutTenant).length > 0, 'missing tenant scope was accepted');

  const engineSpecific = adapters.replace('never receive `semgrep.*` namespaces', 'may receive engine namespaces');
  assert.ok(validateContracts(stack, engineSpecific).length > 0, 'engine-specific downstream contract was accepted');

  const reopened = stack.replace('**Status: decided.**', '**Status: open.**');
  assert.ok(validateContracts(reopened, adapters).length > 0, 'reopened decision was accepted');
}

async function loadInputs() {
  const [manifestText, stack, adapters] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(stackPath, 'utf8'),
    readFile(adaptersPath, 'utf8'),
  ]);
  return { manifest: JSON.parse(manifestText), stack, adapters };
}

async function main() {
  const mode = process.argv[2];
  if (!['--self-test', '--contracts'].includes(mode) || process.argv.length !== 3) {
    throw new Error('usage: node scripts/verify-semgrep-decision.mjs --self-test|--contracts');
  }

  const { manifest, stack, adapters } = await loadInputs();
  if (mode === '--self-test') {
    requireValidInventory(manifest);
    runInventoryNegativeControls(manifest);
    console.log('SEMGREP_DECISION_VERIFIED');
    return;
  }

  requireValidContracts(stack, adapters);
  runContractNegativeControls(stack, adapters);
  console.log('SEMGREP_CONTRACTS_VERIFIED');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
