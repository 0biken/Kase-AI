import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';

const npm = process.platform === 'win32'
  ? [process.execPath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')]
  : ['npm'];
const steps = [
  ['apps/api', ['test', '--', '--runInBand']],
  ['apps/api', ['run', 'build']],
  ['apps/web', ['test', '--', '--runInBand']],
  ['apps/web', ['run', 'build']],
  ['packages/db', ['run', 'validate']],
  ['apps/api', ['test', '--', '--runInBand', 'worker-security.spec.ts']],
];

for (const [prefix, args] of steps) {
  const result = spawnSync(npm[0], [...npm.slice(1), '--prefix', prefix, ...args], {
    cwd: new URL('..', import.meta.url),
    env: process.env,
    stdio: 'inherit',
    shell: false,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const compose = spawnSync('docker', ['compose', 'config', '--quiet'], {
  cwd: new URL('..', import.meta.url),
  env: {
    ...process.env,
    KASE_LOCAL_KEK: process.env.KASE_LOCAL_KEK ?? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
  },
  stdio: 'inherit',
  shell: false,
});
if (compose.error) throw compose.error;
if (compose.status !== 0) process.exit(compose.status ?? 1);

console.log('KASE_M1_STATIC_VERIFIED');
