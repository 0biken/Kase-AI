import { RunHttpProbeSchema } from '../agent-runtime/capabilities/capability.schemas';
import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../storage/s3.service';
import { QUEUE_HTTP } from '../queue/queue.constants';
import { workerOptionsFor } from '../queue/queue.config';
import { withJobTimeout } from '../queue/job-timeout.util';
import type { ReconAuditJobPayload } from '../orchestrator/audit-job.payload';
import { AuditJobLifecycleService, DEFAULT_HEARTBEAT_MS } from '../orchestrator/audit-job-lifecycle.service';
import { CancellationSignalRegistry } from '../orchestrator/cancellation-signal.registry';
import { RetentionPolicyService } from '../retention/retention-policy.service';
import { EvidenceCaptureService } from '../evidence/evidence-capture.service';
import { deterministicId } from '../findings/finding-persistence.service';
import { runControlledProcess } from './process-control';
import { SecretsService } from '../secrets/secrets.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { isHostAllowed } from '../common/host-pattern';
import { PermanentJobError } from '../orchestrator/retry-policy';
import { materializeCurlConfig } from './curl-auth-config';
import { rm } from 'fs/promises';

@Injectable()
export class HttpJobConsumerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(HttpJobConsumerService.name);
  private worker?: Worker<ReconAuditJobPayload>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3Service,
    private readonly lifecycle: AuditJobLifecycleService,
    private readonly cancellations: CancellationSignalRegistry,
    private readonly retention: RetentionPolicyService,
    private readonly capture: EvidenceCaptureService,
    private readonly secrets: SecretsService,
    private readonly trail: AuditTrailService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker(QUEUE_HTTP, (job) => this.process(job), workerOptionsFor(QUEUE_HTTP));
    this.worker.on('failed', (job, error) => this.logger.error(`HTTP job ${job?.id ?? 'unknown'} failed: ${error.message}`));
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<ReconAuditJobPayload>): Promise<void> {
    const payload = job.data;
    const storedJob = await this.lifecycle.claim(payload);
    if (!storedJob) return;
    const cancellation = this.cancellations.watch(payload.auditId);
    const heartbeat = setInterval(() => void this.lifecycle.heartbeat(payload.auditJobId), DEFAULT_HEARTBEAT_MS);
    heartbeat.unref?.();
    let configPath: string | null = null;
    try {
      await withJobTimeout(payload.auditJobId, storedJob.timeoutMs, async (timeoutSignal) => {
        const signal = AbortSignal.any([timeoutSignal, cancellation.signal]);
        const audit = await this.prisma.audit.findFirst({
          where: { id: payload.auditId, projectId: payload.projectId }, include: { target: true },
        });
        if (!audit?.target) throw new Error('Full HTTP audits require a target');
        const proxy = process.env.KASE_EGRESS_PROXY;
        if (!proxy) throw new PermanentJobError('KASE_EGRESS_PROXY is required; direct target access is forbidden');
        const invocation = await this.prisma.agentToolInvocation.findFirst({ where: { childJobId: payload.auditJobId }, include: { agentRun: true } });
        if (invocation && invocation.agentRun.auditId !== payload.auditId) throw new PermanentJobError('Cross-audit invocation denied');
        const probe = invocation ? RunHttpProbeSchema.parse(invocation.arguments) : null;
        let url = probe?.url ?? new URL('healthz', `${audit.target.baseUrl.replace(/\/+$/u, '')}/`).toString();
        let host = new URL(url).hostname.toLowerCase();
        const policy = await this.prisma.scopePolicy.findFirst({
          where: { projectId: payload.projectId }, orderBy: { authorizationAttestedAt: 'desc' },
        });
        if (!policy || !isHostAllowed(host, policy.allowedHosts)) {
          await this.recordDenial(payload, host, 'host_not_allowed');
          throw new PermanentJobError('Worker scope validation denied the target');
        }
        const registeredSecrets: string[] = [];
        if (probe) {
          const identity = await this.prisma.testIdentity.findFirst({ where: { id: probe.testIdentityId, projectId: payload.projectId, targetId: audit.target.id, active: true }, include: { credentialSecret: true } });
          if (!identity || identity.credentialSecret.revokedAt) throw new PermanentJobError('Identity missing, inactive or revoked');
          const credential = await this.secrets.resolveForWorker(payload.projectId, identity.credentialSecretId);
          registeredSecrets.push(credential);
          configPath = await materializeCurlConfig(payload.auditJobId, audit.target.authMode === 'cookie' ? 'cookie' : 'header', credential);
        } else if (audit.target.authCredentialId) {
          const credential = await this.secrets.resolveForWorker(payload.projectId, audit.target.authCredentialId);
          registeredSecrets.push(credential);
          configPath = await materializeCurlConfig(payload.auditJobId, audit.target.authMode, credential);
        } else if (audit.target.authMode !== 'none') {
          throw new PermanentJobError('Authenticated target has no active credential');
        }
        const started = Date.now();
        const exchanges: Array<{request: unknown; response: string}> = [];
        let method = probe?.method ?? 'GET';
        let body = probe?.body;
        let result = { stdout: '', stderr: '', exitCode: 0 };
        for (let hop = 0; hop < 6; hop++) {
          host = new URL(url).hostname.toLowerCase();
          const currentPolicy = await this.prisma.scopePolicy.findFirst({ where: { projectId: payload.projectId }, orderBy: { authorizationAttestedAt: 'desc' } });
          if (!currentPolicy || !isHostAllowed(host, currentPolicy.allowedHosts) || currentPolicy.deniedPaths.some(p => decodeURIComponent(new URL(url).pathname).startsWith(p)) || new URL(url).origin !== new URL(audit.target.baseUrl).origin) {
            await this.recordDenial(payload, host, 'request_scope_denied');
            throw new PermanentJobError('Request or redirect outside target scope');
          }
          if (!['GET','HEAD','OPTIONS'].includes(method) && !currentPolicy.destructiveAllowed) throw new PermanentJobError('Destructive request not authorized');
          if (probe) {
            const identity = await this.prisma.testIdentity.findFirst({ where: { id: probe.testIdentityId, projectId: payload.projectId, targetId: audit.target.id, active: true, credentialSecret: { revokedAt: null } } });
            if (!identity) throw new PermanentJobError('Identity revoked before request');
          }
          await this.reserveRequest(payload, currentPolicy.maxRequestsPerAudit, currentPolicy.maxRequestsPerSecond);
          result = await runControlledProcess('curl', [
            '--silent', '--show-error', '--include', '--suppress-connect-headers', '--noproxy', '', '--proxy', proxy, '--max-time', '55', '--max-filesize', '2097152', '--proto', '=http,https',
            ...(method === 'HEAD' ? ['--head'] : ['--request', method]), ...(configPath ? ['--config', configPath] : []),
            ...Object.entries(probe?.headers ?? {}).flatMap(([name, value]) => ['--header', name + ': ' + value]),
            ...(body === undefined ? [] : ['--data-raw', body]), url,
          ], { signal, graceMs: 30000 });
          if (result.exitCode !== 0) throw new Error('HTTP transport failed');
          exchanges.push({ request: { method, url, headers: probe?.headers ?? {}, body, testIdentityId: probe?.testIdentityId }, response: result.stdout });
          const status = Number(result.stdout.match(/^HTTP\/\S+\s+(\d+)/m)?.[1]);
          const location = result.stdout.match(/^location:\s*(.+)$/im)?.[1]?.trim();
          if (!probe?.followRedirects || ![301,302,303,307,308].includes(status) || !location) break;
          if (hop === 5) throw new PermanentJobError('Redirect limit exceeded');
          url = new URL(location, url).toString();
          if (status === 303 || ([301,302].includes(status) && method === 'POST')) { method = 'GET'; body = undefined; }
        }
        const captured = this.capture.capture(
          payload.auditId,
          JSON.stringify({ exchanges }),
          { registeredSecrets },
        );
        const evidenceId = deterministicId('evidence', `${payload.auditId}:http_exchange:${captured.sha256}`);
        const executionId = deterministicId('toolExecution', `${payload.auditJobId}:curl:${url}`);
        const stored = await this.storage.uploadEvidence(payload.projectId, payload.auditId, captured.bytes);
        await this.storage.verifyEvidence(stored.uri, captured.sha256, captured.sizeBytes);
        if (signal.aborted) throw abortError();
        const expiresAt = await this.retention.expiryForCapture(payload.projectId, { type: 'http_exchange', replayable: true });
        await this.prisma.$transaction([
          this.prisma.toolExecution.upsert({
            where: { id: executionId },
            create: {
              id: executionId, auditJobId: payload.auditJobId, tool: 'curl',
              toolVersion: process.env.KASE_CURL_VERSION ?? '7.88.1',
              imageDigest: process.env.KASE_WORKER_IMAGE_DIGEST ?? 'development-unverified',
              capability: 'http', argumentsHash: createHash('sha256').update(`GET ${url}`).digest('hex'),
              exitCode: 0, durationMs: Date.now() - started, requestCount: exchanges.length, evidenceIds: [evidenceId],
            },
            update: { evidenceIds: [evidenceId] },
          }),
          this.prisma.evidence.upsert({
            where: { id: evidenceId },
            create: {
              id: evidenceId, auditId: payload.auditId, toolExecutionId: executionId, tool: 'curl',
              type: 'http_exchange', replayable: true, artifactUri: stored.uri,
              sha256: captured.sha256, fullRedactedSha256: captured.fullRedactedSha256,
              sizeBytes: captured.sizeBytes, truncated: captured.truncated, redacted: captured.redacted,
              expiresAt, metadata: { method: probe?.method ?? 'GET', url: probe?.url ?? url, testIdentityId: probe?.testIdentityId ?? null },
            },
            update: {},
          }),
        ]);
        if (invocation) await this.prisma.agentToolInvocation.update({ where: { id: invocation.id }, data: { status: 'completed', completedAt: new Date(), resultEvidenceIds: [evidenceId] } });
      });
      await this.lifecycle.succeed(payload);
    } catch (error) {
      await this.lifecycle.fail(payload, error);
      throw error;
    } finally {
      clearInterval(heartbeat);
      cancellation.close();
      if (configPath) await rm(configPath, { force: true });
    }
  }

  private async reserveRequest(payload: ReconAuditJobPayload, limit: number, perSecond: number): Promise<void> {
    if (limit < 1 || perSecond < 1) throw new PermanentJobError('HTTP request budget exhausted');
    await this.prisma.$transaction(async tx => {
      await tx.$queryRawUnsafe('SELECT id FROM "Project" WHERE id = $1 FOR UPDATE', payload.projectId);
      await tx.$queryRawUnsafe('SELECT id FROM "Audit" WHERE id = $1 FOR UPDATE', payload.auditId);
      await tx.$queryRawUnsafe('SELECT "auditId" FROM "ReconRequestBudget" WHERE "auditId" = $1 FOR UPDATE', payload.auditId);
      const budget = await tx.reconRequestBudget.findUnique({ where: { auditId: payload.auditId } });
      if (!budget) throw new PermanentJobError('Request budget unavailable');
      if (budget.consumed + budget.reserved >= Math.min(budget.maxRequests, limit)) throw new PermanentJobError('HTTP request budget exhausted');
      const recent = await tx.reconRequestReservation.count({ where: { audit: { projectId: payload.projectId }, stage: { startsWith: 'http_probe_' }, createdAt: { gt: new Date(Date.now() - 1000) } } });
      if (recent >= perSecond) throw new PermanentJobError('HTTP request rate exhausted');
      const id = 'http_' + require('crypto').randomUUID();
      await tx.reconRequestReservation.create({ data: { id, auditId: payload.auditId, auditJobId: payload.auditJobId, stage: 'http_probe_' + id, reservedCount: 1, consumedCount: 1, status: 'settled', leaseExpiresAt: new Date() } });
      await tx.reconRequestBudget.update({ where: { auditId: payload.auditId }, data: { consumed: { increment: 1 } } });
    });
  }

  private recordDenial(payload: ReconAuditJobPayload, host: string, reason: string) {
    return this.trail.record({
      projectId: payload.projectId,
      actorType: 'system',
      action: 'worker.egress.denied',
      resourceType: 'Audit',
      resourceId: payload.auditId,
      metadata: { host, reason, source: 'worker-http' },
      outcome: 'denied',
    });
  }
}

function abortError(): Error {
  const error = new Error('Audit cancellation requested');
  error.name = 'AbortError';
  return error;
}
