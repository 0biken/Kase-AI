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
        const url = new URL('healthz', `${audit.target.baseUrl.replace(/\/+$/u, '')}/`).toString();
        const host = new URL(url).hostname.toLowerCase();
        const policy = await this.prisma.scopePolicy.findFirst({
          where: { projectId: payload.projectId }, orderBy: { authorizationAttestedAt: 'desc' },
        });
        if (!policy || !isHostAllowed(host, policy.allowedHosts)) {
          await this.recordDenial(payload, host, 'host_not_allowed');
          throw new PermanentJobError('Worker scope validation denied the target');
        }
        const registeredSecrets: string[] = [];
        if (audit.target.authCredentialId) {
          const credential = await this.secrets.resolveForWorker(payload.projectId, audit.target.authCredentialId);
          registeredSecrets.push(credential);
          configPath = await materializeCurlConfig(payload.auditJobId, audit.target.authMode, credential);
        } else if (audit.target.authMode !== 'none') {
          throw new PermanentJobError('Authenticated target has no active credential');
        }
        const started = Date.now();
        const result = await runControlledProcess('curl', [
          '--silent', '--show-error', '--include', '--fail-with-body', '--proxy', proxy, '--max-time', '55',
          ...(configPath ? ['--config', configPath] : []), url,
        ], {
          signal, graceMs: 30_000,
        });
        if (result.exitCode !== 0) {
          if (/403|access denied|forbidden/iu.test(`${result.stderr}\n${result.stdout}`)) {
            await this.recordDenial(payload, host, 'proxy_denied');
          }
          throw new Error(`HTTP adapter failed: ${result.stderr.slice(0, 1_000)}`);
        }
        const captured = this.capture.capture(
          payload.auditId,
          JSON.stringify({ request: { method: 'GET', url }, response: result.stdout }),
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
              exitCode: 0, durationMs: Date.now() - started, requestCount: 1, evidenceIds: [evidenceId],
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
              expiresAt, metadata: { method: 'GET', url },
            },
            update: {},
          }),
        ]);
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
