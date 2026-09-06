import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Job, Worker } from 'bullmq';
import { createHash } from 'crypto';
import { access, readFile, writeFile } from 'fs/promises';
import { resolve } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { QUEUE_NORMALIZE_SEVERITY, QUEUE_PROVENANCE, QUEUE_SEMGREP, type QueueName } from '../queue/queue.constants';
import { workerOptionsFor } from '../queue/queue.config';
import { withJobTimeout } from '../queue/job-timeout.util';
import type { ReconAuditJobPayload } from '../orchestrator/audit-job.payload';
import { AuditJobLifecycleService, DEFAULT_HEARTBEAT_MS } from '../orchestrator/audit-job-lifecycle.service';
import { CancellationSignalRegistry } from '../orchestrator/cancellation-signal.registry';
import { GitCheckoutService } from '../provenance/git-checkout.service';
import { ProvenanceResolver } from '../provenance/provenance-resolver';
import { RetentionPolicyService } from '../retention/retention-policy.service';
import { SastWorkerService } from './sast-worker.service';
import { newId } from '../common/ids';
import { runControlledProcess } from './process-control';

const SAST_QUEUES = [QUEUE_PROVENANCE, QUEUE_SEMGREP, QUEUE_NORMALIZE_SEVERITY] as const;

@Injectable()
export class SastJobConsumerService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(SastJobConsumerService.name);
  private readonly workers: Worker<ReconAuditJobPayload>[] = [];

  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: AuditJobLifecycleService,
    private readonly cancellations: CancellationSignalRegistry,
    private readonly provenance: ProvenanceResolver,
    private readonly checkouts: GitCheckoutService,
    private readonly retention: RetentionPolicyService,
    private readonly sast: SastWorkerService,
  ) {}

  onModuleInit(): void {
    for (const queue of SAST_QUEUES) {
      const worker = new Worker<ReconAuditJobPayload>(queue, (job) => this.process(queue, job), workerOptionsFor(queue));
      worker.on('failed', (job, error) => this.logger.error(`${queue} job ${job?.id ?? 'unknown'} failed: ${error.message}`));
      this.workers.push(worker);
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all(this.workers.map((worker) => worker.close()));
  }

  private async process(queue: QueueName, job: Job<ReconAuditJobPayload>): Promise<void> {
    const payload = job.data;
    const storedJob = await this.lifecycle.claim(payload);
    if (!storedJob) return;
    const cancellation = this.cancellations.watch(payload.auditId);
    const heartbeat = setInterval(() => void this.lifecycle.heartbeat(payload.auditJobId), DEFAULT_HEARTBEAT_MS);
    heartbeat.unref?.();
    try {
      await withJobTimeout(payload.auditJobId, storedJob.timeoutMs, async (timeoutSignal) => {
        const signal = AbortSignal.any([timeoutSignal, cancellation.signal]);
        if (queue === QUEUE_PROVENANCE) await this.buildProvenance(payload, signal);
        else if (queue === QUEUE_SEMGREP) await this.runSemgrep(payload, signal);
        else await this.normalize(payload, signal);
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

  private async buildProvenance(payload: ReconAuditJobPayload, signal: AbortSignal): Promise<void> {
    const audit = await this.loadAudit(payload);
    const resolved = await this.provenance.resolve({
      repository: audit.repository,
      target: audit.target,
      callerCommitSha: audit.requestedCommitSha,
      signal,
    });
    await this.checkouts.checkout(audit.repository, resolved.commitSha, signal);
    throwIfAborted(signal);
    const existing = await this.prisma.buildProvenance.findUnique({ where: { auditId: audit.id } });
    const saved = await this.prisma.buildProvenance.upsert({
      where: { auditId: audit.id },
      create: {
        id: newId('buildProvenance'), auditId: audit.id, commitSha: resolved.commitSha,
        branch: resolved.branch, buildId: resolved.buildId, source: resolved.source,
        verified: resolved.verified, targetFingerprint: resolved.targetFingerprint,
      },
      update: {
        commitSha: resolved.commitSha, branch: resolved.branch, buildId: resolved.buildId,
        source: resolved.source, verified: resolved.verified, targetFingerprint: resolved.targetFingerprint,
      },
    });
    if (existing && existing.commitSha !== saved.commitSha) throw new Error('Persisted provenance changed during retry');
    await this.prisma.audit.update({ where: { id: audit.id }, data: { buildProvenanceId: saved.id } });
  }

  private async runSemgrep(payload: ReconAuditJobPayload, signal: AbortSignal): Promise<void> {
    const audit = await this.loadAudit(payload);
    if (!audit.buildProvenance?.commitSha) throw new Error('Build provenance is missing');
    const checkoutPath = await this.checkouts.checkout(audit.repository, audit.buildProvenance.commitSha, signal);
    const rulePackPath = resolve(process.env.KASE_SAST_RULE_PACK ?? 'rules/kase/typescript-security/idor/missing-ownership-predicate.yml');
    const ruleBytes = await readFile(rulePackPath);
    const rulePackSha256 = createHash('sha256').update(ruleBytes).digest('hex');
    if (process.env.KASE_SAST_RULE_PACK_SHA256 && process.env.KASE_SAST_RULE_PACK_SHA256 !== rulePackSha256) {
      throw new Error('Configured rule pack digest mismatch');
    }
    const expiresAt = await this.retention.expiryForCapture(payload.projectId, { type: 'sast_json', replayable: true });
    await this.sast.executeSemgrep({
      ...payload, checkoutPath, rulePackPath, rulePackSha256,
      commitSha: audit.buildProvenance.commitSha,
      affectedTarget: audit.target?.baseUrl ?? audit.repository.url,
      expiresAt, signal,
    });
    await holdForComposeProofOnce(checkoutPath, payload.auditJobId, signal);
  }

  private async normalize(payload: ReconAuditJobPayload, signal: AbortSignal): Promise<void> {
    const audit = await this.loadAudit(payload);
    if (!audit.requestedCategories.includes('sast')) return;
    if (!audit.buildProvenance?.commitSha) throw new Error('Build provenance is missing');
    const checkoutPath = await this.checkouts.checkout(audit.repository, audit.buildProvenance.commitSha, signal);
    await this.sast.normalize({
      ...payload, checkoutPath, commitSha: audit.buildProvenance.commitSha,
      affectedTarget: audit.target?.baseUrl ?? audit.repository.url, signal,
    });
  }

  private async loadAudit(payload: ReconAuditJobPayload): Promise<any> {
    const audit = await this.prisma.audit.findFirst({
      where: { id: payload.auditId, projectId: payload.projectId },
      include: { repository: true, target: true, buildProvenance: true },
    });
    if (!audit?.repository) throw new Error('Audit repository is missing');
    return audit;
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    const error = new Error('Audit cancellation requested');
    error.name = 'AbortError';
    throw error;
  }
}

async function holdForComposeProofOnce(checkoutPath: string, auditJobId: string, signal: AbortSignal): Promise<void> {
  if (process.env.KASE_ENABLE_PROOF_HOOKS !== 'true') return;
  const holdMs = Number(process.env.KASE_SEMGREP_PROOF_HOLD_MS ?? 0);
  if (!Number.isSafeInteger(holdMs) || holdMs <= 0 || holdMs > 120_000) {
    throw new Error('KASE_SEMGREP_PROOF_HOLD_MS must be an integer from 1 through 120000');
  }
  const marker = resolve(checkoutPath, `.kase-proof-hold-${auditJobId}`);
  try {
    await access(marker);
    return;
  } catch {
    await writeFile(marker, `${new Date().toISOString()}\n`, { flag: 'wx' }).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'EEXIST') throw error;
    });
  }
  const seconds = (holdMs / 1_000).toFixed(3);
  const result = await runControlledProcess('bash', ['-c', `exec -a semgrep-proof-hold sleep ${seconds}`], {
    cwd: checkoutPath,
    signal,
    graceMs: 30_000,
  });
  if (result.exitCode !== 0) throw new Error(`Semgrep proof hold failed with exit code ${result.exitCode}`);
}
