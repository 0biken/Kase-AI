import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditTrailService } from '../../audit-trail/audit-trail.service';
import { newId } from '../../common/ids';
import { ProblemException } from '../../common/problem-details';
import type { Actor } from '../../projects/projects.service';
import { OrchestratorService } from '../../orchestrator/orchestrator.service';
import { GateEvaluationService } from '../../assurance/gate/gate-evaluation.service';
import { ReportService } from '../../assurance/report/report.service';
import { inline } from '../../assurance/report/report-builder';
import type { GateDecision } from '../../assurance/gate/gate-engine';
import { GITHUB_API, GITHUB_SETTINGS, type GithubIntegrationSettings } from './github-config';
import type { GithubApi, RepoRef } from './github-client';
import {
  ANNOTATIONS_PER_REQUEST, COMMENT_MARKER, inProgressOutput, renderCheckOutput, renderPrComment,
  type PrFinding, type PrPublishInput,
} from './github-render';
import {
  normalizeRepoUrl, signInstallState, verifyInstallState,
  type CheckRunEvent, type PullRequestEvent,
} from './github-security';

export const GITHUB_ACTOR: Actor = { type: 'system', id: 'github-app' };
const PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened', 'ready_for_review']);
const TERMINAL = ['completed', 'partial', 'failed', 'cancelled'];
const MAX_ATTEMPTS = 5;
const LEASE_MS = 5 * 60_000;

export interface GithubConfigInput { mode: 'security' | 'full'; targetId?: string | null; partialIsFailure?: boolean; auditForks?: boolean }
export type WebhookResult = { status: 'ignored'; reason: string } | { status: 'started' | 'duplicate'; auditId: string }
  | { status: 'not_started'; reason: string } | { status: 'regate'; auditId: string } | { status: 'pong' };

/** A repository-relative path GitHub can annotate: no absolute paths, no `..`, no backslashes. */
function annotatablePath(file: string): string | null {
  const path = file.replace(/^\.\//u, '');
  if (!path || path.startsWith('/') || /\\|(^|\/)\.\.(\/|$)|^[a-z]:/iu.test(path)) return null;
  return path;
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\b(gh[pousr]_[A-Za-z0-9]{20,}|Bearer\s+\S+)/gu, '[redacted]').slice(0, 500);
}

/**
 * The GitHub App flow (13-integrations §1, PLAN-M4-M7 §4.3):
 *
 * 1. A PR opens or updates → start an audit at the head SHA (`ci_supplied`
 *    provenance) and create the check run as `in_progress`.
 * 2. The reconciler sees the audit settle → evaluate the gate, build the
 *    report, complete the check run with annotations at verified locations,
 *    and upsert the one Kase comment on the PR.
 *
 * Step 2 runs from a lease-guarded reconcile loop rather than a callback from
 * the scheduler, so it survives restarts, runs on any API instance, and
 * retries a GitHub outage without losing the result.
 */
