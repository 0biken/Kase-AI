import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
for (const args of [['node_modules/jest/bin/jest.js', '--runInBand'], ['node_modules/typescript/bin/tsc', '--noEmit']]) {
  const result = spawnSync(process.execPath, args, { cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('KASE_M5_REGRESSIONS_VERIFIED');
