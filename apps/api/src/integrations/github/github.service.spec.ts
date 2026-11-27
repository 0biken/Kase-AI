import { createHmac } from 'node:crypto';
import { ProblemException } from '../../common/problem-details';
import type { GateDecision } from '../../assurance/gate/gate-engine';
import type { GithubApi, IssueComment, RepoRef } from './github-client';
import type { GithubIntegrationSettings } from './github-config';
import { COMMENT_MARKER } from './github-render';
import { GithubIntegrationService } from './github.service';
import { GithubWebhookController } from './github.controller';
import { pullRequestEventSchema, signInstallState, type PullRequestEvent } from './github-security';

const NOW = new Date('2026-11-27T12:00:00Z');
const SHA = 'c'.repeat(40);
const APP_ID = 1234;

const SETTINGS: GithubIntegrationSettings = {
  app: { appId: APP_ID, privateKeyPem: 'unused', clientId: 'id', clientSecret: 'secret', apiUrl: 'https://api.github.test', webUrl: 'https://github.test' },
  slug: 'kase-test', webhookSecret: 'whsec', stateKey: 'state-key', dashboardUrl: 'https://kase.test', reconcileIntervalMs: 15_000,
};

class FakeGithub implements GithubApi {
  readonly appId = APP_ID;
  calls: Array<[string, ...unknown[]]> = [];
  comments: IssueComment[] = [];
  nextCheckId = 100;
  failComplete = 0;
  visible = new Set(['42']);
  async installationAccount() { return { login: 'acme' }; }
  async userInstallationIds(code: string) { this.calls.push(['userInstallationIds', code]); return this.visible; }
  async createCheckRun(ref: RepoRef, input: unknown) { this.calls.push(['createCheckRun', ref, input]); return { id: this.nextCheckId++ }; }
  async completeCheckRun(ref: RepoRef, id: string, input: unknown) {
    this.calls.push(['completeCheckRun', id, input]);
    if (this.failComplete > 0) { this.failComplete--; throw new Error('GitHub PATCH failed with 502 (Bearer ghs_abcdefghijklmnopqrstuvwxyz)'); }
  }
  async appendAnnotations(ref: RepoRef, id: string, input: unknown) { this.calls.push(['appendAnnotations', id, input]); }
  async listIssueComments() { this.calls.push(['listIssueComments']); return this.comments; }
  async createIssueComment(ref: RepoRef, pr: number, body: string) { this.calls.push(['createIssueComment', pr, body]); return { id: 900 }; }
  async updateIssueComment(ref: RepoRef, id: string, body: string) {
    this.calls.push(['updateIssueComment', id, body]);
    return this.comments.some(c => String(c.id) === id) || id === '900';
  }
  named(name: string) { return this.calls.filter(c => c[0] === name); }
}

