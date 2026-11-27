import { createPrivateKey, sign, type KeyObject } from 'node:crypto';
import type { CheckAnnotation, CheckConclusion } from './github-render';

/**
 * The GitHub calls Kase makes, as a port so the flow can be tested without
 * GitHub. `FetchGithubApi` is the real implementation: App JWT → short-lived
 * installation token scoped to one repository with only `checks` and
 * `pull_requests` write. No repository credential is ever stored.
 */
export interface RepoRef { installationId: string; owner: string; repo: string }
export interface IssueComment { id: number; body: string; appId: number | null }

export interface GithubApi {
  readonly appId: number;
  installationAccount(installationId: string): Promise<{ login: string }>;
  /** Exchanges the OAuth code GitHub sends on install, and lists the installations that user can access. */
  userInstallationIds(code: string): Promise<Set<string>>;
  createCheckRun(ref: RepoRef, input: { headSha: string; externalId: string; detailsUrl: string | null; title: string; summary: string }): Promise<{ id: number }>;
  completeCheckRun(ref: RepoRef, checkRunId: string, input: { conclusion: CheckConclusion; title: string; summary: string; text: string; annotations: CheckAnnotation[] }): Promise<void>;
  appendAnnotations(ref: RepoRef, checkRunId: string, input: { title: string; summary: string; annotations: CheckAnnotation[] }): Promise<void>;
  listIssueComments(ref: RepoRef, prNumber: number): Promise<IssueComment[]>;
  createIssueComment(ref: RepoRef, prNumber: number, body: string): Promise<{ id: number }>;
  /** Returns false when the comment no longer exists. */
  updateIssueComment(ref: RepoRef, commentId: string, body: string): Promise<boolean>;
}

export class GithubApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export interface GithubAppConfig {
  appId: number;
  privateKeyPem: string;
  clientId: string;
  clientSecret: string;
  apiUrl: string;
  webUrl: string;
}

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/** RS256 App JWT: issued 60 s in the past for clock skew, valid 9 minutes (GitHub's cap is 10). */
export function appJwt(appId: number, key: KeyObject, now = Date.now()): string {
  const iat = Math.floor(now / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 600, iss: String(appId) }));
  const signature = sign('RSA-SHA256', Buffer.from(`${header}.${payload}`), key);
  return `${header}.${payload}.${b64url(signature)}`;
}

type Fetch = typeof fetch;

export class FetchGithubApi implements GithubApi {
  private readonly key: KeyObject;
  private readonly tokens = new Map<string, { token: string; expiresAt: number }>();

  constructor(private readonly config: GithubAppConfig, private readonly fetcher: Fetch = fetch, private readonly now = () => Date.now()) {
    this.key = createPrivateKey(config.privateKeyPem);
  }

  get appId(): number { return this.config.appId; }

  private async call<T>(path: string, init: RequestInit & { token: string }, allow404 = false): Promise<T | null> {
    const response = await this.fetcher(`${this.config.apiUrl}${path}`, {
      ...init,
      headers: {
        accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'kase-github-app',
        authorization: `Bearer ${init.token}`, ...(init.body ? { 'content-type': 'application/json' } : {}),
      },
    });
    if (allow404 && response.status === 404) return null;
    if (!response.ok) throw new GithubApiError(response.status, `GitHub ${init.method ?? 'GET'} ${path.split('?')[0]} failed with ${response.status}`);
    return response.status === 204 ? null : await response.json() as T;
  }

  private async installationToken(ref: RepoRef): Promise<string> {
    const cacheKey = `${ref.installationId}/${ref.owner}/${ref.repo}`;
    const cached = this.tokens.get(cacheKey);
    if (cached && cached.expiresAt - 60_000 > this.now()) return cached.token;
    const result = await this.call<{ token: string; expires_at: string }>(`/app/installations/${encodeURIComponent(ref.installationId)}/access_tokens`, {
      method: 'POST', token: appJwt(this.config.appId, this.key, this.now()),
      body: JSON.stringify({ repositories: [ref.repo], permissions: { checks: 'write', pull_requests: 'write', metadata: 'read' } }),
    });
    this.tokens.set(cacheKey, { token: result!.token, expiresAt: Date.parse(result!.expires_at) });
    return result!.token;
  }

  private repoPath(ref: RepoRef): string { return `/repos/${encodeURIComponent(ref.owner)}/${encodeURIComponent(ref.repo)}`; }

