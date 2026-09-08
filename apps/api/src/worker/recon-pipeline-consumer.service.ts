import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { AuditEventsService } from '../audit-events/audit-events.service';
import { AuditJobLifecycleService, DEFAULT_HEARTBEAT_MS } from '../orchestrator/audit-job-lifecycle.service';
import { CancellationSignalRegistry } from '../orchestrator/cancellation-signal.registry';
import type { ReconAuditJobPayload } from '../orchestrator/audit-job.payload';
import { withJobTimeout } from '../queue/job-timeout.util';
import { workerOptionsFor } from '../queue/queue.config';
import {
  QUEUE_HTTPX_VERIFY, QUEUE_INVENTORY_DRIFT, QUEUE_INVENTORY_MERGE,
  QUEUE_KATANA_DISCOVER, QUEUE_SCOPE_FILTER,
} from '../queue/queue.constants';
import { KatanaAdapter, parseKatanaJsonl } from '../adapters/recon/katana.adapter';
import { HttpxAdapter, parseHttpxJsonl } from '../adapters/recon/httpx.adapter';
import { ReconScopeService, type ReconScopePolicy } from '../recon/recon-scope.service';
import { ReconBudgetService } from '../recon/recon-budget.service';
import { HostRateLeaseService } from '../recon/host-rate-lease.service';
import { ReconEvidenceService } from '../recon/recon-evidence.service';
import { InventoryService } from '../recon/inventory.service';
import type { VerifiedEndpointCandidate } from '../recon/recon.types';
import { PermanentJobError } from '../orchestrator/retry-policy';

const QUEUES = [QUEUE_KATANA_DISCOVER, QUEUE_SCOPE_FILTER, QUEUE_HTTPX_VERIFY, QUEUE_INVENTORY_MERGE, QUEUE_INVENTORY_DRIFT] as const;