function harness(opts: { decision?: GateDecision; installation?: boolean; config?: Record<string, unknown> | null; dispatchError?: Error } = {}) {
  const installations = opts.installation === false ? [] : [{ id: 'ghi_1', projectId: 'prj_1', installationId: '42', accountLogin: 'acme', installedBy: 'usr_1', createdAt: NOW }];
  const checks: Array<Record<string, any>> = [];
  const audits = new Map<string, Record<string, any>>();
  const trail: Array<Record<string, unknown>> = [];
  let config = opts.config === undefined ? null : opts.config;
  const prisma = {
    githubInstallation: {
      findUnique: jest.fn(async ({ where }) => installations.find(i => i.installationId === where.installationId) ?? null),
      findMany: jest.fn(async () => installations),
      create: jest.fn(async ({ data }) => { installations.push({ ...data, createdAt: NOW }); return data; }),
    },
    repository: { findMany: jest.fn(async () => [{ id: 'repo_1', projectId: 'prj_1', url: 'https://github.com/Acme/Web.git' }]) },
    githubIntegrationConfig: {
      findUnique: jest.fn(async () => config),
      upsert: jest.fn(async ({ create }) => { config = create; return create; }),
    },
    target: { findFirst: jest.fn(async ({ where }) => (where.id === 'tgt_1' ? { id: 'tgt_1' } : null)) },
    githubPrCheck: {
      create: jest.fn(async ({ data }) => {
        if (checks.some(c => c.auditId === data.auditId)) throw Object.assign(new Error('unique'), { code: 'P2002' });
        const row = { checkRunId: null, commentId: null, attempts: 0, leaseUntil: null, lastError: null, conclusion: null, createdAt: NOW, ...data };
        checks.push(row);
        return row;
      }),
      findUnique: jest.fn(async ({ where }) => checks.find(c => c.auditId === where.auditId) ?? null),
      update: jest.fn(async ({ where, data }) => {
        const row = checks.find(c => (where.id ? c.id === where.id : c.auditId === where.auditId))!;
        Object.assign(row, data);
        return row;
      }),
      findMany: jest.fn(async ({ where }) => checks.filter(c =>
        (c.state === 'pending' || (c.state === 'completing' && c.leaseUntil && c.leaseUntil < where.OR[1].leaseUntil.lt))
        && where.audit.status.in.includes(audits.get(c.auditId)?.status)).map(c => ({ ...c }))),
      updateMany: jest.fn(async ({ where, data }) => {
        const row = checks.find(c => c.id === where.id && c.state === where.state && (c.leaseUntil?.getTime() ?? null) === (where.leaseUntil?.getTime() ?? null));
        if (!row) return { count: 0 };
        Object.assign(row, { ...data, attempts: row.attempts + 1 });
        return { count: 1 };
      }),
    },
    audit: { findUniqueOrThrow: jest.fn(async ({ where }) => audits.get(where.id)) },
    finding: { findMany: jest.fn(async () => [
      { id: 'fnd_1', title: 'IDOR on invoices', severity: 'critical', sourceLocations: [{ file: 'src/invoices.ts', line: 42, endLine: null, enclosingSymbol: 'Invoices.find', verified: true }] },
      { id: 'fnd_2', title: 'Unverified correlation', severity: 'high', sourceLocations: [{ file: 'src/other.ts', line: 3, endLine: null, enclosingSymbol: 'O.x', verified: true }] },
      { id: 'fnd_3', title: 'Absolute path', severity: 'high', sourceLocations: [{ file: '/etc/passwd', line: 1, endLine: null, enclosingSymbol: 'x', verified: true }] },
    ]) },
    correlation: { findMany: jest.fn(async () => [{ blackboxFindingId: 'fnd_2', whiteboxFindingId: null, verified: false }]) },
  };
  const keys = new Map<string, string>();
  const orchestrator = { dispatch: jest.fn(async (projectId: string, dto: Record<string, unknown>, key: string) => {
    if (opts.dispatchError) throw opts.dispatchError;
    if (!keys.has(key)) {
      const id = `aud_${keys.size + 1}`;
      keys.set(key, id);
      audits.set(id, { id, mode: dto.mode, status: 'running', requestedCommitSha: dto.commitSha, startedAt: NOW, completedAt: null, requestedCategories: ['sast'], executedCategories: [] });
    }
    return { id: keys.get(key)! };
  }) };
  const decision = opts.decision ?? {
    outcome: 'fail', mode: 'full', degraded: false, notExecutedCategories: [], waived: [], warnings: [],
    blocking: [
      { findingId: 'fnd_1', fingerprint: 'fp1', severity: 'critical', category: 'authz', rule: 'block_on[0]', evidence: [{ id: 'ev_1', class: 'http_replay', replayResult: 'reproduced' }], sourceLocation: { file: 'src/invoices.ts', enclosingSymbol: 'Invoices.find', verified: true } },
      { findingId: 'fnd_2', fingerprint: 'fp2', severity: 'high', category: 'authz', rule: 'block_on[0]', evidence: [], sourceLocation: null },
      { findingId: 'fnd_3', fingerprint: 'fp3', severity: 'high', category: 'authz', rule: 'block_on[0]', evidence: [], sourceLocation: null },
    ],
  } as GateDecision;
  const gate = { evaluate: jest.fn(async () => ({ evaluation: { gatePolicyVersion: 3 }, decision })) };
  const reports = { build: jest.fn(async () => ({ summary: { counts: { critical: 1, high: 2, medium: 0, low: 0, info: 0 }, mustFix: [], gate: null, expiringWaivers: [] } })) };
  const github = new FakeGithub();
  const service = new GithubIntegrationService(prisma as never, { record: async (e: Record<string, unknown>) => { trail.push(e); } } as never,
    orchestrator as never, gate as never, reports as never, SETTINGS, github);
  const settle = (auditId: string, status = 'completed') => { Object.assign(audits.get(auditId)!, { status, completedAt: new Date(NOW.getTime() + 5 * 60_000), executedCategories: ['sast'] }); };
  return { service, prisma, orchestrator, gate, github, checks, trail, settle };
}

