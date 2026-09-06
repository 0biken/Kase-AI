import { createHash } from 'crypto';

export type ProvenanceSource =
  | 'ci_supplied'
  | 'build_info_endpoint'
  | 'response_header'
  | 'assumed';

export interface ProvenanceRepository {
  url: string;
  defaultBranch: string;
}

export interface ProvenanceTarget {
  buildInfoUrl?: string | null;
}

export interface BuildInfoObservation {
  commitSha?: string;
  branch?: string;
  buildId?: string;
}

export interface GitResolver {
  resolveCommit(repository: ProvenanceRepository, ref: string, signal?: AbortSignal): Promise<string>;
}

export interface BuildInfoReader {
  read(url: string, signal?: AbortSignal): Promise<BuildInfoObservation>;
}

export interface ResolveProvenanceInput {
  repository: ProvenanceRepository;
  target?: ProvenanceTarget | null;
  callerCommitSha?: string | null;
  responseHeaders?: Record<string, string | string[] | undefined>;
  signal?: AbortSignal;
}

export interface ResolvedProvenance {
  commitSha: string;
  branch?: string;
  buildId?: string;
  source: ProvenanceSource;
  verified: boolean;
  targetFingerprint: string;
  observations: Readonly<Record<string, string>>;
}

export class ProvenanceMismatchError extends Error {
  readonly code = 'provenance_mismatch';
}

export class ProvenanceResolver {
  constructor(
    private readonly git: GitResolver,
    private readonly buildInfo: BuildInfoReader,
  ) {}

  async resolve(input: ResolveProvenanceInput): Promise<ResolvedProvenance> {
    const build = input.target?.buildInfoUrl
      ? await this.buildInfo.read(input.target.buildInfoUrl, input.signal)
      : undefined;
    const headerSha = getHeader(input.responseHeaders, 'x-build-sha');
    const claims = [
      ['caller', clean(input.callerCommitSha)],
      ['build_info', clean(build?.commitSha)],
      ['response_header', clean(headerSha)],
    ] as const;

    const resolvedClaims: Array<readonly [string, string]> = [];
    for (const [name, claim] of claims) {
      if (claim) resolvedClaims.push([name, await this.git.resolveCommit(input.repository, claim, input.signal)]);
    }
    const distinct = new Set(resolvedClaims.map(([, sha]) => sha.toLowerCase()));
    if (distinct.size > 1) {
      throw new ProvenanceMismatchError(
        `Conflicting commit claims: ${resolvedClaims.map(([name, sha]) => `${name}=${sha}`).join(', ')}`,
      );
    }

    let source: ProvenanceSource;
    let commitSha: string;
    if (clean(input.callerCommitSha)) source = 'ci_supplied';
    else if (clean(build?.commitSha)) source = 'build_info_endpoint';
    else if (clean(headerSha)) source = 'response_header';
    else source = 'assumed';

    if (resolvedClaims.length) commitSha = resolvedClaims[0][1];
    else commitSha = await this.git.resolveCommit(input.repository, input.repository.defaultBranch, input.signal);

    const observations: Record<string, string> = {
      repositoryUrl: input.repository.url,
      defaultBranch: input.repository.defaultBranch,
      selectedCommitSha: commitSha.toLowerCase(),
      source,
    };
    for (const [name, sha] of resolvedClaims) observations[name] = sha.toLowerCase();
    if (build?.branch) observations.branch = build.branch;
    if (build?.buildId) observations.buildId = build.buildId;

    return {
      commitSha,
      branch: build?.branch ?? (source === 'assumed' ? input.repository.defaultBranch : undefined),
      buildId: build?.buildId,
      source,
      verified: source !== 'assumed',
      targetFingerprint: sha256(canonicalJson(observations)),
      observations: Object.freeze(observations),
    };
  }
}

function getHeader(
  headers: ResolveProvenanceInput['responseHeaders'],
  name: string,
): string | undefined {
  const found = Object.entries(headers ?? {}).find(([key]) => key.toLowerCase() === name);
  const value = found?.[1];
  return Array.isArray(value) ? value[0] : value;
}

function clean(value: string | null | undefined): string | undefined {
  const result = value?.trim();
  return result || undefined;
}

function canonicalJson(value: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))));
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
