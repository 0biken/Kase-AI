import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, access } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(root, 'apps', 'api', 'package.json'));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const workspace = await readFile(join(root, 'pnpm-workspace.yaml'), 'utf8');
const lockPath = join(root, 'pnpm-lock.yaml');

assert.equal(pkg.packageManager, 'pnpm@10.15.0');
assert.doesNotMatch(workspace, /^allowBuilds:/mu);
assert.doesNotMatch(workspace, /set this to true or false/iu);
for (const dependency of ['@prisma/client', '@prisma/engines', 'prisma', '@nestjs/core', 'esbuild', 'msgpackr-extract', 'unrs-resolver']) {
  assert.match(workspace, new RegExp(`^\\s+- ['"]?${escapeRegex(dependency)}['"]?\\s*$`, 'mu'));
}

const corepack = process.platform === 'win32'
  ? [process.execPath, join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'corepack.js')]
  : ['corepack'];
const version = spawnSync(corepack[0], [...corepack.slice(1), 'pnpm', '--version'], { cwd: root, encoding: 'utf8', shell: false });
assert.ifError(version.error);
assert.equal(version.status, 0, version.stderr);
assert.equal(version.stdout.trim(), '10.15.0');

await access(require.resolve('class-validator'));
await access(join(dirname(require.resolve('class-validator')), 'container.js'));
const { Prisma } = require('@prisma/client');
const model = (name) => Prisma.dmmf.datamodel.models.find((candidate) => candidate.name === name);
assert.ok(model('Audit')?.fields.some((field) => field.name === 'requestedCommitSha'));
assert.ok(model('AuditJob')?.fields.some((field) => field.name === 'required'));
assert.ok(model('Evidence')?.fields.some((field) => field.name === 'tombstonedAt'));

const before = digest(await readFile(lockPath));
const frozen = spawnSync(corepack[0], [...corepack.slice(1), 'pnpm', 'install', '--frozen-lockfile', '--lockfile-only'], {
  cwd: root, encoding: 'utf8', shell: false,
});
assert.ifError(frozen.error);
assert.equal(frozen.status, 0, `${frozen.stdout}\n${frozen.stderr}`);
assert.equal(digest(await readFile(lockPath)), before, 'frozen install rewrote pnpm-lock.yaml');

console.log('KASE_M2_TOOLCHAIN_VERIFIED');

function digest(bytes) { return createHash('sha256').update(bytes).digest('hex'); }
function escapeRegex(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'); }
