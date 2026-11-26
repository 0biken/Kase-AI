import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// M6 Workstream B3 local proof: gate-evaluation normalization + orchestration
// (Prisma rows -> engine input -> persisted GateEvaluation) and evidence
// classification, against in-memory doubles. No Docker, no network.
const result = spawnSync(
  process.execPath,
  ['node_modules/jest/bin/jest.js', '--runInBand', 'assurance/gate/gate-evaluation.service.spec.ts', 'assurance/gate/evidence-classification.spec.ts'],
  { cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('KASE_M6_GATE_EVALUATION_VERIFIED');
