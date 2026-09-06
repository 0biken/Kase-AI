import { Inject, Injectable } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { createHash } from 'crypto';
import { isAbsolute, join, relative } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../storage/s3.service';
import { SemgrepAdapter, parseSemgrepFindings } from '../adapters/sast/semgrep.adapter';
import { EvidenceCaptureService } from '../evidence/evidence-capture.service';
import { normalizeSastFinding } from '../findings/sast-normalizer';
import { FindingPersistenceService, deterministicId } from '../findings/finding-persistence.service';

export interface SastWorkerDatabase {
  evidence: { upsert(args: unknown): Promise<unknown>; findFirst(args: unknown): Promise<any> };
  toolExecution: { upsert(args: unknown): Promise<unknown> };
}

export interface ExecuteSastInput {
  projectId: string;
  auditId: string;
  auditJobId: string;
  checkoutPath: string;
  rulePackPath: string;
  rulePackSha256: string;
  commitSha: string;
  affectedTarget: string;
  expiresAt: Date;
  signal?: AbortSignal;
}

@Injectable()
export class SastWorkerService {
  constructor(
    @Inject(PrismaService) private readonly db: SastWorkerDatabase,
    @Inject(S3Service) private readonly storage: S3Service,
    private readonly findings: FindingPersistenceService,
    private readonly adapter: SemgrepAdapter,
    private readonly capture: EvidenceCaptureService,
  ) {}

  async executeSemgrep(input: ExecuteSastInput) {
    const started = Date.now();
    const output = await this.adapter.run(input);
    throwIfAborted(input.signal);
    const captured = this.capture.captureJson(input.auditId, output.raw);
    const evidenceId = deterministicId('evidence', `${input.auditId}:sast_json:${captured.sha256}`);
    const executionId = deterministicId('toolExecution', `${input.auditJobId}:semgrep:${input.rulePackSha256}`);
    const stored = await this.storage.uploadEvidence(input.projectId, input.auditId, captured.bytes);
    if (stored.sha256 !== captured.sha256) throw new Error('Evidence storage returned a mismatched digest');
    await this.storage.verifyEvidence(stored.uri, captured.sha256, captured.sizeBytes);
    throwIfAborted(input.signal);
    await this.db.toolExecution.upsert({
      where: { id: executionId },
      create: {
        id: executionId, auditJobId: input.auditJobId, tool: 'semgrep', toolVersion: '1.175.0',
        imageDigest: process.env.KASE_SAST_IMAGE_DIGEST ?? 'development-unverified', capability: 'sast',
        argumentsHash: createHash('sha256').update(`${input.rulePackSha256}:${input.commitSha}`).digest('hex'),
        exitCode: 0, durationMs: Date.now() - started, requestCount: 0, evidenceIds: [evidenceId],
      },
      update: { evidenceIds: [evidenceId] },
    });
    await this.db.evidence.upsert({
      where: { id: evidenceId },
      create: {
        id: evidenceId, auditId: input.auditId, toolExecutionId: executionId, tool: 'semgrep', type: 'sast_json',
        replayable: true, artifactUri: stored.uri, sha256: captured.sha256,
        fullRedactedSha256: captured.fullRedactedSha256, sizeBytes: captured.sizeBytes,
        truncated: captured.truncated, redacted: captured.redacted, expiresAt: input.expiresAt,
        metadata: { rulePackSha256: input.rulePackSha256, commitSha: input.commitSha },
      },
      update: {},
    });
    return { evidenceId, executionId, findingCount: output.findings.length };
  }

  async normalize(input: Omit<ExecuteSastInput, 'rulePackPath' | 'rulePackSha256' | 'expiresAt'>) {
    const evidence = await this.db.evidence.findFirst({
      where: { auditId: input.auditId, type: 'sast_json', tombstonedAt: null },
      orderBy: { capturedAt: 'desc' },
    });
    if (!evidence?.artifactUri) throw new Error('Replayable Semgrep evidence is missing');
    const bytes = await this.storage.downloadEvidence(evidence.artifactUri);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== evidence.sha256 || bytes.length !== evidence.sizeBytes) throw new Error('Semgrep evidence integrity mismatch');
    const candidates = parseSemgrepFindings(bytes.toString('utf8'));
    const persisted: Array<{ identityId: string; findingId: string }> = [];
    for (const candidate of candidates) {
      throwIfAborted(input.signal);
      const candidateFile = candidate.file.replace(/\\/gu, '/');
      const sourceFile = isAbsolute(candidateFile)
        ? candidateFile
        : join(input.checkoutPath, candidateFile);
      const normalizedCandidate = isAbsolute(candidateFile)
        ? { ...candidate, file: relative(input.checkoutPath, candidateFile).replace(/\\/gu, '/') }
        : { ...candidate, file: candidateFile };
      const sourceText = await readFile(sourceFile, 'utf8');
      const normalized = normalizeSastFinding(normalizedCandidate, {
        sourceText, commitSha: input.commitSha, target: input.affectedTarget,
      });
      persisted.push(await this.findings.persist(input.projectId, input.auditId, evidence.id, normalized));
    }
    return { evidenceId: evidence.id, findings: persisted };
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    const error = new Error('Audit cancellation requested');
    error.name = 'AbortError';
    throw error;
  }
}
