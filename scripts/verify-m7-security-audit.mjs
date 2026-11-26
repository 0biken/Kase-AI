import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// M7 local proof: security-audit skill integration. Covers the schema mirror, the warn-only importer
// (severity floors, stable fingerprints, evidence class), the digest-pinned methodology module, the
// prompt builder opt-in, the `security` category's job-graph wiring, gate-category derivation
// from agent coverage, and the import route's body limit. No Docker, no live database.
const result = spawnSync(
  process.execPath,
  ['node_modules/jest/bin/jest.js', '--runInBand', 'findings/security-audit.spec.ts', 'agent-runtime/security-methodology.spec.ts',
    'orchestrator/gate-categories.spec.ts', 'orchestrator/audit-scheduler.service.spec.ts', 'common/route-body-limits.spec.ts'],
  { cwd: fileURLToPath(new URL('../apps/api/', import.meta.url)), stdio: 'inherit', env: { ...process.env, NODE_ENV: 'test' } },
);
if (result.status !== 0) process.exit(result.status ?? 1);
console.log('KASE_M7_SECURITY_AUDIT_VERIFIED');
