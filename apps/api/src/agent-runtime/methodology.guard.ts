import { Injectable } from '@nestjs/common';
import { readFile, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { ProblemException } from '../common/problem-details';

export function methodologyRoot(): string {
  if (process.env.KASE_METHODOLOGY_ROOT) return resolve(process.env.KASE_METHODOLOGY_ROOT);
  for (const root of [process.cwd(), resolve(process.cwd(), '../..')]) {
    const candidate = join(root, 'methodology/v1');
    if (existsSync(join(candidate, 'manifest.json'))) return candidate;
  }
  throw new ProblemException('METHODOLOGY_CORRUPT', 'Methodology directory unavailable');
}
@Injectable()
export class MethodologyGuard {
  private version?: string;
  async verifyIntegrity(): Promise<string> {
    try {
      const base = methodologyRoot();
      const rootEntries = await readdir(base, { withFileTypes: true });
      if (rootEntries.length !== 3 || rootEntries.some(e =>
        e.name === 'manifest.json' ? !e.isFile() : !['blackbox', 'whitebox'].includes(e.name) || !e.isDirectory()))
        throw new Error('Unexpected methodology root entry');
      const raw = await readFile(join(base, 'manifest.json'), 'utf8');
      const manifest = JSON.parse(raw);
      if (!manifest.kasePromptVersion || !manifest.referenceFiles) throw new Error('Invalid manifest');
      const actual: string[] = [];
      for (const role of ['blackbox', 'whitebox']) {
        for (const entry of await readdir(join(base, role), { withFileTypes: true })) {
          if (!entry.isFile()) throw new Error('Unexpected methodology entry');
          actual.push(role + '/' + entry.name);
        }
      }
      const expected = Object.keys(manifest.referenceFiles).sort();
      if (!expected.length || JSON.stringify(actual.sort()) !== JSON.stringify(expected)) throw new Error('Manifest file set mismatch');
      for (const file of expected) {
        const digest = createHash('sha256').update(await readFile(join(base, file))).digest('hex');
        if (digest !== manifest.referenceFiles[file]) throw new Error('Methodology digest mismatch');
      }
      this.version = manifest.kasePromptVersion;
      return createHash('sha256').update(raw).digest('hex');
    } catch {
      throw new ProblemException('METHODOLOGY_CORRUPT', 'Methodology integrity verification failed');
    }
  }
  getPromptVersion(): string {
    if (!this.version) throw new Error('Verify methodology before using its version');
    return this.version;
  }
}

