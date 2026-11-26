import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// GATES-M5 G3: NestJS and FastAPI runtime route dumps plus OpenAPI ingest
// produce ranked, commit-bound route artifacts. The suite boots the real
// NestJS fixture and runs the FastAPI dumper against the real FastAPI spike
// fixture, so Python with FastAPI must be installed: a missing interpreter
// fails the gate rather than skipping it.
const python = spawnSync('python', ['-c', 'import fastapi'], { encoding: 'utf8' });
if (python.status !== 0) {
  console.error('verify-m5-routes: python with fastapi is required (pip install fastapi)');
  process.exit(1);
}
const result = spawnSync(process.execPath, ['node_modules/jest/bin/jest.js', '--runInBand', 'adapters/routemap/routemap.spec.ts', 'correlation-core.spec.ts'], {
  cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('KASE_M5_ROUTES_VERIFIED');