function prEvent(over: Partial<PullRequestEvent['pull_request']> = {}, action = 'opened'): PullRequestEvent {
  return pullRequestEventSchema.parse({
    action, installation: { id: 42 },
    repository: { id: 7, full_name: 'acme/web', name: 'web', html_url: 'https://github.com/acme/web', owner: { login: 'acme' } },
    pull_request: { number: 5, draft: false, head: { sha: SHA, repo: { id: 7, full_name: 'acme/web' } }, base: { repo: { id: 7 } }, ...over },
  });
}

describe('GithubIntegrationService — pull requests', () => {
  it('starts an audit at the head SHA and creates an in-progress check run', async () => {
    const h = harness();
    await expect(h.service.handlePullRequest(prEvent())).resolves.toEqual({ status: 'started', auditId: 'aud_1' });
    expect(h.orchestrator.dispatch).toHaveBeenCalledWith('prj_1', { mode: 'security', repositoryId: 'repo_1', commitSha: SHA },
      `github:42:7:5:${SHA}`, { type: 'system', id: 'github-app' });
    const [, ref, input] = h.github.named('createCheckRun')[0] as [string, RepoRef, Record<string, unknown>];
    expect(ref).toEqual({ installationId: '42', owner: 'acme', repo: 'web' });
    expect(input).toMatchObject({ headSha: SHA, externalId: 'aud_1', detailsUrl: 'https://kase.test/dashboard/audits/aud_1', title: 'Kase audit running' });
    expect(h.checks[0]).toMatchObject({ auditId: 'aud_1', prNumber: 5, headSha: SHA, state: 'pending', checkRunId: '100' });
  });

  it('a redelivered webhook neither starts a second audit nor creates a second check run', async () => {
    const h = harness();
    await h.service.handlePullRequest(prEvent());
    await expect(h.service.handlePullRequest(prEvent())).resolves.toEqual({ status: 'duplicate', auditId: 'aud_1' });
    expect(h.github.named('createCheckRun')).toHaveLength(1);
  });

  it('ignores drafts, other actions, unbound installations and unregistered repositories', async () => {
    const h = harness();
    await expect(h.service.handlePullRequest(prEvent({ draft: true }))).resolves.toMatchObject({ status: 'ignored', reason: 'draft pull request' });
    await expect(h.service.handlePullRequest(prEvent({}, 'closed'))).resolves.toMatchObject({ status: 'ignored' });
    await expect(harness({ installation: false }).service.handlePullRequest(prEvent())).resolves.toMatchObject({ reason: 'installation is not connected to a Kase project' });
    const other = prEvent();
    other.repository.html_url = 'https://github.com/acme/other';
    await expect(h.service.handlePullRequest(other)).resolves.toMatchObject({ reason: 'repository is not registered in the connected project' });
    expect(h.orchestrator.dispatch).not.toHaveBeenCalled();
  });

  it('does not audit fork PRs by default, and says so with a neutral check', async () => {
    const h = harness();
    const fork = prEvent({ head: { sha: SHA, repo: { id: 99, full_name: 'evil/web' } } });
    await expect(h.service.handlePullRequest(fork)).resolves.toMatchObject({ status: 'ignored', reason: 'fork pull request' });
    expect(h.orchestrator.dispatch).not.toHaveBeenCalled();
    expect(h.github.named('completeCheckRun')[0][2]).toMatchObject({ conclusion: 'neutral', title: 'Kase: fork PR not audited' });
    const allowed = harness({ config: { mode: 'security', targetId: null, partialIsFailure: false, auditForks: true } });
    await expect(allowed.service.handlePullRequest(fork)).resolves.toMatchObject({ status: 'started' });
  });

  it('fails closed with a failure check when the audit cannot start', async () => {
    const h = harness({ dispatchError: new ProblemException('SCOPE_VIOLATION', 'Target host "x" is not allowlisted') });
    await expect(h.service.handlePullRequest(prEvent())).resolves.toMatchObject({ status: 'not_started' });
    const complete = h.github.named('completeCheckRun')[0][2] as Record<string, string>;
    expect(complete).toMatchObject({ conclusion: 'failure', title: 'Kase could not start the audit' });
    expect(complete.summary).toContain('not allowlisted');
    expect(h.trail.find(e => e.action === 'github.audit.start')).toMatchObject({ outcome: 'error' });
  });

  it('uses the configured mode and target', async () => {
    const h = harness({ config: { mode: 'full', targetId: 'tgt_1', partialIsFailure: false, auditForks: false } });
    await h.service.handlePullRequest(prEvent());
    expect(h.orchestrator.dispatch.mock.calls[0][1]).toEqual({ mode: 'full', repositoryId: 'repo_1', targetId: 'tgt_1', commitSha: SHA });
  });
});

