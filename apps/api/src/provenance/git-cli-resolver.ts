import type { GitResolver, ProvenanceRepository } from './provenance-resolver';
import { Injectable } from '@nestjs/common';
import { runControlledProcess } from '../worker/process-control';

const FULL_SHA = /^[a-f0-9]{40}$/i;

@Injectable()
export class GitCliResolver implements GitResolver {
  async resolveCommit(repository: ProvenanceRepository, ref: string, signal?: AbortSignal): Promise<string> {
    assertRepositoryAllowed(repository.url);
    const { stdout, stderr, exitCode } = await runControlledProcess('git', ['ls-remote', repository.url, ref], {
      signal, graceMs: 30_000, maxOutputBytes: 1024 * 1024,
    });
    if (exitCode !== 0) throw new Error(`Git ref resolution failed: ${stderr.slice(0, 1_000)}`);
    const matches = stdout
      .split(/\r?\n/u)
      .map((line) => line.split(/\s+/u)[0])
      .filter((sha) => FULL_SHA.test(sha));
    if (FULL_SHA.test(ref) && matches.length === 0) return ref.toLowerCase();
    const exactPrefix = matches.find((sha) => sha.toLowerCase().startsWith(ref.toLowerCase()));
    const selected = exactPrefix ?? matches[0];
    if (!selected) throw new Error(`Git ref could not be resolved: ${ref}`);
    return selected.toLowerCase();
  }
}

export function assertRepositoryAllowed(url: string): void {
  if (/^https:\/\//iu.test(url)) return;
  if (process.env.KASE_ALLOW_LOCAL_REPOSITORIES === 'true' && (/^file:\/\//iu.test(url) || /^[a-z]:[\\/]/iu.test(url))) return;
  throw new Error('Repository URL must use HTTPS');
}
