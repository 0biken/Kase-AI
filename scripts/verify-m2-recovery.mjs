import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const corepack = process.platform === 'win32'
  ? [process.execPath, join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')]
  : ['corepack'];
const pnpm = (args) => [corepack[0], [...corepack.slice(1), 'pnpm', ...args]];
const prismaValidate = pnpm(['--filter', '@kase/db', 'run', 'validate']);
const prismaGenerate = pnpm(['--filter', '@kase/db', 'run', 'generate']);
const apiTests = pnpm(['--dir', 'apps/api', 'test', '--runInBand']);
const apiBuild = pnpm(['--filter', '@kase/api', 'run', 'build']);
const webTests = pnpm(['--dir', 'apps/web', 'test', '--runInBand']);
const webBuild = pnpm(['--filter', '@kase/web', 'run', 'build']);
const cliTests = pnpm(['--filter', '@kase/cli', 'run', 'test']);
const cliBuild = pnpm(['--filter', '@kase/cli', 'run', 'build']);
const steps = [
  ['toolchain', 'node', ['scripts/verify-m2-toolchain.mjs']],
  ['prisma validate', ...prismaValidate],
  ['prisma generate', ...prismaGenerate],
  ['API tests', ...apiTests],
  ['API build', ...apiBuild],
  ['web tests', ...webTests],
  ['web build', ...webBuild],
  ['CLI tests', ...cliTests],
  ['CLI build', ...cliBuild],
  ['runtime isolation', 'node', ['scripts/verify-m2-runtime.mjs']],
  ['Phase 0 decisions', 'node', ['scripts/verify-phase0-decisions.mjs']],
];

for (const [label, command, args] of steps) {
  console.log(`[m2 recovery] ${label}`);
  const result = spawnSync(command, args, { cwd: root, env: process.env, stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const compose = spawnSync('docker', ['compose', 'config', '--quiet'], {
  cwd: root,
  env: { ...process.env, KASE_LOCAL_KEK: process.env.KASE_LOCAL_KEK ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=' },
  stdio: 'inherit', shell: false,
});
if (compose.error) throw compose.error;
if (compose.status !== 0) process.exit(compose.status ?? 1);
console.log('KASE_M2_RECOVERY_VERIFIED');
