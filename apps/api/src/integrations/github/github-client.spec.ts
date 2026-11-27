import { createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { FetchGithubApi, GithubApiError, appJwt } from './github-client';
import { normalizeRepoUrl, pullRequestEventSchema, signInstallState, verifyInstallState, verifyWebhookSignature } from './github-security';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const PEM = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const NOW = Date.parse('2026-11-27T12:00:00Z');
const REF = { installationId: '42', owner: 'acme', repo: 'web' };

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fakeFetch(routes: Array<(call: Call) => Response | undefined>) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: RequestInit = {}) => {
    const call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    for (const route of routes) { const response = route(call); if (response) return response; }
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch;
  return { fn, calls };
}
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });

function api(routes: Array<(call: Call) => Response | undefined>) {
  const fake = fakeFetch([
    c => (c.url.endsWith('/app/installations/42/access_tokens') ? json({ token: 'ghs_installation', expires_at: new Date(NOW + 3600_000).toISOString() }, 201) : undefined),
    ...routes,
  ]);
  const client = new FetchGithubApi({ appId: 1234, privateKeyPem: PEM, clientId: 'Iv1.client', clientSecret: 'shh', apiUrl: 'https://api.github.test', webUrl: 'https://github.test' }, fake.fn, () => NOW);
  return { client, calls: fake.calls };
}

describe('GitHub App JWT and client', () => {
  it('signs an RS256 App JWT that verifies with the app public key', () => {
    const jwt = appJwt(1234, privateKey, NOW);
    const [header, payload, signature] = jwt.split('.');
    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString());
    expect(claims).toEqual({ iss: '1234', iat: NOW / 1000 - 60, exp: NOW / 1000 + 540 });
    expect(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url'))).toBe(true);
  });

  it('mints an installation token scoped to one repository and minimal permissions, and caches it', async () => {
    const { client, calls } = api([c => (c.url.includes('/check-runs') ? json({ id: 7 }, 201) : undefined)]);
    await client.createCheckRun(REF, { headSha: 'a'.repeat(40), externalId: 'aud_1', detailsUrl: null, title: 't', summary: 's' });
    await client.createCheckRun(REF, { headSha: 'b'.repeat(40), externalId: 'aud_2', detailsUrl: 'https://kase.test/x', title: 't', summary: 's' });
    const tokenCalls = calls.filter(c => c.url.endsWith('/access_tokens'));
    expect(tokenCalls).toHaveLength(1);
    expect(tokenCalls[0].body).toEqual({ repositories: ['web'], permissions: { checks: 'write', pull_requests: 'write', metadata: 'read' } });
    expect(tokenCalls[0].headers.authorization).toMatch(/^Bearer ey/u);
    const create = calls.filter(c => c.url === 'https://api.github.test/repos/acme/web/check-runs');
    expect(create[0].headers.authorization).toBe('Bearer ghs_installation');
    expect(create[0].body).toMatchObject({ name: 'Kase gate', head_sha: 'a'.repeat(40), status: 'in_progress', external_id: 'aud_1' });
    expect(create[0].body).not.toHaveProperty('details_url');
    expect(create[1].body).toMatchObject({ details_url: 'https://kase.test/x' });
  });

  it('completes a check run with conclusion, output and annotations', async () => {
    const { client, calls } = api([c => (c.method === 'PATCH' && c.url.endsWith('/check-runs/7') ? json({ id: 7 }) : undefined)]);
    await client.completeCheckRun(REF, '7', { conclusion: 'neutral', title: 'T', summary: 'S', text: 'X',
      annotations: [{ path: 'a.ts', start_line: 1, end_line: 1, annotation_level: 'failure', title: 't', message: 'm' }] });
    const patch = calls.find(c => c.method === 'PATCH')!;
    expect(patch.body).toMatchObject({ status: 'completed', conclusion: 'neutral', output: { title: 'T', summary: 'S', text: 'X', annotations: [{ path: 'a.ts' }] } });
  });

  it('pages through PR comments and reports a deleted comment as missing', async () => {
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i, body: 'x', performed_via_github_app: null }));
    const { client } = api([
      c => (c.url.includes('/issues/5/comments?per_page=100&page=1') ? json(page1) : undefined),
      c => (c.url.includes('/issues/5/comments?per_page=100&page=2') ? json([{ id: 500, body: '<!-- kase:pr-audit -->', performed_via_github_app: { id: 1234 } }]) : undefined),
      c => (c.method === 'PATCH' && c.url.endsWith('/issues/comments/500') ? json({ id: 500 }) : undefined),
    ]);
    const comments = await client.listIssueComments(REF, 5);
    expect(comments).toHaveLength(101);
    expect(comments[100]).toEqual({ id: 500, body: '<!-- kase:pr-audit -->', appId: 1234 });
    await expect(client.updateIssueComment(REF, '500', 'new')).resolves.toBe(true);
    await expect(client.updateIssueComment(REF, '999', 'new')).resolves.toBe(false);
  });

  it('exchanges the install OAuth code and lists the installations that user can see', async () => {
    const { client, calls } = api([
      c => (c.url === 'https://github.test/login/oauth/access_token' ? json({ access_token: 'ghu_user' }) : undefined),
      c => (c.url.startsWith('https://api.github.test/user/installations') ? json({ installations: [{ id: 42 }, { id: 43 }] }) : undefined),
    ]);
    await expect(client.userInstallationIds('code123')).resolves.toEqual(new Set(['42', '43']));
    expect(calls[0].body).toEqual({ client_id: 'Iv1.client', client_secret: 'shh', code: 'code123' });
    expect(calls[1].headers.authorization).toBe('Bearer ghu_user');
  });

  it('raises a typed error on a failed call, without leaking the token', async () => {
    const { client } = api([c => (c.url.includes('/check-runs') ? new Response('nope', { status: 422 }) : undefined)]);
    const error = await client.createCheckRun(REF, { headSha: 'a', externalId: 'x', detailsUrl: null, title: 't', summary: 's' }).catch(e => e);
    expect(error).toBeInstanceOf(GithubApiError);
    expect(error.status).toBe(422);
    expect(error.message).not.toContain('ghs_');
    const { client: denied } = api([c => (c.url.includes('/login/oauth') ? json({ error: 'bad_verification_code' }) : undefined)]);
    await expect(denied.userInstallationIds('bad')).rejects.toMatchObject({ status: 401 });
  });
});

