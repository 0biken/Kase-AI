#!/usr/bin/env node
// Records digests for the vendored cloudflare/security-audit-skill references (methodology/v1/security/)
// in methodology/v1/manifest.json. The upstream files are copied verbatim at the pinned commit; the only
// Kase-authored file is 00-kase-security-instructions.md. Run after changing anything under security/.
import { createHash } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const UPSTREAM = { repo: 'https://github.com/cloudflare/security-audit-skill', commit: 'c1c8a8c1471069fb0e188eeaff69b8e8db6564a8', license: 'MIT' };
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'methodology', 'v1');
const manifestPath = join(root, 'manifest.json');
const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));

for (const key of Object.keys(manifest.referenceFiles)) if (key.startsWith('security/')) delete manifest.referenceFiles[key];
for (const entry of (await readdir(join(root, 'security'), { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
  if (!entry.isFile()) throw new Error(`security/${entry.name} must be a file`);
  manifest.referenceFiles[`security/${entry.name}`] = createHash('sha256').update(await readFile(join(root, 'security', entry.name))).digest('hex');
}
manifest.referenceFiles = Object.fromEntries(Object.entries(manifest.referenceFiles).sort(([a], [b]) => a.localeCompare(b)));
manifest.upstreamSecurityAudit = UPSTREAM;
manifest.kasePromptVersion = 'm7-1.0.0';
await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
console.log(`manifest updated: ${Object.keys(manifest.referenceFiles).length} reference files, prompt ${manifest.kasePromptVersion}`);
