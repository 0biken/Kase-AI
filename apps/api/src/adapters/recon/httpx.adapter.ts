import { Injectable } from '@nestjs/common';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { runControlledProcess } from '../../worker/process-control';
import type { ReconCandidate, VerifiedEndpointCandidate } from '../../recon/recon.types';

export interface HttpxRunInput {
  candidates: readonly ReconCandidate[];
  proxyUrl: string;
  rateLimit: number;
  signal: AbortSignal;
}

@Injectable()
export class HttpxAdapter {
  async run(input: HttpxRunInput): Promise<{ rawJsonl: string; results: VerifiedEndpointCandidate[] }> {
    const directory = await mkdtemp(join(tmpdir(), 'kase-httpx-'));
    const listPath = join(directory, 'candidates.txt');
    try {
      await writeFile(listPath, input.candidates.map((candidate) => candidate.url).join('\n'), { encoding: 'utf8', mode: 0o600 });
      const result = await runControlledProcess('httpx', [
        '-l', listPath, '-proxy', input.proxyUrl, '-json', '-silent', '-duc',
        '-tech-detect', '-status-code', '-content-type', '-title', '-web-server',
        '-location', '-ip', '-tls-grab', '-threads', '5', '-rate-limit', String(input.rateLimit),
        '-timeout', '10', '-retries', '0', '-no-color', '-no-fallback-scheme',
        '-response-size-to-read', '2097152', '-response-size-to-save', '2097152',
      ], { signal: input.signal, graceMs: 30_000, maxOutputBytes: 10 * 1024 * 1024 });
      if (result.exitCode !== 0) throw new Error(`httpx failed (${result.exitCode}): ${result.stderr.slice(0, 1_000)}`);
      return { rawJsonl: result.stdout, results: parseHttpxJsonl(result.stdout) };
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

export function parseHttpxJsonl(raw: string): VerifiedEndpointCandidate[] {
  if (Buffer.byteLength(raw) > 10 * 1024 * 1024) throw new Error('httpx output exceeds 10 MiB');
  const results: VerifiedEndpointCandidate[] = [];
  for (const [index, line] of raw.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    if (Buffer.byteLength(line) > 256 * 1024) throw new Error(`httpx JSONL line ${index + 1} exceeds 256 KiB`);
    let value: any;
    try { value = JSON.parse(line); } catch { throw new Error(`Malformed httpx JSONL at line ${index + 1}`); }
    if (typeof value?.url !== 'string' || !Number.isInteger(value?.status_code)) continue;
    results.push({
      url: value.url,
      method: typeof value.method === 'string' ? value.method : 'GET',
      source: 'httpx',
      status: value.status_code,
      contentType: stringValue(value.content_type),
      technologies: Array.isArray(value.tech) ? value.tech.filter((item: unknown): item is string => typeof item === 'string').sort() : [],
      title: stringValue(value.title),
      server: stringValue(value.webserver),
      redirectLocation: stringValue(value.location),
    });
  }
  return results;
}

function stringValue(value: unknown): string | undefined { return typeof value === 'string' && value ? value : undefined; }
