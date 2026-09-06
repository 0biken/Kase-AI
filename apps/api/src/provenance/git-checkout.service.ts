import { Injectable } from '@nestjs/common';
import { access, mkdir, rename, rm, writeFile } from 'fs/promises';
import { dirname, join, resolve } from 'path';
import { randomUUID } from 'crypto';
import { assertRepositoryAllowed } from './git-cli-resolver';
import type { ProvenanceRepository } from './provenance-resolver';
import { runControlledProcess } from '../worker/process-control';

@Injectable()
export class GitCheckoutService {
  async checkout(repository: ProvenanceRepository, commitSha: string, signal?: AbortSignal): Promise<string> {
    assertRepositoryAllowed(repository.url);
    if (!/^[a-f0-9]{40}$/iu.test(commitSha)) throw new Error('Checkout requires a full commit SHA');
    const root = resolve(process.env.KASE_CHECKOUT_ROOT ?? join(process.cwd(), '.kase-checkouts'));
    const destination = join(root, commitSha.toLowerCase());
    const marker = join(destination, '.kase-complete');
    if (await exists(marker)) return destination;
    await mkdir(root, { recursive: true });
    const temporary = `${destination}.tmp-${process.pid}-${randomUUID()}`;
    try {
      await runControlledProcess('git', ['clone', '--no-checkout', '--filter=blob:none', repository.url, temporary], {
        cwd: dirname(temporary), signal,
      }).then(requireSuccess('git clone'));
      await runControlledProcess('git', ['-C', temporary, 'checkout', '--detach', commitSha], { signal })
        .then(requireSuccess('git checkout'));
      await writeFile(join(temporary, '.kase-complete'), `${commitSha.toLowerCase()}\n`, { encoding: 'utf8' });
      try {
        await rename(temporary, destination);
      } catch (error) {
        if (!(await exists(marker))) throw error;
      }
      return destination;
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  }
}

function requireSuccess(label: string) {
  return (result: { exitCode: number; stderr: string }) => {
    if (result.exitCode !== 0) throw new Error(`${label} failed: ${result.stderr.slice(0, 1_000)}`);
    return result;
  };
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}
