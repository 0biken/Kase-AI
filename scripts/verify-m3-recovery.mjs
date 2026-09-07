import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corepack = process.platform === 'win32' ? [process.execPath, join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')] : ['corepack'];
const pnpm = (args) => [corepack[0], [...corepack.slice(1), 'pnpm', ...args]];
const steps = [
  ['M3 static', 'node', ['scripts/verify-m3-static.mjs']],
  ['toolchain', 'node', ['scripts/verify-m2-toolchain.mjs']],
  ['Prisma validate', ...pnpm(['--filter','@kase/db','run','validate'])],
  ['Prisma generate', ...pnpm(['--filter','@kase/db','run','generate'])],
  ['API tests', ...pnpm(['--dir','apps/api','test','--runInBand'])],
  ['API build', ...pnpm(['--filter','@kase/api','run','build'])],
  ['web tests', ...pnpm(['--dir','apps/web','test','--runInBand'])],
  ['web build', ...pnpm(['--filter','@kase/web','run','build'])],
  ['CLI tests', ...pnpm(['--filter','@kase/cli','run','test'])],
  ['CLI build', ...pnpm(['--filter','@kase/cli','run','build'])],
  ['Phase 0 decisions', 'node', ['scripts/verify-phase0-decisions.mjs']],
  ['no AI', 'node', ['scripts/verify-m2-no-ai.mjs']],
  ['runtime isolation', 'node', ['scripts/verify-m2-runtime.mjs']],
  ['M2 Compose contracts', 'node', ['scripts/verify-m2-compose-static.mjs']],
];
for (const [label, command, args] of steps) {
  console.log(`[m3 recovery] ${label}`);
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
const compose = spawnSync('docker', ['compose','config','--quiet'], { cwd: root,
  env: { ...process.env, KASE_LOCAL_KEK: process.env.KASE_LOCAL_KEK ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' }, stdio: 'inherit', shell: false });
if (compose.error) throw compose.error;
if (compose.status !== 0) process.exit(compose.status ?? 1);
console.log('KASE_M3_RECOVERY_VERIFIED');
