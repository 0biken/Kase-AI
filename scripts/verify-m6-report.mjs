import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// M6 GATES G6 local proof: the audit report follows the skills' report
// structure, builds the executive summary last against a golden file, escapes
// untrusted finding text, and surfaces waivers expiring within
// warn_before_expiry_days. The API service and route run against in-memory
// doubles, and the CLI writes the report folder. No Docker, no live database.
const api = spawnSync(
  process.execPath,
  ['node_modules/jest/bin/jest.js', '--runInBand', 'assurance/report/'],
  { cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } },
);
if (api.status !== 0) process.exit(api.status ?? 1);
const cli = spawnSync('npm', ['test'], { cwd: fileURLToPath(new URL('../apps/cli/', import.meta.url)), stdio: 'inherit', shell: true });
if (cli.status !== 0) process.exit(cli.status ?? 1);
console.log('KASE_M6_REPORT_VERIFIED');