describe('GitHub webhook and install security', () => {
  const body = Buffer.from('{"action":"opened"}');
  const sign = (secret: string, raw: Buffer) => `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;

  it('accepts only the HMAC of the exact raw body', () => {
    expect(verifyWebhookSignature('s3cret', body, sign('s3cret', body))).toBe(true);
    expect(verifyWebhookSignature('s3cret', Buffer.from('{"action":"opened" }'), sign('s3cret', body))).toBe(false);
    expect(verifyWebhookSignature('other', body, sign('s3cret', body))).toBe(false);
    expect(verifyWebhookSignature('s3cret', body, undefined)).toBe(false);
    expect(verifyWebhookSignature('s3cret', undefined, sign('s3cret', body))).toBe(false);
    expect(verifyWebhookSignature('s3cret', body, 'sha1=abc')).toBe(false);
    expect(verifyWebhookSignature('', body, sign('', body))).toBe(false);
  });

  it('install state round-trips, and rejects tampering, another key and expiry', () => {
    const now = new Date(NOW);
    const state = signInstallState('key', { projectId: 'prj_1', actorId: 'usr_1' }, now);
    expect(verifyInstallState('key', state, now)).toEqual({ projectId: 'prj_1', actorId: 'usr_1' });
    expect(verifyInstallState('other', state, now)).toBeNull();
    const [payload, mac] = state.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url').toString()), projectId: 'prj_victim' })).toString('base64url');
    expect(verifyInstallState('key', `${forged}.${mac}`, now)).toBeNull();
    expect(verifyInstallState('key', state, new Date(NOW + 11 * 60_000))).toBeNull();
    expect(verifyInstallState('key', 'garbage', now)).toBeNull();
    expect(verifyInstallState('key', `${state}.extra`, now)).toBeNull();
  });

  it('normalises repository URLs for matching', () => {
    expect(normalizeRepoUrl('https://github.com/Acme/Web.git')).toBe('github.com/acme/web');
    expect(normalizeRepoUrl('https://github.com/acme/web/')).toBe('github.com/acme/web');
    expect(normalizeRepoUrl('not a url')).toBeNull();
  });

  it('rejects a pull_request payload whose head SHA is not a full commit id', () => {
    const base = { action: 'opened', installation: { id: 1 }, repository: { id: 1, full_name: 'a/b', name: 'b', html_url: 'https://github.com/a/b', owner: { login: 'a' } },
      pull_request: { number: 1, head: { sha: 'a'.repeat(40), repo: { id: 1, full_name: 'a/b' } }, base: { repo: { id: 1 } } } };
    expect(pullRequestEventSchema.safeParse(base).success).toBe(true);
    expect(pullRequestEventSchema.safeParse({ ...base, pull_request: { ...base.pull_request, head: { sha: 'main; rm -rf /', repo: null } } }).success).toBe(false);
  });
});
