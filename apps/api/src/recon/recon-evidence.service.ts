import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../storage/s3.service';
import { EvidenceCaptureService } from '../evidence/evidence-capture.service';
import { RetentionPolicyService } from '../retention/retention-policy.service';
import { deterministicId } from '../findings/finding-persistence.service';

@Injectable()
export class ReconEvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: S3Service,
    private readonly capture: EvidenceCaptureService,
    private readonly retention: RetentionPolicyService,
  ) {}

  async persist(input: {
    auditId: string; auditJobId: string; projectId: string; attempt: number; tool: string; toolVersion: string;
    type: string; replayable: boolean; raw: string; requestCount: number; durationMs: number;
    metadata?: Record<string, unknown>; signal: AbortSignal;
  }): Promise<{ evidenceId: string; sha256: string }> {
    throwIfAborted(input.signal);
    await this.assertWritable(input);
    const evidenceId = deterministicId('ev', `${input.auditJobId}:${input.type}`);
    const executionId = deterministicId('texe', `${input.auditJobId}:${input.tool}`);
    const existing = await this.prisma.evidence.findUnique({
      where: { id: evidenceId }, select: { sha256: true, sizeBytes: true, artifactUri: true, tombstonedAt: true },
    });
    if (existing?.artifactUri && !existing.tombstonedAt) {
      await this.storage.verifyEvidence(existing.artifactUri, existing.sha256, Number(existing.sizeBytes));
      throwIfAborted(input.signal);
      await this.assertWritable(input);
      return { evidenceId, sha256: existing.sha256 };
    }
    const captured = this.capture.capture(input.auditId, input.raw, { maxBytes: 10 * 1024 * 1024 });
    throwIfAborted(input.signal);
    await this.assertWritable(input);
    const stored = await this.storage.uploadEvidence(input.projectId, input.auditId, captured.bytes);
    await this.storage.verifyEvidence(stored.uri, captured.sha256, captured.sizeBytes);
    throwIfAborted(input.signal);
    const expiresAt = await this.retention.expiryForCapture(input.projectId, { type: input.type, replayable: input.replayable });
    await this.prisma.$transaction(async (tx) => {
      throwIfAborted(input.signal);
      const writable = await tx.auditJob.findFirst({ where: {
        id: input.auditJobId, auditId: input.auditId, status: 'running', attempts: input.attempt,
        audit: { is: { projectId: input.projectId, cancellationRequestedAt: null } },
      }, select: { id: true } });
      if (!writable) throw staleAttemptError();
      await tx.toolExecution.upsert({
        where: { id: executionId },
        create: {
          id: executionId, auditJobId: input.auditJobId, tool: input.tool, toolVersion: input.toolVersion,
          imageDigest: process.env.KASE_WORKER_IMAGE_DIGEST ?? 'development-unverified',
          capability: input.type, argumentsHash: createHash('sha256').update(`${input.tool}:${input.type}`).digest('hex'),
          exitCode: 0, durationMs: input.durationMs, requestCount: input.requestCount, evidenceIds: [evidenceId],
        },
        update: { durationMs: input.durationMs, requestCount: input.requestCount, evidenceIds: [evidenceId] },
      });
      throwIfAborted(input.signal);
      await tx.evidence.upsert({
        where: { id: evidenceId },
        create: {
          id: evidenceId, auditId: input.auditId, toolExecutionId: executionId, tool: input.tool,
          type: input.type, replayable: input.replayable, artifactUri: stored.uri, sha256: captured.sha256,
          fullRedactedSha256: captured.fullRedactedSha256, sizeBytes: captured.sizeBytes,
          truncated: captured.truncated, redacted: captured.redacted, expiresAt,
          metadata: (input.metadata ?? {}) as never,
        },
        update: {},
      });
    });
    return { evidenceId, sha256: captured.sha256 };
  }

  async load(auditId: string, type: string): Promise<string> {
    const evidence = await this.prisma.evidence.findFirst({
      where: { auditId, type, tombstonedAt: null, artifactUri: { not: null } },
      orderBy: { capturedAt: 'desc' },
    });
    if (!evidence?.artifactUri) throw new Error(`Missing live ${type} evidence for audit ${auditId}`);
    return (await this.storage.downloadEvidence(evidence.artifactUri)).toString('utf8');
  }

  async hasLive(auditId: string, type: string): Promise<boolean> {
    return Boolean(await this.prisma.evidence.findFirst({
      where: { auditId, type, tombstonedAt: null, artifactUri: { not: null } }, select: { id: true },
    }));
  }

  private async assertWritable(input: { auditId: string; auditJobId: string; projectId: string; attempt: number }): Promise<void> {
    const writable = await this.prisma.auditJob.findFirst({ where: {
      id: input.auditJobId, auditId: input.auditId, status: 'running', attempts: input.attempt,
      audit: { is: { projectId: input.projectId, cancellationRequestedAt: null } },
    }, select: { id: true } });
    if (!writable) throw staleAttemptError();
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) { const error = new Error('Audit cancellation requested'); error.name = 'AbortError'; throw error; }
}

function staleAttemptError(): Error { const error = new Error('Audit job attempt is no longer writable'); error.name = 'AbortError'; return error; }
