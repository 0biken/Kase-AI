#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const docker = process.env.KASE_DOCKER_BIN || 'docker';
const project = `kase-m4-db-${randomUUID().slice(0, 12)}`;
const runRoot = resolve(root, '.m4-proof/database', project);
const composeFile = resolve(runRoot, 'compose.json');
const startedAt = new Date().toISOString();
const scenarios = [];
let started = false;
function run(exe, args, options = {}) {
  try { return execFileSync(exe, args, { cwd: root, encoding: 'utf8', timeout: 180000, stdio: ['pipe', 'pipe', 'pipe'], ...options }).trim(); }
  catch { throw new Error(`Required proof command failed: ${exe === docker ? 'docker' : 'node'} ${args[0] ?? ''}`); }
}
const compose = args => run(docker, ['compose', '-p', project, '-f', composeFile, ...args]);
try {
  // Readiness happens before creating containers or touching any database.
  run(docker, ['version', '--format', '{{.Server.Version}}']);
  mkdirSync(runRoot, { recursive: true });
  const password = randomBytes(24).toString('hex');
  // This generated Compose file contains only disposable credentials. It is
  // never copied into the sanitized proof record or used for development data.
  writeFileSync(composeFile, JSON.stringify({ services: {
    postgres: { image: 'postgres:16-alpine', environment: { POSTGRES_USER: 'proof', POSTGRES_PASSWORD: password, POSTGRES_DB: 'proof_clean' }, ports: ['127.0.0.1::5432'], healthcheck: { test: ['CMD-SHELL', 'pg_isready -U proof -d proof_clean'], interval: '1s', timeout: '3s', retries: 60 } },
    redis: { image: 'redis:7-alpine', ports: ['127.0.0.1::6379'], healthcheck: { test: ['CMD', 'redis-cli', 'ping'], interval: '1s', timeout: '3s', retries: 60 } },
  } }, null, 2));
  started = true;
  compose(['up', '-d', '--wait', '--wait-timeout', '90']);
  const port = Number(compose(['port', 'postgres', '5432']).split(':').at(-1));
  if (!Number.isInteger(port) || port <= 0) throw new Error('Invalid disposable PostgreSQL port');
  if (compose(['exec', '-T', 'redis', 'redis-cli', 'ping']) !== 'PONG') throw new Error('Redis positive control failed');
  scenarios.push('redis-reachable');
  compose(['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'proof', '-d', 'proof_clean', '-c', 'CREATE DATABASE proof_upgrade']);
  const migrationRoot = resolve(runRoot, 'm3');
  mkdirSync(resolve(migrationRoot, 'migrations'), { recursive: true });
  cpSync(resolve(root, 'packages/db/schema.prisma'), resolve(migrationRoot, 'schema.prisma'));
  const m4 = '20260911000000_m4_agent_runtime';
  const migrations = readdirSync(resolve(root, 'packages/db/migrations'), { withFileTypes: true });
  for (const entry of migrations) {
    if (entry.name === m4) continue;
    cpSync(resolve(root, 'packages/db/migrations', entry.name), resolve(migrationRoot, 'migrations', entry.name), { recursive: true });
  }
  const prisma = resolve(root, 'packages/db/node_modules/prisma/build/index.js');
  for (const database of ['proof_clean', 'proof_upgrade']) {
    const connection = `postgresql://proof:${password}@127.0.0.1:${port}/${database}`;
    const env = { ...process.env, DATABASE_URL: connection, KASE_DATABASE_URL: connection, KASE_M4_DISPOSABLE_DATABASE: 'true', TS_NODE_PROJECT: resolve(root, 'apps/api/tsconfig.json') };
    const schema = database === 'proof_upgrade' ? resolve(migrationRoot, 'schema.prisma') : resolve(root, 'packages/db/schema.prisma');
    run(process.execPath, [prisma, 'migrate', 'deploy', '--schema', schema], { env });
    if (database === 'proof_upgrade') {
      compose(['exec', '-T', 'postgres', 'psql', '-v', 'ON_ERROR_STOP=1', '-U', 'proof', '-d', database, '-c', `INSERT INTO "CodeMap" (id) VALUES ('legacy-proof-map')`]);
      cpSync(resolve(root, 'packages/db/migrations', m4), resolve(migrationRoot, 'migrations', m4), { recursive: true });
      run(process.execPath, [prisma, 'migrate', 'deploy', '--schema', schema], { env });
    }
    const output = run(process.execPath, ['-r', resolve(root, 'apps/api/node_modules/ts-node/register/transpile-only'), resolve(root, 'apps/api/src/agent-runtime/budget/budget.postgres.proof.ts')], { env });
    if (!output.includes('KASE_M4_POSTGRES_BEHAVIOR_VERIFIED')) throw new Error('Database behavior assertions produced no success marker');
    scenarios.push(`${database}:migrations-concurrency-settlement-recovery-cancellation-deadline-provenance`);
  }
  const imageIds = {};
  for (const service of ['postgres', 'redis']) imageIds[service] = run(docker, ['inspect', '--format', '{{.Image}}', compose(['ps', '-q', service])]);
  const proof = { startedAt, finishedAt: new Date().toISOString(), project, revision: run('git', ['rev-parse', 'HEAD']), migrationSha256: createHash('sha256').update(readFileSync(resolve(root, 'packages/db/migrations', m4, 'migration.sql'))).digest('hex'), imageIds, scenarios, passed: true, scope: 'database subset of G2; not G5 or G6' };
  writeFileSync(resolve(runRoot, 'evidence.json'), JSON.stringify(proof, null, 2) + '\n');
  console.log('KASE_M4_DATABASE_SUBSET_VERIFIED');
} catch (error) {
  console.error(`M4 database proof incomplete: ${error.message}`);
  process.exitCode = 1;
} finally {
  if (started) {
    // The generated UUID project has no shared or externally named volumes.
    // Never run teardown against the development Compose project.
    try { compose(['down', '--volumes', '--remove-orphans']); }
    catch { console.error(`Cleanup incomplete for disposable project ${project}`); process.exitCode = 1; }
  }
}