describe('GithubIntegrationService — reconcile', () => {
  async function started(opts: Parameters<typeof harness>[0] = {}) {
    const h = harness(opts);
    await h.service.handlePullRequest(prEvent());
    return h;
  }

  it('waits for the audit to settle, then completes the check and creates one comment', async () => {
    const h = await started();
    await expect(h.service.reconcile(NOW)).resolves.toEqual({ completed: 0, failed: 0 });
    h.settle('aud_1');
    await expect(h.service.reconcile(NOW)).resolves.toEqual({ completed: 1, failed: 0 });
    const [, checkId, output] = h.github.named('completeCheckRun')[0] as [string, string, Record<string, any>];
    expect(checkId).toBe('100');
    expect(output.conclusion).toBe('failure');
    expect(output.title).toBe('Kase gate: FAIL — 3 blocking findings');
    // Only the finding with a verified location and no unverified correlation, at a repo-relative path, is annotated.
    expect(output.annotations).toEqual([expect.objectContaining({ path: 'src/invoices.ts', start_line: 42, annotation_level: 'failure' })]);
    const [, pr, body] = h.github.named('createIssueComment')[0] as [string, number, string];
    expect(pr).toBe(5);
    expect(body.startsWith(COMMENT_MARKER)).toBe(true);
    expect(body).toContain('`block_on[0]`');
    expect(h.checks[0]).toMatchObject({ state: 'completed', conclusion: 'failure', commentId: '900', lastError: null });
    expect(h.trail.find(e => e.action === 'github.check.completed')).toMatchObject({ outcome: 'allowed' });
    await expect(h.service.reconcile(NOW)).resolves.toEqual({ completed: 0, failed: 0 });
  });

  it('PARTIAL publishes neutral, or failure when the project treats partial as blocking — never success', async () => {
    const partial = { outcome: 'partial', mode: 'full', degraded: true, notExecutedCategories: [], waived: [], warnings: [], blocking: [] } as GateDecision;
    const neutral = await started({ decision: partial });
    neutral.settle('aud_1', 'partial');
    await neutral.service.reconcile(NOW);
    expect((neutral.github.named('completeCheckRun')[0][2] as Record<string, string>).conclusion).toBe('neutral');
    const strict = await started({ decision: partial, config: { mode: 'security', targetId: null, partialIsFailure: true, auditForks: false } });
    strict.settle('aud_1', 'partial');
    await strict.service.reconcile(NOW);
    expect((strict.github.named('completeCheckRun')[0][2] as Record<string, string>).conclusion).toBe('failure');
  });

  it('updates its own comment in place and never one a human wrote with the marker', async () => {
    const h = await started();
    h.github.comments = [
      { id: 1, body: `${COMMENT_MARKER} pasted by a human`, appId: null },
      { id: 2, body: `${COMMENT_MARKER} older Kase comment`, appId: APP_ID },
    ];
    h.settle('aud_1');
    await h.service.reconcile(NOW);
    expect(h.github.named('createIssueComment')).toHaveLength(0);
    expect(h.github.named('updateIssueComment').map(c => c[1])).toEqual(['2']);
    expect(h.checks[0].commentId).toBe('2');
  });

  it('a new push gets its own audit and check, and the same comment is updated', async () => {
    const h = await started();
    h.settle('aud_1');
    await h.service.reconcile(NOW);
    const next = 'd'.repeat(40);
    await expect(h.service.handlePullRequest(prEvent({ head: { sha: next, repo: { id: 7, full_name: 'acme/web' } } }, 'synchronize'))).resolves.toMatchObject({ status: 'started', auditId: 'aud_2' });
    h.github.comments = [{ id: 900, body: `${COMMENT_MARKER} first`, appId: APP_ID }];
    h.settle('aud_2');
    await h.service.reconcile(NOW);
    expect(h.github.named('createIssueComment')).toHaveLength(1);
    expect(h.github.named('updateIssueComment').map(c => c[1])).toEqual(['900']);
  });

  it('batches annotations beyond 50 per request', async () => {
    const blocking = Array.from({ length: 120 }, (_, i) => ({ findingId: `fnd_${i}`, fingerprint: `fp${i}`, severity: 'high', category: 'x', rule: 'r', evidence: [], sourceLocation: null }));
    const h = await started({ decision: { outcome: 'fail', mode: 'full', degraded: false, notExecutedCategories: [], waived: [], warnings: [], blocking } as GateDecision });
    h.prisma.finding.findMany.mockResolvedValue(blocking.map(b => ({ id: b.findingId, title: b.findingId, severity: 'high',
      sourceLocations: [{ file: `src/${b.findingId}.ts`, line: 1, endLine: null, enclosingSymbol: 's', verified: true }] })) as never);
    h.prisma.correlation.findMany.mockResolvedValue([] as never);
    h.settle('aud_1');
    await h.service.reconcile(NOW);
    expect((h.github.named('completeCheckRun')[0][2] as { annotations: unknown[] }).annotations).toHaveLength(50);
    expect(h.github.named('appendAnnotations').map(c => (c[2] as { annotations: unknown[] }).annotations.length)).toEqual([50, 20]);
  });

  it('retries a GitHub failure, redacts tokens from the stored error, and gives up visibly after five attempts', async () => {
    const h = await started();
    h.settle('aud_1');
    h.github.failComplete = 1;
    await expect(h.service.reconcile(NOW)).resolves.toEqual({ completed: 0, failed: 0 });
    expect(h.checks[0]).toMatchObject({ state: 'pending', attempts: 1 });
    expect(h.checks[0].lastError).toContain('[redacted]');
    expect(h.checks[0].lastError).not.toContain('ghs_');
    await expect(h.service.reconcile(NOW)).resolves.toEqual({ completed: 1, failed: 0 });

    const doomed = await started();
    doomed.settle('aud_1');
    doomed.github.failComplete = 5;
    for (let i = 0; i < 5; i++) await doomed.service.reconcile(NOW);
    expect(doomed.checks[0]).toMatchObject({ state: 'failed', attempts: 5 });
    const last = doomed.github.named('completeCheckRun').at(-1)![2] as Record<string, string>;
    expect(last).toMatchObject({ conclusion: 'failure', title: 'Kase could not publish the gate result' });
  });

  it('a check run lost at start is created when the result is published', async () => {
    const h = harness();
    const create = h.github.createCheckRun.bind(h.github);
    h.github.createCheckRun = jest.fn().mockRejectedValueOnce(new Error('GitHub down')).mockImplementation(create);
    await h.service.handlePullRequest(prEvent());
    expect(h.checks[0].checkRunId).toBeNull();
    h.settle('aud_1');
    await h.service.reconcile(NOW);
    expect(h.checks[0]).toMatchObject({ state: 'completed', checkRunId: '100' });
  });

  it('only one of two concurrent reconcilers publishes', async () => {
    const h = await started();
    h.settle('aud_1');
    await Promise.all([h.service.reconcile(NOW), h.service.reconcile(NOW)]);
    expect(h.github.named('completeCheckRun')).toHaveLength(1);
  });

  it('"Re-run" on the check re-evaluates the gate without a new audit', async () => {
    const h = await started();
    h.settle('aud_1');
    await h.service.reconcile(NOW);
    const event = { action: 'rerequested', installation: { id: 42 }, repository: prEvent().repository, check_run: { id: 100, external_id: 'aud_1', app: { id: APP_ID } } };
    await expect(h.service.handleCheckRun(event)).resolves.toEqual({ status: 'regate', auditId: 'aud_1' });
    await h.service.reconcile(NOW);
    expect(h.gate.evaluate).toHaveBeenCalledTimes(2);
    expect(h.orchestrator.dispatch).toHaveBeenCalledTimes(1);
    await expect(h.service.handleCheckRun({ ...event, check_run: { ...event.check_run, app: { id: 1 } } })).resolves.toMatchObject({ status: 'ignored' });
    await expect(h.service.handleCheckRun({ ...event, installation: { id: 43 } })).resolves.toMatchObject({ reason: 'unknown check run' });
  });
});