@Injectable()
export class ReconPipelineConsumerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReconPipelineConsumerService.name);
  private readonly workers: Worker<ReconAuditJobPayload>[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: AuditJobLifecycleService,
    private readonly cancellations: CancellationSignalRegistry,
    private readonly katana: KatanaAdapter,
    private readonly httpx: HttpxAdapter,
    private readonly scope: ReconScopeService,
    private readonly budget: ReconBudgetService,
    private readonly hostLeases: HostRateLeaseService,
    private readonly evidence: ReconEvidenceService,
    private readonly inventory: InventoryService,
    private readonly trail: AuditTrailService,
    private readonly events: AuditEventsService,
  ) {}

  onModuleInit(): void {
    for (const queue of QUEUES) {
      const worker = new Worker<ReconAuditJobPayload>(queue, (job) => this.process(job), workerOptionsFor(queue));
      worker.on('failed', (job, error) => this.logger.error(`${queue} job ${job?.id ?? 'unknown'} failed: ${error.message}`));
      this.workers.push(worker);
    }
    this.logger.log('M3 recon pipeline workers ready');
  }

  async onApplicationShutdown(): Promise<void> { await Promise.all(this.workers.map((worker) => worker.close())); }

  private async process(job: Job<ReconAuditJobPayload>): Promise<void> {
    const payload = job.data;
    assertPayload(payload);
    const storedJob = await this.lifecycle.claim(payload);
    if (!storedJob) return;
    // A claimed job normally has a lease, but retain a bounded fallback for a
    // legacy/recovered row so a reservation can never receive an unbounded
    // active lifetime.
    const reservationLeaseExpiresAt = storedJob.leaseExpiresAt ?? new Date(Date.now() + DEFAULT_HEARTBEAT_MS * 3);
    const cancellation = this.cancellations.watch(payload.auditId);
    const ownership = new AbortController();
    const refreshLease = async () => {
      try {
        const renewed = await this.lifecycle.heartbeat(payload.auditJobId, DEFAULT_HEARTBEAT_MS * 3, storedJob.attempts);
        if (!renewed) { ownership.abort(new Error('Recon job lease was lost')); return; }
        await this.budget.renewForJob(payload.auditJobId, new Date(Date.now() + DEFAULT_HEARTBEAT_MS * 3));
      } catch (error) { ownership.abort(error); }
    };
    const heartbeat = setInterval(() => void refreshLease(), DEFAULT_HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      await withJobTimeout(payload.auditJobId, storedJob.timeoutMs, async (timeoutSignal) => {
        const signal = AbortSignal.any([timeoutSignal, cancellation.signal, ownership.signal]);
        const context = await this.context(payload);
        switch (storedJob.kind) {
          case 'katana_discover': await this.discover(payload, context, signal, reservationLeaseExpiresAt, storedJob.attempts); break;
          case 'scope_filter': await this.filter(payload, context, signal, storedJob.attempts); break;
          case 'httpx_verify': await this.verify(payload, context, signal, reservationLeaseExpiresAt, storedJob.attempts); break;
          case 'inventory_merge': await this.merge(payload, signal, storedJob.attempts); break;
          case 'inventory_drift': await this.inventory.computeDrift(payload.auditId, payload.projectId, signal, payload.auditJobId, storedJob.attempts); break;
          default: throw new PermanentJobError(`Unexpected M3 recon job kind: ${storedJob.kind}`);
        }
      });
      await this.lifecycle.succeed(payload, storedJob.attempts);
    } catch (error) {
      await this.lifecycle.fail(payload, error, storedJob.attempts);
      throw error;
    } finally {
      clearInterval(heartbeat);
      cancellation.close();
    }
  }

  private async context(payload: ReconAuditJobPayload) {
    const audit = await this.prisma.audit.findFirst({ where: { id: payload.auditId, projectId: payload.projectId }, include: { target: true } });
    if (!audit?.target) throw new PermanentJobError('Recon pipeline requires a target');
    const policy = await this.prisma.scopePolicy.findFirst({ where: { projectId: payload.projectId }, orderBy: { authorizationAttestedAt: 'desc' } });
    if (!policy) throw new PermanentJobError('Recon pipeline requires an attested scope policy');
    const proxyUrl = process.env.KASE_EGRESS_PROXY;
    if (!proxyUrl) throw new PermanentJobError('KASE_EGRESS_PROXY is required; direct target access is forbidden');
    const scopePolicy: ReconScopePolicy = { allowedHosts: policy.allowedHosts, deniedPaths: policy.deniedPaths, targetBaseUrl: audit.target.baseUrl };
    const preflight = this.scope.check(audit.target.baseUrl, scopePolicy);
    if (!preflight.allowed) throw new PermanentJobError(`Target failed recon scope validation: ${preflight.reason}`);
    return { audit, policy, proxyUrl, scopePolicy, hostAndPort: new URL(audit.target.baseUrl).host.toLowerCase() };
  }

  private async discover(payload: ReconAuditJobPayload, context: Awaited<ReturnType<ReconPipelineConsumerService['context']>>, signal: AbortSignal, leaseExpiresAt: Date, attempt: number) {
    if (await this.evidence.hasLive(payload.auditId, 'crawl_result')) return;
    const reservation = await this.budget.reserve({ auditId: payload.auditId, auditJobId: payload.auditJobId, stage: 'katana', requested: 500, leaseExpiresAt });
    if (reservation.granted < 1) throw new PermanentJobError('Recon request budget exhausted before Katana');
    const started = Date.now();
    let consumed = 0;
    let lease: Awaited<ReturnType<HostRateLeaseService['acquire']>> | undefined;
    try {
      lease = await this.hostLeases.acquire(context.hostAndPort, signal);
      signal = AbortSignal.any([signal, lease.signal]);
      if (signal.aborted) throw abortError();
      await this.events.append(payload.auditId, 'recon.host_lease.acquired', { host: context.hostAndPort, stage: 'katana' });
      const nativeScope = this.scope.katanaScope(context.scopePolicy);
      consumed = reservation.granted;
      const result = await this.katana.run({ targetUrl: context.audit.target!.baseUrl, proxyUrl: context.proxyUrl,
        rateLimit: context.policy.maxRequestsPerSecond, maxPages: reservation.granted, ...nativeScope, signal });
      consumed = Math.min(reservation.granted, result.requestCount);
      await this.evidence.persist({ ...payload, attempt, tool: 'katana', toolVersion: process.env.KASE_KATANA_VERSION ?? '1.6.1',
        type: 'crawl_result', replayable: false, raw: result.rawJsonl, requestCount: consumed,
        durationMs: Date.now() - started, metadata: { candidateCount: result.candidates.length }, signal });
    } catch (error) {
      // Coordination loss is infrastructure failure, not user cancellation.
      if (lease?.signal.aborted) throw lease.signal.reason;
      throw error;
    } finally {
      try {
        await lease?.release();
        if (lease && !signal.aborted) await this.events.append(payload.auditId, 'recon.host_lease.released', { host: context.hostAndPort, stage: 'katana' });
      } finally { await this.budget.settle(reservation, consumed); }
    }
  }

  private async filter(payload: ReconAuditJobPayload, context: Awaited<ReturnType<ReconPipelineConsumerService['context']>>, signal: AbortSignal, attempt: number) {
    const raw = await this.evidence.load(payload.auditId, 'crawl_result');
    const candidates = parseKatanaJsonl(raw);
    const accepted = new Map<string, { url: string; method: string; source: string }>();
    for (const candidate of candidates) {
      const decision = this.scope.check(candidate.url, context.scopePolicy);
      if (!decision.allowed || !decision.url) {
        await this.recordDenial(payload, candidate.url, decision.reason ?? 'invalid_url', candidate.source, signal, attempt);
        continue;
      }
      accepted.set(`${candidate.method.toUpperCase()} ${decision.url}`, { ...candidate, url: decision.url });
    }
    if (signal.aborted) throw abortError();
    await this.evidence.persist({ ...payload, attempt, tool: 'kase-scope', toolVersion: '1', type: 'recon_candidates', replayable: false,
      raw: JSON.stringify([...accepted.values()]), requestCount: 0, durationMs: 0,
      metadata: { accepted: accepted.size, denied: candidates.length - accepted.size }, signal });
  }

  private async verify(payload: ReconAuditJobPayload, context: Awaited<ReturnType<ReconPipelineConsumerService['context']>>, signal: AbortSignal, leaseExpiresAt: Date, attempt: number) {
    if (await this.evidence.hasLive(payload.auditId, 'httpx_jsonl')) return;
    const candidates = JSON.parse(await this.evidence.load(payload.auditId, 'recon_candidates')) as Array<{ url: string; method: string; source: string }>;
    const reservation = await this.budget.reserve({ auditId: payload.auditId, auditJobId: payload.auditJobId, stage: 'httpx', requested: candidates.length, leaseExpiresAt });
    if (reservation.granted < 1 && candidates.length > 0) throw new PermanentJobError('Recon request budget exhausted before httpx');
    const selected = candidates.slice(0, reservation.granted);
    const started = Date.now();
    let consumed = 0;
    let lease: Awaited<ReturnType<HostRateLeaseService['acquire']>> | undefined;
    try {
      lease = await this.hostLeases.acquire(context.hostAndPort, signal);
      signal = AbortSignal.any([signal, lease.signal]);
      if (signal.aborted) throw abortError();
      await this.events.append(payload.auditId, 'recon.host_lease.acquired', { host: context.hostAndPort, stage: 'httpx' });
      consumed = selected.length;
      const result = await this.httpx.run({ candidates: selected, proxyUrl: context.proxyUrl, rateLimit: context.policy.maxRequestsPerSecond, signal });
      const combined = [...result.results];
      const rawJsonl = [result.rawJsonl];
      const redirects: Array<{ url: string; method: string; source: string }> = [];
      for (const response of result.results) {
        if (!response.redirectLocation) continue;
        const absolute = new URL(response.redirectLocation, response.url).toString();
        const decision = this.scope.check(absolute, context.scopePolicy);
        if (!decision.allowed || !decision.url) await this.recordDenial(payload, absolute, decision.reason ?? 'invalid_url', 'httpx_redirect', signal, attempt);
        else redirects.push({ url: decision.url, method: 'GET', source: 'httpx_redirect' });
      }
      if (redirects.length > 0) {
        const redirectReservation = await this.budget.reserve({ auditId: payload.auditId, auditJobId: payload.auditJobId, stage: 'httpx_redirect', requested: redirects.length, leaseExpiresAt });
        const follow = redirects.slice(0, redirectReservation.granted);
        if (follow.length > 0) {
          try {
            const followed = await this.httpx.run({ candidates: follow, proxyUrl: context.proxyUrl, rateLimit: context.policy.maxRequestsPerSecond, signal });
            combined.push(...followed.results);
            rawJsonl.push(followed.rawJsonl);
          } finally { await this.budget.settle(redirectReservation, follow.length); }
        }
      }
      await this.evidence.persist({ ...payload, attempt, tool: 'httpx', toolVersion: process.env.KASE_HTTPX_VERSION ?? '1.10.0',
        type: 'httpx_jsonl', replayable: true, raw: rawJsonl.filter(Boolean).join('\n'), requestCount: selected.length,
        durationMs: Date.now() - started, metadata: { verified: combined.length }, signal });
    } catch (error) {
      if (lease?.signal.aborted) throw lease.signal.reason;
      throw error;
    } finally {
      try {
        await lease?.release();
        if (lease && !signal.aborted) await this.events.append(payload.auditId, 'recon.host_lease.released', { host: context.hostAndPort, stage: 'httpx' });
      } finally { await this.budget.settle(reservation, consumed); }
    }
  }

  private async merge(payload: ReconAuditJobPayload, signal: AbortSignal, attempt: number) {
    const discovered = JSON.parse(await this.evidence.load(payload.auditId, 'recon_candidates')) as Array<{ url: string; method: string; source: string }>;
    const verified = parseHttpxJsonl(await this.evidence.load(payload.auditId, 'httpx_jsonl'));
    const results: VerifiedEndpointCandidate[] = [
      ...discovered.map((candidate) => ({ ...candidate, technologies: [] as string[] })),
      ...verified,
    ];
    await this.inventory.merge(payload.auditId, payload.projectId, results, signal, payload.auditJobId, attempt);
  }

  private async recordDenial(payload: ReconAuditJobPayload, rawUrl: string, reason: string, source: string, signal: AbortSignal, attempt: number): Promise<void> {
    if (signal.aborted) throw abortError();
    const writable = await this.prisma.auditJob.findFirst({ where: {
      id: payload.auditJobId, auditId: payload.auditId, status: 'running', attempts: attempt,
      audit: { is: { projectId: payload.projectId, cancellationRequestedAt: null } },
    }, select: { id: true } });
    if (!writable) throw abortError();
    const url = this.scope.canonicalDeniedUrl(rawUrl);
    const resourceId = `${payload.auditId}:${url ?? `invalid:${source}`}`;
    const exists = await this.prisma.auditTrailEvent.findFirst({ where: {
      projectId: payload.projectId, action: 'worker.egress.denied', resourceType: 'DiscoveredUrl', resourceId,
    } });
    if (exists) return;
    if (signal.aborted) throw abortError();
    const safe = url ? new URL(url) : null;
    const data = { url, host: safe?.hostname ?? null, path: safe?.pathname ?? null, reason, source, auditJobId: payload.auditJobId };
    await this.trail.record({ projectId: payload.projectId, actorType: 'system', action: 'worker.egress.denied',
      resourceType: 'DiscoveredUrl', resourceId, metadata: data, outcome: 'denied' });
    await this.events.append(payload.auditId, 'scope.denied', data);
  }
}

function assertPayload(payload: ReconAuditJobPayload): void {
  const keys = Object.keys(payload).sort();
  if (JSON.stringify(keys) !== JSON.stringify(['auditId', 'auditJobId', 'projectId']) || keys.some((key) => typeof payload[key as keyof ReconAuditJobPayload] !== 'string')) {
    throw new Error('Queue payload must contain auditId, auditJobId, and projectId only');
  }
}

function abortError(): Error { const error = new Error('Audit cancellation requested'); error.name = 'AbortError'; return error; }
