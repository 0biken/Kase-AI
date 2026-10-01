import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// M6 Workstream A local proof: gate-policy CRUD/versioning against an
// in-memory Prisma double. No Docker, no live database.
const result = spawnSync(
  process.execPath,
  ['node_modules/jest/bin/jest.js', '--runInBand', 'assurance/policy/gate-policy.service.spec.ts'],
  { cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('KASE_M6_POLICY_CRUD_VERIFIED');