describe('GithubIntegrationService — install', () => {
  const state = () => signInstallState(SETTINGS.stateKey, { projectId: 'prj_2', actorId: 'usr_admin' }, NOW);

  it('binds an installation only when the installing user can see it', async () => {
    const h = harness({ installation: false });
    const result = await h.service.completeInstall({ installationId: '42', code: 'oauth', state: state() }, NOW);
    expect(result).toMatchObject({ status: 'installed', projectId: 'prj_2', account: 'acme', redirect: 'https://kase.test/dashboard?github=installed' });
    expect(h.prisma.githubInstallation.create).toHaveBeenCalledWith({ data: expect.objectContaining({ projectId: 'prj_2', installationId: '42', installedBy: 'usr_admin' }) });

    const crafted = harness({ installation: false });
    crafted.github.visible = new Set(['7']);
    await expect(crafted.service.completeInstall({ installationId: '42', code: 'oauth', state: state() }, NOW)).rejects.toMatchObject({ status: 403 });
    expect(crafted.prisma.githubInstallation.create).not.toHaveBeenCalled();
    expect(crafted.trail[0]).toMatchObject({ action: 'github.install', outcome: 'denied' });
  });

  it('rejects a bad or expired state, and an installation bound to another project', async () => {
    const h = harness();
    await expect(h.service.completeInstall({ installationId: '42', code: 'c', state: 'forged.state' }, NOW)).rejects.toMatchObject({ status: 403 });
    await expect(h.service.completeInstall({ installationId: '42', code: 'c', state: state() }, new Date(NOW.getTime() + 11 * 60_000))).rejects.toMatchObject({ status: 403 });
    await expect(h.service.completeInstall({ installationId: '42', code: 'c', state: state() }, NOW)).rejects.toMatchObject({ status: 409 });
    await expect(h.service.completeInstall({ installationId: 'abc', code: 'c', state: state() }, NOW)).rejects.toMatchObject({ status: 422 });
    await expect(h.service.completeInstall({ setupAction: 'request', state: state() }, NOW)).resolves.toMatchObject({ status: 'requested' });
  });

  it('install URL carries a signed state; config validates the target', async () => {
    const h = harness();
    const { url } = h.service.installUrl('prj_1', { type: 'user', id: 'usr_1' });
    expect(url).toMatch(/^https:\/\/github\.test\/apps\/kase-test\/installations\/new\?state=/u);
    await expect(h.service.configure('prj_1', { mode: 'full' }, { type: 'user', id: 'usr_1' })).rejects.toMatchObject({ status: 422 });
    await expect(h.service.configure('prj_1', { mode: 'full', targetId: 'tgt_other' }, { type: 'user', id: 'usr_1' })).rejects.toMatchObject({ status: 404 });
    await expect(h.service.configure('prj_1', { mode: 'full', targetId: 'tgt_1', partialIsFailure: true }, { type: 'user', id: 'usr_1' }))
      .resolves.toMatchObject({ mode: 'full', targetId: 'tgt_1', partialIsFailure: true, auditForks: false });
  });

  it('everything reports "not configured" when the app has no settings', async () => {
    const disabled = new GithubIntegrationService({} as never, {} as never, {} as never, {} as never, {} as never, null, null);
    expect(disabled.enabled).toBe(false);
    expect(() => disabled.installUrl('prj_1', { type: 'user' })).toThrow(ProblemException);
    await expect(disabled.reconcile()).resolves.toEqual({ completed: 0, failed: 0 });
  });
});

