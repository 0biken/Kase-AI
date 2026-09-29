import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const result = spawnSync(process.execPath, ['node_modules/jest/bin/jest.js', '--runInBand', 'correlation-core.spec.ts', 'code-map-production.spec.ts'], {
  cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('KASE_M5_CORE_VERIFIED');