  async installationAccount(installationId: string): Promise<{ login: string }> {
    const result = await this.call<{ account: { login: string } }>(`/app/installations/${encodeURIComponent(installationId)}`, {
      token: appJwt(this.config.appId, this.key, this.now()),
    });
    return { login: result!.account.login };
  }

  async userInstallationIds(code: string): Promise<Set<string>> {
    const response = await this.fetcher(`${this.config.webUrl}/login/oauth/access_token`, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'kase-github-app' },
      body: JSON.stringify({ client_id: this.config.clientId, client_secret: this.config.clientSecret, code }),
    });
    const exchanged = response.ok ? await response.json() as { access_token?: string } : {};
    if (!exchanged.access_token) throw new GithubApiError(401, 'GitHub did not accept the installation authorization code');
    const ids = new Set<string>();
    for (let page = 1; page <= 10; page++) {
      const result = await this.call<{ installations: Array<{ id: number }> }>(`/user/installations?per_page=100&page=${page}`, { token: exchanged.access_token });
      for (const installation of result!.installations) ids.add(String(installation.id));
      if (result!.installations.length < 100) break;
    }
    return ids;
  }

  async createCheckRun(ref: RepoRef, input: { headSha: string; externalId: string; detailsUrl: string | null; title: string; summary: string }): Promise<{ id: number }> {
    const result = await this.call<{ id: number }>(`${this.repoPath(ref)}/check-runs`, {
      method: 'POST', token: await this.installationToken(ref),
      body: JSON.stringify({ name: 'Kase gate', head_sha: input.headSha, status: 'in_progress', external_id: input.externalId,
        started_at: new Date(this.now()).toISOString(), ...(input.detailsUrl ? { details_url: input.detailsUrl } : {}),
        output: { title: input.title, summary: input.summary } }),
    });
    return { id: result!.id };
  }

  async completeCheckRun(ref: RepoRef, checkRunId: string, input: { conclusion: CheckConclusion; title: string; summary: string; text: string; annotations: CheckAnnotation[] }): Promise<void> {
    await this.call(`${this.repoPath(ref)}/check-runs/${encodeURIComponent(checkRunId)}`, {
      method: 'PATCH', token: await this.installationToken(ref),
      body: JSON.stringify({ status: 'completed', conclusion: input.conclusion, completed_at: new Date(this.now()).toISOString(),
        output: { title: input.title, summary: input.summary, text: input.text, annotations: input.annotations } }),
    });
  }

  async appendAnnotations(ref: RepoRef, checkRunId: string, input: { title: string; summary: string; annotations: CheckAnnotation[] }): Promise<void> {
    await this.call(`${this.repoPath(ref)}/check-runs/${encodeURIComponent(checkRunId)}`, {
      method: 'PATCH', token: await this.installationToken(ref),
      body: JSON.stringify({ output: { title: input.title, summary: input.summary, annotations: input.annotations } }),
    });
  }

  async listIssueComments(ref: RepoRef, prNumber: number): Promise<IssueComment[]> {
    const token = await this.installationToken(ref);
    const out: IssueComment[] = [];
    for (let page = 1; page <= 30; page++) {
      const rows = await this.call<Array<{ id: number; body?: string; performed_via_github_app?: { id: number } | null }>>(
        `${this.repoPath(ref)}/issues/${prNumber}/comments?per_page=100&page=${page}`, { token });
      for (const row of rows!) out.push({ id: row.id, body: row.body ?? '', appId: row.performed_via_github_app?.id ?? null });
      if (rows!.length < 100) break;
    }
    return out;
  }

  async createIssueComment(ref: RepoRef, prNumber: number, body: string): Promise<{ id: number }> {
    const result = await this.call<{ id: number }>(`${this.repoPath(ref)}/issues/${prNumber}/comments`, {
      method: 'POST', token: await this.installationToken(ref), body: JSON.stringify({ body }),
    });
    return { id: result!.id };
  }

  async updateIssueComment(ref: RepoRef, commentId: string, body: string): Promise<boolean> {
    const result = await this.call<{ id: number }>(`${this.repoPath(ref)}/issues/comments/${encodeURIComponent(commentId)}`, {
      method: 'PATCH', token: await this.installationToken(ref), body: JSON.stringify({ body }),
    }, true);
    return result !== null;
  }
}
