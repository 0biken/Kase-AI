import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// M6 Workstream C local proof: waiver and suppression services (expiry bounds,
// separate-approver rule, identity linkage, attribution) against in-memory
// doubles. No Docker, no live database.
const result = spawnSync(
  process.execPath,
  ['node_modules/jest/bin/jest.js', '--runInBand', 'assurance/waivers/waivers.service.spec.ts'],
  { cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('KASE_M6_WAIVERS_VERIFIED');
