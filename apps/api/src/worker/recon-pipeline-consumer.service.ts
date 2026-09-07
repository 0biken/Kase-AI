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
    const cancellation = this.cancellations.watch(payload.auditId);
    const heartbeat = setInterval(() => void this.lifecycle.heartbeat(payload.auditJobId), DEFAULT_HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      await withJobTimeout(payload.auditJobId, storedJob.timeoutMs, async (timeoutSignal) => {
        const signal = AbortSignal.any([timeoutSignal, cancellation.signal]);
        const context = await this.context(payload);
        switch (storedJob.kind) {
          case 'katana_discover': await this.discover(payload, context, signal); break;
          case 'scope_filter': await this.filter(payload, context, signal); break;
          case 'httpx_verify': await this.verify(payload, context, signal); break;
          case 'inventory_merge': await this.merge(payload, signal); break;
          case 'inventory_drift': await this.inventory.computeDrift(payload.auditId, payload.projectId, signal); break;
          default: throw new PermanentJobError(`Unexpected M3 recon job kind: ${storedJob.kind}`);
        }
      });
      await this.lifecycle.succeed(payload);
    } catch (error) {
      await this.lifecycle.fail(payload, error);
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

  private async discover(payload: ReconAuditJobPayload, context: Awaited<ReturnType<ReconPipelineConsumerService['context']>>, signal: AbortSignal) {
    const reserved = await this.budget.reserve(payload.auditId, 500);
    if (reserved < 1) throw new PermanentJobError('Recon request budget exhausted before Katana');
    const started = Date.now();
    let consumed = 0;
    let lease: Awaited<ReturnType<HostRateLeaseService['acquire']>> | undefined;
    try {
      lease = await this.hostLeases.acquire(context.hostAndPort, signal);
      signal = AbortSignal.any([signal, lease.signal]);
      if (signal.aborted) throw abortError();
      await this.events.append(payload.auditId, 'recon.host_lease.acquired', { host: context.hostAndPort, stage: 'katana' });
      const nativeScope = this.scope.katanaScope(context.scopePolicy);
      consumed = reserved;
      const result = await this.katana.run({ targetUrl: context.audit.target!.baseUrl, proxyUrl: context.proxyUrl,
        rateLimit: context.policy.maxRequestsPerSecond, maxPages: reserved, ...nativeScope, signal });
      consumed = Math.min(reserved, result.requestCount);
      await this.evidence.persist({ ...payload, tool: 'katana', toolVersion: process.env.KASE_KATANA_VERSION ?? '1.6.1',
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
      } finally { await this.budget.settle(payload.auditId, reserved, consumed); }
    }
  }

  private async filter(payload: ReconAuditJobPayload, context: Awaited<ReturnType<ReconPipelineConsumerService['context']>>, signal: AbortSignal) {
    const raw = await this.evidence.load(payload.auditId, 'crawl_result');
    const candidates = parseKatanaJsonl(raw);
    const accepted = new Map<string, { url: string; method: string; source: string }>();
    for (const candidate of candidates) {
      const decision = this.scope.check(candidate.url, context.scopePolicy);
      if (!decision.allowed || !decision.url) {
        await this.recordDenial(payload, candidate.url, decision.reason ?? 'invalid_url', candidate.source, signal);
        continue;
      }
      accepted.set(`${candidate.method.toUpperCase()} ${decision.url}`, { ...candidate, url: decision.url });
    }
    if (signal.aborted) throw abortError();
    await this.evidence.persist({ ...payload, tool: 'kase-scope', toolVersion: '1', type: 'recon_candidates', replayable: false,
      raw: JSON.stringify([...accepted.values()]), requestCount: 0, durationMs: 0,
      metadata: { accepted: accepted.size, denied: candidates.length - accepted.size }, signal });
  }

  private async verify(payload: ReconAuditJobPayload, context: Awaited<ReturnType<ReconPipelineConsumerService['context']>>, signal: AbortSignal) {
    const candidates = JSON.parse(await this.evidence.load(payload.auditId, 'recon_candidates')) as Array<{ url: string; method: string; source: string }>;
    const reserved = await this.budget.reserve(payload.auditId, candidates.length);
    if (reserved < 1 && candidates.length > 0) throw new PermanentJobError('Recon request budget exhausted before httpx');
    const selected = candidates.slice(0, reserved);
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
        if (!decision.allowed || !decision.url) await this.recordDenial(payload, absolute, decision.reason ?? 'invalid_url', 'httpx_redirect', signal);
        else redirects.push({ url: decision.url, method: 'GET', source: 'httpx_redirect' });
      }
      if (redirects.length > 0) {
        const redirectReservation = await this.budget.reserve(payload.auditId, redirects.length);
        const follow = redirects.slice(0, redirectReservation);
        if (follow.length > 0) {
          try {
            const followed = await this.httpx.run({ candidates: follow, proxyUrl: context.proxyUrl, rateLimit: context.policy.maxRequestsPerSecond, signal });
            combined.push(...followed.results);
            rawJsonl.push(followed.rawJsonl);
          } finally { await this.budget.settle(payload.auditId, redirectReservation, follow.length); }
        }
      }
      await this.evidence.persist({ ...payload, tool: 'httpx', toolVersion: process.env.KASE_HTTPX_VERSION ?? '1.10.0',
        type: 'httpx_jsonl', replayable: true, raw: rawJsonl.filter(Boolean).join('\n'), requestCount: selected.length,
        durationMs: Date.now() - started, metadata: { verified: combined.length }, signal });
    } catch (error) {
      if (lease?.signal.aborted) throw lease.signal.reason;
      throw error;
    } finally {
      try {
        await lease?.release();
        if (lease && !signal.aborted) await this.events.append(payload.auditId, 'recon.host_lease.released', { host: context.hostAndPort, stage: 'httpx' });
      } finally { await this.budget.settle(payload.auditId, reserved, consumed); }
    }
  }

  private async merge(payload: ReconAuditJobPayload, signal: AbortSignal) {
    const discovered = JSON.parse(await this.evidence.load(payload.auditId, 'recon_candidates')) as Array<{ url: string; method: string; source: string }>;
    const verified = parseHttpxJsonl(await this.evidence.load(payload.auditId, 'httpx_jsonl'));
    const results: VerifiedEndpointCandidate[] = [
      ...discovered.map((candidate) => ({ ...candidate, technologies: [] as string[] })),
      ...verified,
    ];
    await this.inventory.merge(payload.auditId, payload.projectId, results, signal);
  }

  private async recordDenial(payload: ReconAuditJobPayload, rawUrl: string, reason: string, source: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw abortError();
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
