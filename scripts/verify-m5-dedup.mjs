import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// GATES-M5 G5: exact, structural and advisory dedup produce MATCH,
// POSSIBLE_MATCH and NEW_FINDING, and ambiguous pairs wait for a human.
const result = spawnSync(process.execPath, ['node_modules/jest/bin/jest.js', '--runInBand', 'findings/finding-review.spec.ts',
  'agent-runtime/capabilities/capability.schemas.spec.ts'], {
  cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('KASE_M5_DEDUP_VERIFIED');
