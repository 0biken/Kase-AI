import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import { createHash } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
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

@Injectable()
export class ReconWorkerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(ReconWorkerService.name);
  private worker?: Worker<ReconAuditJobPayload>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3Service,
    private readonly secrets: SecretsService,
    private readonly trail: AuditTrailService,
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
    const audit = await this.prisma.audit.findFirst({
      where: { id: auditId, projectId },
      include: { target: true },
    });
    if (!audit?.target) throw new Error('Audit target is missing');

    const auditJob = await this.prisma.auditJob.findFirst({
      where: { id: auditJobId, auditId, kind: 'recon' },
    });
    if (!auditJob) throw new Error('Audit job does not match the queue payload');

    const policy = await this.prisma.scopePolicy.findFirst({
      where: { projectId },
      orderBy: { authorizationAttestedAt: 'desc' },
    });
    const targetUrl = healthUrl(audit.target.baseUrl);
    const host = new URL(targetUrl).hostname.toLowerCase();
    if (!policy || !isHostAllowed(host, policy.allowedHosts)) {
      await this.recordDenial(projectId, auditId, host, 'host_not_allowed');
      await this.failAudit(auditId, auditJobId, 'Worker scope validation denied the target');
      throw new Error('Worker scope validation denied the target');
    }

    const proxy = process.env.KASE_EGRESS_PROXY;
    if (!proxy) {
      await this.failAudit(auditId, auditJobId, 'KASE_EGRESS_PROXY is required');
      throw new Error('KASE_EGRESS_PROXY is required; direct target access is forbidden');
    }

    await this.prisma.$transaction([
      this.prisma.audit.update({ where: { id: auditId }, data: { status: 'running' } }),
      this.prisma.auditJob.update({
        where: { id: auditJobId },
        data: { status: 'running', attempts: { increment: 1 }, startedAt: new Date() },
      }),
    ]);

    const redactor = new SensitiveValueRedactor();
    let configPath: string | null = null;
    const started = Date.now();
    try {
      if (audit.target.authCredentialId) {
        const value = await this.secrets.resolveForWorker(projectId, audit.target.authCredentialId);
        redactor.register(value);
        configPath = await materializeCurlConfig(auditJobId, audit.target.authMode, value);
      } else if (audit.target.authMode !== 'none') {
        throw new Error('Authenticated target has no active credential');
      }

      const result = await runCurlProbe(targetUrl, proxy, configPath, signal);
      const rawArtifact = JSON.stringify({
        request: { method: 'GET', url: targetUrl },
        response: result.stdout,
      });
      const scrubbed = redactor.redact(rawArtifact);
      const content = Buffer.from(scrubbed.value, 'utf8');
      const executionId = newId('toolExecution');
      const evidenceId = newId('evidence');
      const stored = await this.storage.uploadEvidence(projectId, auditId, content);

      await this.prisma.$transaction(async (tx) => {
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
            metadata: { method: 'GET', url: targetUrl, status: responseStatus(result.stdout) },
          },
        });
        await tx.auditJob.update({
          where: { id: auditJobId },
          data: { status: 'succeeded', finishedAt: new Date(), error: null },
        });
        await tx.audit.update({
          where: { id: auditId },
          data: {
            status: 'completed',
            completedAt: new Date(),
            executedCategories: [auditJob.category ?? 'fixture_health'],
          },
        });
      });
    } catch (error) {
      const safe = redactor.redact(error instanceof Error ? error.message : 'Unknown worker error').value;
      await this.persistFailedExecution(auditId, auditJobId, targetUrl, started, error);
      await this.failAudit(auditId, auditJobId, safe);
      if (error instanceof CurlProbeError && /403|access denied|forbidden/i.test(error.stderr)) {
        await this.recordDenial(projectId, auditId, host, 'proxy_denied');
      }
      throw new Error(safe);
    } finally {
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

  private async failAudit(auditId: string, auditJobId: string, error: string): Promise<void> {
    await this.prisma.$transaction([
      this.prisma.auditJob.update({
        where: { id: auditJobId },
        data: { status: 'failed', error: error.slice(0, 1000), finishedAt: new Date() },
      }),
      this.prisma.audit.update({
        where: { id: auditId },
        data: { status: 'failed', completedAt: new Date() },
      }),
    ]);
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

async function materializeCurlConfig(jobId: string, authMode: string, value: string): Promise<string> {
  const root = process.env.KASE_SECRET_TMPFS ?? '/run/kase-secrets';
  await mkdir(root, { recursive: true, mode: 0o700 });
  const path = join(root, `${jobId}.curl-config`);
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/[\r\n]/g, '');
  let line: string;
  if (authMode === 'header') line = `header = "${escaped}"\n`;
  else if (authMode === 'cookie') line = `cookie = "${escaped}"\n`;
  else throw new Error(`M1 worker does not support auth mode "${authMode}"`);
  await writeFile(path, line, { encoding: 'utf8', mode: 0o600 });
  return path;
}

function responseStatus(raw: string): number | null {
  const match = raw.match(/^HTTP\/\S+\s+(\d{3})/m);
  return match ? Number(match[1]) : null;
}