@Injectable()
export class GithubIntegrationService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('GithubIntegration');
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrailService,
    private readonly orchestrator: OrchestratorService,
    private readonly gate: GateEvaluationService,
    private readonly reports: ReportService,
    @Optional() @Inject(GITHUB_SETTINGS) private readonly settings: GithubIntegrationSettings | null,
    @Optional() @Inject(GITHUB_API) private readonly api: GithubApi | null,
  ) {}

  get enabled(): boolean { return !!this.settings && !!this.api; }

  onModuleInit(): void {
    if (!this.enabled || process.env.NODE_ENV === 'test') return;
    this.timer = setInterval(() => { void this.tick(); }, this.settings!.reconcileIntervalMs);
    this.timer.unref();
  }

  onModuleDestroy(): void { if (this.timer) clearInterval(this.timer); }

  private async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try { await this.reconcile(); } catch (error) { this.log.warn(`reconcile failed: ${safeError(error)}`); } finally { this.running = false; }
  }

  private require(): { settings: GithubIntegrationSettings; api: GithubApi } {
    if (!this.settings || !this.api) throw new ProblemException('NOT_FOUND', 'The GitHub App is not configured on this Kase deployment');
    return { settings: this.settings, api: this.api };
  }

  /* ------------------------------ install --------------------------------- */

  installUrl(projectId: string, actor: Actor): { url: string } {
    const { settings } = this.require();
    const state = signInstallState(settings.stateKey, { projectId, actorId: actor.id ?? 'unknown' });
    return { url: `${settings.app.webUrl}/apps/${encodeURIComponent(settings.slug)}/installations/new?state=${encodeURIComponent(state)}` };
  }

  /**
   * GitHub's post-install redirect. The installation is bound to the project
   * only when the signed `state` names it AND the installing GitHub user's own
   * OAuth token can see the installation. A crafted callback naming someone
   * else's installation id fails the second check.
   */
  async completeInstall(query: { installationId?: string; code?: string; state?: string; setupAction?: string }, now = new Date()) {
    const { settings, api } = this.require();
    const bound = verifyInstallState(settings.stateKey, query.state, now);
    if (!bound) throw new ProblemException('FORBIDDEN', 'The installation link is invalid or has expired; start again from Kase');
    if (query.setupAction === 'request') return { status: 'requested' as const, projectId: bound.projectId };
    if (!query.installationId || !/^\d{1,20}$/u.test(query.installationId) || !query.code) {
      throw new ProblemException('VALIDATION_FAILED', 'GitHub did not return an installation id and authorization code');
    }
    const visible = await api.userInstallationIds(query.code);
    if (!visible.has(query.installationId)) {
      await this.trail.record({ projectId: bound.projectId, actorType: 'user', actorId: bound.actorId, action: 'github.install',
        resourceType: 'GithubInstallation', resourceId: query.installationId, metadata: { reason: 'installation_not_visible_to_user' }, outcome: 'denied' });
      throw new ProblemException('FORBIDDEN', 'That GitHub installation is not accessible to the user who authorized it');
    }
    const existing = await this.prisma.githubInstallation.findUnique({ where: { installationId: query.installationId } });
    if (existing && existing.projectId !== bound.projectId) {
      throw new ProblemException('CONFLICT', 'This GitHub installation is already connected to another Kase project');
    }
    const account = await api.installationAccount(query.installationId);
    const row = existing ?? await this.prisma.githubInstallation.create({ data: {
      id: newId('githubInstallation'), projectId: bound.projectId, installationId: query.installationId,
      accountLogin: account.login, installedBy: bound.actorId,
    } });
    await this.trail.record({ projectId: bound.projectId, actorType: 'user', actorId: bound.actorId, action: 'github.install',
      resourceType: 'GithubInstallation', resourceId: row.id, metadata: { installationId: query.installationId, account: account.login }, outcome: 'allowed' });
    return { status: 'installed' as const, projectId: bound.projectId, account: account.login,
      redirect: settings.dashboardUrl ? `${settings.dashboardUrl}/dashboard?github=installed` : null };
  }

  async status(projectId: string) {
    const [installations, config] = await Promise.all([
      this.prisma.githubInstallation.findMany({ where: { projectId }, orderBy: { createdAt: 'asc' } }),
      this.prisma.githubIntegrationConfig.findUnique({ where: { projectId } }),
    ]);
    return {
      enabled: this.enabled,
      installations: installations.map(i => ({ id: i.id, installationId: i.installationId, account: i.accountLogin, createdAt: i.createdAt })),
      config: config ?? { projectId, mode: 'security', targetId: null, partialIsFailure: false, auditForks: false },
    };
  }

  async configure(projectId: string, input: GithubConfigInput, actor: Actor) {
    if (input.mode === 'full' && !input.targetId) throw new ProblemException('VALIDATION_FAILED', 'Full PR audits need a targetId running the PR build');
    if (input.targetId) {
      const target = await this.prisma.target.findFirst({ where: { id: input.targetId, projectId } });
      if (!target) throw new ProblemException('NOT_FOUND', 'Target does not belong to this project');
    }
    const data = { mode: input.mode, targetId: input.targetId ?? null, partialIsFailure: input.partialIsFailure ?? false,
      auditForks: input.auditForks ?? false, updatedBy: actor.id ?? 'unknown' };
    const row = await this.prisma.githubIntegrationConfig.upsert({ where: { projectId }, create: { projectId, ...data }, update: data });
    await this.trail.record({ projectId, actorType: actor.type, actorId: actor.id, action: 'github.configure',
      resourceType: 'GithubIntegrationConfig', resourceId: projectId, diff: data, outcome: 'allowed' });
    return row;
  }

  /* ------------------------------ webhook --------------------------------- */

  async handlePullRequest(event: PullRequestEvent): Promise<WebhookResult> {
    const { api, settings } = this.require();
    if (!PR_ACTIONS.has(event.action)) return { status: 'ignored', reason: `action ${event.action}` };
    if (event.pull_request.draft) return { status: 'ignored', reason: 'draft pull request' };

    const installationId = String(event.installation.id);
    const installation = await this.prisma.githubInstallation.findUnique({ where: { installationId } });
    if (!installation) return { status: 'ignored', reason: 'installation is not connected to a Kase project' };
    const projectId = installation.projectId;

    const wanted = normalizeRepoUrl(event.repository.html_url);
    const repositories = await this.prisma.repository.findMany({ where: { projectId } });
    const repository = repositories.find(r => normalizeRepoUrl(r.url) === wanted);
    if (!repository) return { status: 'ignored', reason: 'repository is not registered in the connected project' };

    const config = await this.prisma.githubIntegrationConfig.findUnique({ where: { projectId } });
    const ref: RepoRef = { installationId, owner: event.repository.owner.login, repo: event.repository.name };
    const pr = event.pull_request;
    const headSha = pr.head.sha;
    const fork = !pr.head.repo || pr.head.repo.id !== pr.base.repo.id;

    if (fork && !config?.auditForks) {
      await this.publishWithoutAudit(ref, headSha, 'neutral', 'Kase: fork PR not audited',
        'Pull requests from forks are not audited automatically, because they bring untrusted code to the audit agents. A project admin can enable fork audits.');
      return { status: 'ignored', reason: 'fork pull request' };
    }

    const idempotencyKey = `github:${installationId}:${event.repository.id}:${pr.number}:${headSha}`;
    let audit: { id: string };
    try {
      audit = await this.orchestrator.dispatch(projectId, {
        mode: config?.mode === 'full' ? 'full' : 'security', repositoryId: repository.id,
        ...(config?.targetId ? { targetId: config.targetId } : {}), commitSha: headSha,
      } as never, idempotencyKey, GITHUB_ACTOR);
    } catch (error) {
      // Fail closed and visibly: a PR whose audit could not start is not green.
      const detail = error instanceof ProblemException ? (error.detail ?? error.message) : 'internal error';
      await this.publishWithoutAudit(ref, headSha, 'failure', 'Kase could not start the audit', `The audit for this commit could not be started: ${inline(detail)}`);
      await this.trail.record({ projectId, actorType: 'system', actorId: GITHUB_ACTOR.id, action: 'github.audit.start',
        resourceType: 'Repository', resourceId: repository.id, metadata: { pr: pr.number, headSha, error: safeError(error) }, outcome: 'error' });
      return { status: 'not_started', reason: detail };
    }

    // The row is created before the check run so a redelivered webhook cannot
    // create a second one; a missing check run is created by the reconciler.
    try {
      await this.prisma.githubPrCheck.create({ data: {
        id: newId('githubPrCheck'), auditId: audit.id, projectId, installationId, owner: ref.owner, repo: ref.repo,
        prNumber: pr.number, headSha, state: 'pending',
      } });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') return { status: 'duplicate', auditId: audit.id };
      throw error;
    }
    try {
      const check = await api.createCheckRun(ref, { headSha, externalId: audit.id, detailsUrl: this.detailsUrl(settings, audit.id), ...inProgressOutput(audit.id) });
      await this.prisma.githubPrCheck.update({ where: { auditId: audit.id }, data: { checkRunId: String(check.id) } });
    } catch (error) {
      this.log.warn(`could not create the in-progress check run for ${audit.id}: ${safeError(error)}`);
    }
    await this.trail.record({ projectId, actorType: 'system', actorId: GITHUB_ACTOR.id, action: 'github.audit.start',
      resourceType: 'Audit', resourceId: audit.id, metadata: { owner: ref.owner, repo: ref.repo, pr: pr.number, headSha }, outcome: 'allowed' });
    return { status: 'started', auditId: audit.id };
  }

  /**
   * "Re-run" on Kase's check re-evaluates the gate for the same audit, which
   * picks up waivers approved since. It does not re-run the audit.
   */
  async handleCheckRun(event: CheckRunEvent): Promise<WebhookResult> {
    const { api } = this.require();
    if (event.action !== 'rerequested') return { status: 'ignored', reason: `action ${event.action}` };
    if (event.check_run.app && event.check_run.app.id !== api.appId) return { status: 'ignored', reason: 'not a Kase check run' };
    const auditId = event.check_run.external_id ?? '';
    const row = await this.prisma.githubPrCheck.findUnique({ where: { auditId } });
    if (!row || row.installationId !== String(event.installation.id) || row.owner !== event.repository.owner.login || row.repo !== event.repository.name) {
      return { status: 'ignored', reason: 'unknown check run' };
    }
    await this.prisma.githubPrCheck.update({ where: { auditId }, data: { state: 'pending', attempts: 0, leaseUntil: null, lastError: null } });
    return { status: 'regate', auditId };
  }

  /* ----------------------------- reconcile -------------------------------- */

  /** Publishes every PR check whose audit has settled. Safe to run concurrently on many instances. */
  async reconcile(now = new Date()): Promise<{ completed: number; failed: number }> {
    if (!this.enabled) return { completed: 0, failed: 0 };
    const rows = await this.prisma.githubPrCheck.findMany({
      where: { OR: [{ state: 'pending' }, { state: 'completing', leaseUntil: { lt: now } }], audit: { status: { in: TERMINAL } } },
      orderBy: { createdAt: 'asc' }, take: 10,
    });
    let completed = 0;
    let failed = 0;
    for (const row of rows) {
      const claim = await this.prisma.githubPrCheck.updateMany({
        where: { id: row.id, state: row.state, leaseUntil: row.leaseUntil },
        data: { state: 'completing', leaseUntil: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } },
      });
      if (claim.count !== 1) continue;
      try {
        await this.publish(row, now);
        completed++;
      } catch (error) {
        const attempts = row.attempts + 1;
        const giveUp = attempts >= MAX_ATTEMPTS;
        await this.prisma.githubPrCheck.update({ where: { id: row.id }, data: {
          state: giveUp ? 'failed' : 'pending', leaseUntil: null, lastError: safeError(error),
        } });
        if (giveUp) {
          failed++;
          await this.publishFailure(row).catch(() => undefined);
        }
        this.log.warn(`publishing ${row.auditId} failed (attempt ${attempts}): ${safeError(error)}`);
      }
    }
    return { completed, failed };
  }

  private async publish(row: { id: string; auditId: string; projectId: string; installationId: string; owner: string; repo: string; prNumber: number; headSha: string; checkRunId: string | null; commentId: string | null }, now: Date): Promise<void> {
    const { api, settings } = this.require();
    const ref: RepoRef = { installationId: row.installationId, owner: row.owner, repo: row.repo };
    const { evaluation, decision } = await this.gate.evaluate(row.auditId, GITHUB_ACTOR, now) as { evaluation: { gatePolicyVersion?: number }; decision: GateDecision };
    const [report, audit, config] = await Promise.all([
      this.reports.build(row.auditId, now),
      this.prisma.audit.findUniqueOrThrow({ where: { id: row.auditId } }),
      this.prisma.githubIntegrationConfig.findUnique({ where: { projectId: row.projectId } }),
    ]);

    const input: PrPublishInput = {
      decision, policyVersion: evaluation.gatePolicyVersion ?? 0, report,
      audit: { id: audit.id, mode: audit.mode, status: audit.status, commitSha: audit.requestedCommitSha ?? row.headSha,
        startedAt: audit.startedAt, completedAt: audit.completedAt,
        requestedCategories: Math.max(audit.requestedCategories.length, audit.executedCategories.length), executedCategories: audit.executedCategories.length },
      findings: await this.prFindings(row.auditId, decision),
      partialIsFailure: config?.partialIsFailure ?? false,
      reportUrl: this.detailsUrl(settings, row.auditId),
    };
    const output = renderCheckOutput(input);

    let checkRunId = row.checkRunId;
    if (!checkRunId) {
      checkRunId = String((await api.createCheckRun(ref, { headSha: row.headSha, externalId: row.auditId, detailsUrl: input.reportUrl, ...inProgressOutput(row.auditId) })).id);
    }
    const [first, ...rest] = chunk(output.annotations, ANNOTATIONS_PER_REQUEST);
    await api.completeCheckRun(ref, checkRunId, { conclusion: output.conclusion, title: output.title, summary: output.summary, text: output.text, annotations: first ?? [] });
    for (const batch of rest) await api.appendAnnotations(ref, checkRunId, { title: output.title, summary: output.summary, annotations: batch });

    const commentId = await this.upsertComment(ref, row.prNumber, row.commentId, renderPrComment(input));
    await this.prisma.githubPrCheck.update({ where: { id: row.id }, data: {
      state: 'completed', conclusion: output.conclusion, checkRunId, commentId, completedAt: now, leaseUntil: null, lastError: null,
    } });
    await this.trail.record({ projectId: row.projectId, actorType: 'system', actorId: GITHUB_ACTOR.id, action: 'github.check.completed',
      resourceType: 'Audit', resourceId: row.auditId, metadata: { outcome: decision.outcome, conclusion: output.conclusion, pr: row.prNumber,
        annotations: output.annotations.length }, outcome: 'allowed' });
  }

  /**
   * One Kase comment per PR. Only a comment Kase's own app authored counts, so
   * a human pasting the marker into their comment cannot get it overwritten.
   */
  private async upsertComment(ref: RepoRef, prNumber: number, knownId: string | null, body: string): Promise<string> {
    const api = this.api!;
    if (knownId && await api.updateIssueComment(ref, knownId, body)) return knownId;
    const ours = (await api.listIssueComments(ref, prNumber)).find(c => c.appId === api.appId && c.body.includes(COMMENT_MARKER));
    if (ours && await api.updateIssueComment(ref, String(ours.id), body)) return String(ours.id);
    return String((await api.createIssueComment(ref, prNumber, body)).id);
  }

  /** Titles and verified locations for the findings the gate names. Unverified locations are left out. */
  private async prFindings(auditId: string, decision: GateDecision): Promise<Map<string, PrFinding>> {
    const ids = [...new Set([...decision.blocking.map(b => b.findingId), ...decision.warnings.flatMap(w => (w.findingId ? [w.findingId] : []))])];
    if (!ids.length) return new Map();
    const [rows, correlations] = await Promise.all([
      this.prisma.finding.findMany({ where: { auditId, id: { in: ids } }, include: { sourceLocations: true } }),
      this.prisma.correlation.findMany({ where: { auditId } }),
    ]);
    const correlated = new Map<string, boolean>();
    for (const c of correlations) {
      for (const id of [c.blackboxFindingId, c.whiteboxFindingId]) if (id) correlated.set(id, (correlated.get(id) ?? true) && c.verified);
    }
    return new Map(rows.map(f => {
      const src = f.sourceLocations.find(s => s.verified);
      const path = src ? annotatablePath(src.file) : null;
      const trusted = !!src && !!path && correlated.get(f.id) !== false;
      return [f.id, { id: f.id, title: f.title, severity: f.severity,
        location: trusted ? { file: path!, line: Math.max(1, src!.line), endLine: src!.endLine ?? null, symbol: src!.enclosingSymbol } : null }];
    }));
  }

  private async publishWithoutAudit(ref: RepoRef, headSha: string, conclusion: 'neutral' | 'failure', title: string, summary: string): Promise<void> {
    const api = this.api!;
    try {
      const check = await api.createCheckRun(ref, { headSha, externalId: 'none', detailsUrl: null, title, summary });
      await api.completeCheckRun(ref, String(check.id), { conclusion, title, summary, text: '', annotations: [] });
    } catch (error) {
      this.log.warn(`could not publish "${title}" on ${ref.owner}/${ref.repo}: ${safeError(error)}`);
    }
  }

  private async publishFailure(row: { installationId: string; owner: string; repo: string; checkRunId: string | null; auditId: string }): Promise<void> {
    if (!row.checkRunId) return;
    const title = 'Kase could not publish the gate result';
    await this.api!.completeCheckRun({ installationId: row.installationId, owner: row.owner, repo: row.repo }, row.checkRunId, {
      conclusion: 'failure', title, summary: `Kase evaluated audit \`${row.auditId}\` but could not publish the result after ${MAX_ATTEMPTS} attempts. Re-run this check to try again.`,
      text: '', annotations: [],
    });
  }

  private detailsUrl(settings: GithubIntegrationSettings, auditId: string): string | null {
    return settings.dashboardUrl ? `${settings.dashboardUrl}/dashboard/audits/${encodeURIComponent(auditId)}` : null;
  }
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}
