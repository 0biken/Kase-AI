import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { createHash } from 'crypto';
import { rm } from 'fs/promises';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../storage/s3.service';
import { SecretsService } from '../secrets/secrets.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { QUEUE_RECON } from '../queue/queue.constants';
import { limitsFor, workerOptionsFor } from '../queue/queue.config';
import { withJobTimeout } from '../queue/job-timeout.util';
import { isHostAllowed } from '../common/host-pattern';
import { newId } from '../common/ids';
import type { ReconAuditJobPayload } from '../orchestrator/audit-job.payload';
import { CurlProbeError, runCurlProbe } from './curl-probe';
import { SensitiveValueRedactor } from './sensitive-value-redactor';
import { AuditJobLifecycleService } from '../orchestrator/audit-job-lifecycle.service';
import { CancellationSignalRegistry } from '../orchestrator/cancellation-signal.registry';
import { CancelledJobError, PermanentJobError } from '../orchestrator/retry-policy';
import { RetentionPolicyService } from '../retention/retention-policy.service';
import { materializeCurlConfig } from './curl-auth-config';

@Injectable()
export class ReconWorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReconWorkerService.name);
  private worker?: Worker<ReconAuditJobPayload>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3Service,
    private readonly secrets: SecretsService,
    private readonly trail: AuditTrailService,
    private readonly lifecycle: AuditJobLifecycleService,
    private readonly cancellations: CancellationSignalRegistry,
    private readonly retention: RetentionPolicyService,
  ) {}

  onModuleInit(): void {
    this.worker = new Worker<ReconAuditJobPayload>(
      QUEUE_RECON,
      (job) => withJobTimeout(job.id ?? job.name, limitsFor(QUEUE_RECON).timeoutMs,
        (signal) => this.process(job, signal)),
      workerOptionsFor(QUEUE_RECON),
    );
    this.worker.on('failed', (job, error) => {
      this.logger.error(`Recon job ${job?.id ?? 'unknown'} failed: ${error.name}`);
    });
    this.logger.log('Recon worker ready');
  }

  async onApplicationShutdown(): Promise<void> {
    await this.worker?.close();
  }

  private async process(job: Job<ReconAuditJobPayload>, signal: AbortSignal): Promise<void> {
    assertPayload(job.data);
    const { auditId, auditJobId, projectId } = job.data;
    const cancellation = this.cancellations.watch(auditId, signal);
    const effectiveSignal = cancellation.signal;
    const redactor = new SensitiveValueRedactor();
    let heartbeat: NodeJS.Timeout | undefined;
    let configPath: string | null = null;
    let targetUrl: string | null = null;
    let host: string | null = null;
    let probeStarted = false;
    const started = Date.now();
    try {
      const claimed = await this.lifecycle.claim(job.data);
      if (!claimed) return;
      heartbeat = setInterval(() => void this.lifecycle.heartbeat(auditJobId), 20_000);
      heartbeat.unref?.();
      const audit = await this.prisma.audit.findFirst({
        where: { id: auditId, projectId }, include: { target: true },
      });
      if (!audit?.target) throw new PermanentJobError('Audit target is missing');
      const auditJob = await this.prisma.auditJob.findFirst({ where: { id: auditJobId, auditId, kind: 'recon' } });
      if (!auditJob) throw new PermanentJobError('Audit job does not match the queue payload');
      const policy = await this.prisma.scopePolicy.findFirst({
        where: { projectId }, orderBy: { authorizationAttestedAt: 'desc' },
      });
      targetUrl = healthUrl(audit.target.baseUrl);
      host = new URL(targetUrl).hostname.toLowerCase();
      if (!policy || !isHostAllowed(host, policy.allowedHosts)) {
        await this.recordDenial(projectId, auditId, host, 'host_not_allowed');
        throw new PermanentJobError('Worker scope validation denied the target');
      }
      const proxy = process.env.KASE_EGRESS_PROXY;
      if (!proxy) throw new PermanentJobError('KASE_EGRESS_PROXY is required; direct target access is forbidden');

      if (audit.target.authCredentialId) {
        const value = await this.secrets.resolveForWorker(projectId, audit.target.authCredentialId);
        redactor.register(value);
        configPath = await materializeCurlConfig(auditJobId, audit.target.authMode, value);
      } else if (audit.target.authMode !== 'none') {
        throw new Error('Authenticated target has no active credential');
      }

      probeStarted = true;
      const result = await runCurlProbe(targetUrl, proxy, configPath, effectiveSignal);
      const rawArtifact = JSON.stringify({
        request: { method: 'GET', url: targetUrl },
        response: result.stdout,
      });
      const scrubbed = redactor.redact(rawArtifact);
      const content = Buffer.from(scrubbed.value, 'utf8');
      throwIfCancelled(effectiveSignal);
      const executionId = newId('toolExecution');
      const evidenceId = newId('evidence');
      const stored = await this.storage.uploadEvidence(projectId, auditId, content);
      throwIfCancelled(effectiveSignal);
      const capturedAt = new Date();
      const expiresAt = await this.retention.expiryForCapture(projectId, { type: 'http_exchange', replayable: true }, capturedAt);

      await this.prisma.$transaction(async (tx) => {
        throwIfCancelled(effectiveSignal);
        await tx.toolExecution.create({
          data: {
            id: executionId,
            auditJobId,
            tool: 'curl',
            toolVersion: process.env.KASE_CURL_VERSION ?? '8.12.1',
            imageDigest: process.env.KASE_WORKER_IMAGE_DIGEST ?? 'development-unverified',
            capability: 'fixture_health_probe',
            argumentsHash: createHash('sha256').update(`GET ${targetUrl}`).digest('hex'),
            exitCode: result.exitCode,
            durationMs: Date.now() - started,
            requestCount: 1,
            evidenceIds: [evidenceId],
          },
        });
        await tx.evidence.create({
          data: {
            id: evidenceId,
            auditId,
            toolExecutionId: executionId,
            tool: 'curl',
            type: 'http_exchange',
            replayable: true,
            artifactUri: stored.uri,
            sha256: stored.sha256,
            sizeBytes: content.length,
            redacted: scrubbed.changed,
            capturedAt,
            expiresAt,
            metadata: { method: 'GET', url: targetUrl, status: responseStatus(result.stdout) },
          },
        });
      });
      await this.lifecycle.succeed(job.data);
    } catch (error) {
      const safe = redactor.redact(error instanceof Error ? error.message : 'Unknown worker error').value;
      if (effectiveSignal.aborted) {
        await this.lifecycle.fail(job.data, new CancelledJobError());
        throw new CancelledJobError();
      }
      if (probeStarted && targetUrl) await this.persistFailedExecution(auditId, auditJobId, targetUrl, started, error);
      await this.lifecycle.fail(job.data, error);
      if (host && error instanceof CurlProbeError && /403|access denied|forbidden/i.test(error.stderr)) {
        await this.recordDenial(projectId, auditId, host, 'proxy_denied');
      }
      throw new Error(safe);
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      cancellation.close();
      redactor.clear();
      if (configPath) await rm(configPath, { force: true });
    }
  }

  private async persistFailedExecution(
    auditId: string,
    auditJobId: string,
    targetUrl: string,
    started: number,
    error: unknown,
  ): Promise<void> {
    await this.prisma.toolExecution.create({
      data: {
        id: newId('toolExecution'),
        auditJobId,
        tool: 'curl',
        toolVersion: process.env.KASE_CURL_VERSION ?? '8.12.1',
        imageDigest: process.env.KASE_WORKER_IMAGE_DIGEST ?? 'development-unverified',
        capability: 'fixture_health_probe',
        argumentsHash: createHash('sha256').update(`GET ${targetUrl}`).digest('hex'),
        exitCode: error instanceof CurlProbeError ? error.exitCode : null,
        durationMs: Date.now() - started,
        requestCount: 1,
        evidenceIds: [],
      },
    }).catch(() => undefined);
  }

  private recordDenial(projectId: string, auditId: string, host: string, reason: string) {
    return this.trail.record({
      projectId,
      actorType: 'system',
      action: 'worker.egress.denied',
      resourceType: 'Audit',
      resourceId: auditId,
      metadata: { host, reason, source: 'worker' },
      outcome: 'denied',
    });
  }
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new CancelledJobError();
}

function assertPayload(payload: ReconAuditJobPayload): void {
  const keys = Object.keys(payload).sort();
  const expected = ['auditId', 'auditJobId', 'projectId'];
  if (JSON.stringify(keys) !== JSON.stringify(expected) || keys.some((key) => typeof payload[key as keyof ReconAuditJobPayload] !== 'string')) {
    throw new Error('Invalid recon queue payload');
  }
}

function healthUrl(baseUrl: string): string {
  return new URL('healthz', `${baseUrl.replace(/\/+$/, '')}/`).toString();
}

function responseStatus(raw: string): number | null {
  const match = raw.match(/^HTTP\/\S+\s+(\d{3})/m);
  return match ? Number(match[1]) : null;
}
