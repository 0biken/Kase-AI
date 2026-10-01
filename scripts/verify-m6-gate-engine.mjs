import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// M6 Workstream B1 local proof: the pure deterministic gate engine's
// invariants and the policy DSL schema. No Docker, no network, no provider.
const result = spawnSync(
  process.execPath,
  ['node_modules/jest/bin/jest.js', '--runInBand', 'assurance/gate/gate-engine.spec.ts', 'assurance/policy/policy-schema.spec.ts'],
  { cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('KASE_M6_GATE_ENGINE_VERIFIED');
