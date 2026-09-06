import type { BuildInfoObservation, BuildInfoReader } from './provenance-resolver';
import { Inject, Injectable } from '@nestjs/common';

export const BUILD_INFO_FETCH = Symbol('BUILD_INFO_FETCH');

@Injectable()
export class HttpBuildInfoReader implements BuildInfoReader {
  constructor(@Inject(BUILD_INFO_FETCH) private readonly request: typeof fetch) {}

  async read(url: string, signal?: AbortSignal): Promise<BuildInfoObservation> {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' && process.env.KASE_ALLOW_INSECURE_BUILD_INFO !== 'true') {
      throw new Error('Build info URL must use HTTPS');
    }
    const response = await this.request(parsed, {
      method: 'GET',
      redirect: 'error',
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`Build info endpoint returned ${response.status}`);
    const body = (await response.json()) as Record<string, unknown>;
    return {
      commitSha: stringField(body, 'commitSha', 'sha', 'commit'),
      branch: stringField(body, 'branch'),
      buildId: stringField(body, 'buildId', 'id'),
    };
  }
}

function stringField(body: Record<string, unknown>, ...names: string[]): string | undefined {
  for (const name of names) if (typeof body[name] === 'string') return body[name].trim();
  return undefined;
}
