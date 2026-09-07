import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFile(join(root, path), 'utf8');
const [app, scheduler, recon, sast, retention, dispatcher, dto, schema] = await Promise.all([
  read('apps/api/src/app.module.ts'), read('apps/api/src/orchestrator/scheduler.module.ts'),
  read('apps/api/src/worker/worker.module.ts'), read('apps/api/src/worker/sast-worker.module.ts'),
  read('apps/api/src/retention/retention-worker.module.ts'), read('apps/api/src/queue/durable-queue-dispatcher.ts'),
  read('apps/api/src/orchestrator/audit-job.payload.ts'), read('packages/db/schema.prisma'),
]);

for (const token of ['OrganizationsModule', 'FindingsModule', 'EvidenceModule', 'OrchestratorModule']) assert.ok(app.includes(token));
for (const forbidden of ['SchedulerModule', 'SastWorkerModule', 'RetentionWorkerModule', 'WorkerModule']) {
  assert.ok(!new RegExp(`imports:[\\s\\S]*\\b${forbidden}\\b`).test(app), `API imports ${forbidden}`);
}
assert.ok(scheduler.includes('SchedulerWorkerService'));
assert.ok(recon.includes('ReconWorkerService') && recon.includes('ReconPipelineConsumerService'));
assert.ok(sast.includes('SastJobConsumerService'));
assert.ok(retention.includes('RetentionRunnerService'));
assert.match(dispatcher, /assertIdentifierOnlyPayload\(payload\)/u);
const payloadBody = dto.match(/interface\s+ReconAuditJobPayload\s*\{([\s\S]*?)\}/u)?.[1] ?? '';
const payloadFields = [...payloadBody.matchAll(/^\s*([A-Za-z][A-Za-z0-9]*)\??:\s*/gmu)].map((match) => match[1]).sort();
assert.deepEqual(payloadFields, ['auditId', 'auditJobId', 'projectId']);
for (const field of ['cancellationRequestedAt', 'requestedCommitSha', 'timeoutMs', 'maxRetries', 'required', 'tombstonedAt']) assert.ok(schema.includes(field));

const contaminated = app.replace('imports: [', 'imports: [SchedulerModule, ');
assert.ok(/imports:[\s\S]*\bSchedulerModule\b/u.test(contaminated), 'negative runtime-isolation control failed');
console.log('KASE_M2_RUNTIME_VERIFIED');
