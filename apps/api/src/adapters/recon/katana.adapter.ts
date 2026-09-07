import { Injectable } from '@nestjs/common';
import { runControlledProcess } from '../../worker/process-control';
import type { ReconCandidate } from '../../recon/recon.types';

export interface KatanaRunInput {
  targetUrl: string;
  proxyUrl: string;
  rateLimit: number;
  maxPages: number;
  crawlScope: string;
  crawlOutScope: readonly string[];
  signal: AbortSignal;
}

@Injectable()
export class KatanaAdapter {
  async run(input: KatanaRunInput): Promise<{ rawJsonl: string; candidates: ReconCandidate[]; requestCount: number }> {
    const args = [
      '-u', input.targetUrl, '-proxy', input.proxyUrl,
      '-d', '3', '-s', 'breadth-first', '-jc', '-fx',
      '-c', '5', '-p', '1', '-rl', String(input.rateLimit),
      '-max-domain-pages', String(input.maxPages), '-retry', '0', '-dr',
      '-max-response-size', '2097152', '-jsonl', '-silent', '-duc',
      '-display-out-scope', '-omit-raw', '-omit-body', '-cs', input.crawlScope,
      ...input.crawlOutScope.flatMap((value) => ['-cos', value]),
    ];
    const result = await runControlledProcess('katana', args, { signal: input.signal, graceMs: 30_000, maxOutputBytes: 10 * 1024 * 1024 });
    if (result.exitCode !== 0) throw new Error(`Katana failed (${result.exitCode}): ${result.stderr.slice(0, 1_000)}`);
    const candidates = parseKatanaJsonl(result.stdout);
    return { rawJsonl: result.stdout, candidates, requestCount: candidates.length };
  }
}

export function parseKatanaJsonl(raw: string): ReconCandidate[] {
  if (Buffer.byteLength(raw) > 10 * 1024 * 1024) throw new Error('Katana output exceeds 10 MiB');
  const candidates: ReconCandidate[] = [];
  for (const [index, line] of raw.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line) > 256 * 1024) throw new Error(`Katana JSONL line ${index + 1} exceeds 256 KiB`);
    let value: any;
    try { value = JSON.parse(line); } catch { throw new Error(`Malformed Katana JSONL at line ${index + 1}`); }
    const url = value?.request?.endpoint ?? value?.url;
    if (typeof url !== 'string') continue;
    candidates.push({ url, method: typeof value?.request?.method === 'string' ? value.request.method : 'GET', source: 'katana' });
  }
  return candidates;
}
