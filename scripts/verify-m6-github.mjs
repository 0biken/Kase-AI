import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// M6 GATES G7 local proof, no GitHub and no Docker: the check-run and PR
// comment renderer (PARTIAL never success, verified-only annotations, golden
// comment), webhook signature and install-state security, the App JWT and
// scoped-token client against a fake GitHub, the PR → audit → check → comment
// flow against in-memory doubles, and the kase-gate Action's exit codes.
const root = new URL('../', import.meta.url);
const steps = [
  [process.execPath, ['node_modules/jest/bin/jest.js', '--runInBand', 'integrations/github/', 'common/route-body-limits'], new URL('apps/api/', root)],
  [process.execPath, ['--test', '.github/actions/kase-gate/run.test.mjs'], root],
];
for (const [cmd, args, cwd] of steps) {
  const result = spawnSync(cmd, args, { cwd: fileURLToPath(cwd), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
console.log('KASE_M6_GITHUB_VERIFIED');