describe('GithubWebhookController', () => {
  const sign = (raw: Buffer) => `sha256=${createHmac('sha256', SETTINGS.webhookSecret).update(raw).digest('hex')}`;
  const service = { enabled: true, handlePullRequest: jest.fn(async () => ({ status: 'started', auditId: 'aud_1' })), handleCheckRun: jest.fn(async () => ({ status: 'ignored', reason: 'x' })) };
  const controller = new GithubWebhookController(service as never, SETTINGS);
  const req = (raw: Buffer) => ({ rawBody: raw }) as never;

  it('rejects an unsigned or mis-signed delivery before parsing it', async () => {
    const raw = Buffer.from(JSON.stringify(prEvent()));
    await expect(controller.webhook(req(raw), 'pull_request', undefined)).rejects.toMatchObject({ status: 401 });
    await expect(controller.webhook(req(raw), 'pull_request', sign(Buffer.from('other')))).rejects.toMatchObject({ status: 401 });
    expect(service.handlePullRequest).not.toHaveBeenCalled();
  });

  it('routes signed events and answers ping', async () => {
    const raw = Buffer.from(JSON.stringify(prEvent()));
    await expect(controller.webhook(req(raw), 'pull_request', sign(raw))).resolves.toEqual({ status: 'started', auditId: 'aud_1' });
    expect(service.handlePullRequest).toHaveBeenCalledWith(expect.objectContaining({ action: 'opened' }));
    const ping = Buffer.from('{"zen":"hi"}');
    await expect(controller.webhook(req(ping), 'ping', sign(ping))).resolves.toEqual({ status: 'pong' });
    const junk = Buffer.from('{"action":"opened"}');
    await expect(controller.webhook(req(junk), 'pull_request', sign(junk))).resolves.toMatchObject({ status: 'ignored' });
    await expect(controller.webhook(req(ping), 'issues', sign(ping))).resolves.toMatchObject({ status: 'ignored', reason: 'event issues' });
  });

  it('is unavailable when the app is not configured', async () => {
    const off = new GithubWebhookController({ enabled: false } as never, null);
    await expect(off.webhook(req(Buffer.from('{}')), 'ping', 'sha256=x')).rejects.toMatchObject({ status: 404 });
  });
});
