import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function runLocalProof(gate, suites, marker) {
  const startedAt = new Date().toISOString();
  const temporary = mkdtempSync(join(tmpdir(), 'kase-m4-jest-'));
  try {
    const outputFile = join(temporary, 'result.json');
    const result = spawnSync(process.execPath, [resolve(root, 'apps/api/node_modules/jest/bin/jest.js'), '--runInBand', '--json', '--outputFile', outputFile, ...suites], {
      cwd: resolve(root, 'apps/api'), encoding: 'utf8', timeout: 240000, maxBuffer: 4 * 1024 * 1024,
      env: { ...process.env, NODE_ENV: 'test' },
    });
    let summary;
    try { summary = JSON.parse(readFileSync(outputFile, 'utf8')); } catch { /* Missing test results fail the proof. */ }
    const passed = result.status === 0 && summary?.success === true && summary.numPassedTests > 0 &&
      summary.numFailedTests === 0 && summary.numPendingTests === 0 && summary.numTodoTests === 0;
    const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' });
    if (revision.status !== 0) throw new Error('Cannot record proof revision');
    const digest = createHash('sha256');
    const visit = directory => {
      for (const entry of readdirSync(resolve(root, directory), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        const relative = `${directory}/${entry.name}`;
        if (entry.isDirectory()) visit(relative);
        else if (entry.isFile()) digest.update(relative).update(readFileSync(resolve(root, relative)));
      }
    };
    visit('apps/api/src');
    const failedSuites = (summary?.testResults ?? []).filter(test => test.numFailingTests || test.failureMessage)
      .map(test => test.name).sort();
    const proof = { gate, scope: 'local behavioral subset; does not certify the full M4 gate', startedAt, finishedAt: new Date().toISOString(), revision: revision.stdout.trim(), sourceSha256: digest.digest('hex'), exitStatus: result.status, passed, passedTests: summary?.numPassedTests ?? 0, failedTests: summary?.numFailedTests ?? null, skippedTests: summary?.numPendingTests ?? null, failedSuites, suites };
    mkdirSync(resolve(root, '.m4-proof/local'), { recursive: true });
    writeFileSync(resolve(root, `.m4-proof/local/${gate}.json`), JSON.stringify(proof, null, 2) + '\n');
    if (!passed) throw new Error(`${gate} failed or skipped required tests; inspect the named suites locally`);
    console.log(`${gate}: ${proof.passedTests} test cases passed (local behavioral subset)`);
    console.log(marker);
  } finally {
    // Only remove the exact directory created by mkdtemp for this run.
    rmSync(temporary, { recursive: true, force: true });
  }
}
