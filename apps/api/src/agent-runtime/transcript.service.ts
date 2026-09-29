import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { EvidenceCaptureService } from '../evidence/evidence-capture.service';
import { ProviderMessage } from '../ai-provider/ai-provider.interface';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../storage/s3.service';
import { RetentionPolicyService } from '../retention/retention-policy.service';
import { deterministicId } from '../findings/finding-persistence.service';
export interface TranscriptData { messages: ProviderMessage[] }
@Injectable()
export class TranscriptService {
  constructor(private readonly capture: EvidenceCaptureService, private readonly prisma: PrismaService,
    private readonly storage: S3Service, private readonly retention: RetentionPolicyService) {}
  async checkpoint(runId: string, sequence: number, transcript: TranscriptData, nextTurnSequence: number): Promise<void> {
    const run = await this.prisma.agentRun.findUniqueOrThrow({ where: { id: runId }, include: { audit: true } });
    const safe = this.capture.captureJson(run.auditId, JSON.stringify(transcript), { maxBytes: 4 * 1024 * 1024 });
    if (safe.truncated) throw new Error('Transcript capacity exceeded');
    const stored = await this.storage.uploadEvidence(run.audit.projectId, run.auditId, safe.bytes);
    await this.storage.verifyEvidence(stored.uri, safe.sha256, safe.sizeBytes);
    const id = deterministicId('evidence', run.id + ':' + safe.sha256);
    const expiresAt = await this.retention.expiryForCapture(run.audit.projectId, { type: 'agent_transcript', replayable: false });
    await this.prisma.$transaction(async tx => {
      await tx.evidence.upsert({ where: { id }, create: { id, auditId: run.auditId, tool: 'agent', type: 'agent_transcript', replayable: false, artifactUri: stored.uri, sha256: safe.sha256,
        fullRedactedSha256: safe.fullRedactedSha256, sizeBytes: safe.sizeBytes, redacted: true, truncated: false, expiresAt, metadata: { runId, sequence } }, update: {} });
      await tx.agentTurn.upsert({ where: { agentRunId_turnSequence: { agentRunId: run.id, turnSequence: sequence } },
        create: { id: deterministicId('agentTurn', run.id + ':' + sequence), agentRunId: run.id, turnSequence: sequence, role: transcript.messages.at(-1)?.role ?? 'user', transcriptEvidenceId: id },
        update: { transcriptEvidenceId: id, role: transcript.messages.at(-1)?.role ?? 'user' } });
      await tx.agentRun.update({ where: { id: run.id }, data: { currentTranscriptId: id, currentTurn: Math.max(0, sequence), nextTurnSequence } });
    });
  }
  async load(runId: string): Promise<TranscriptData | null> {
    const run = await this.prisma.agentRun.findUniqueOrThrow({ where: { id: runId } });
    if (!run.currentTranscriptId) return null;
    const value = await this.readEvidence(run.auditId, run.currentTranscriptId);
    const data = JSON.parse(value.toString('utf8'));
    if (!Array.isArray(data.messages)) throw new Error('Invalid transcript');
    return data;
  }
  async readEvidence(auditId: string, id: string): Promise<Buffer> {
    const row = await this.prisma.evidence.findFirst({ where: { id, auditId, tombstonedAt: null, expiresAt: { gt: new Date() } } });
    if (!row?.artifactUri) throw new Error('Evidence is unavailable');
    const bytes = await this.storage.downloadEvidence(row.artifactUri);
    if (bytes.length !== row.sizeBytes || createHash('sha256').update(bytes).digest('hex') !== row.sha256) throw new Error('Evidence integrity mismatch');
    return bytes;
  }
  redact(auditId: string, text: string): string { return this.capture.capture(auditId, text, { maxBytes: 65536 }).bytes.toString('utf8'); }
  /** Redact structured control data without clipping JSON mid-token. */
  redactJson<T>(auditId: string, value: T): T {
    const captured = this.capture.captureJson(auditId, JSON.stringify(value), { maxBytes: 2 * 1024 * 1024 });
    if (captured.truncated) throw new Error('Structured agent data exceeds redaction capacity');
    return JSON.parse(captured.bytes.toString('utf8')) as T;
  }
}

