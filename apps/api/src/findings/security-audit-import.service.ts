import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { S3Service } from '../storage/s3.service';
import { EvidenceCaptureService } from '../evidence/evidence-capture.service';
import { RetentionPolicyService } from '../retention/retention-policy.service';
import { ProblemException } from '../common/problem-details';
import { SecurityAuditReportSchema } from '../adapters/security-audit/security-audit.schema';
import { SECURITY_AUDIT_CATEGORY, normalizeSecurityAudit } from './security-audit-normalizer';
import { deterministicId, upsertFindingOccurrence } from './finding-persistence.service';

/**
 * Coverage rows written by imports use their own agent role so they can never
 * overwrite, or be mistaken for, what the in-Kase agents actually covered.
 */
export const SECURITY_AUDIT_IMPORT_ROLE = 'security_audit_import';

export interface SecurityAuditImportResult {
  evidenceId: string; confirmed: number; needsValidation: number; rejected: number; merged: number; findingIds: string[];
}

/**
 * Ingests `findings.json` from cloudflare/security-audit-skill. Findings are
 * persisted exactly like agent findings: AI-generated, never gate-eligible, and
 * backed only by `security_audit_json` evidence, which classifies as
 * `ai_inference` and therefore can warn but never block.
 */
@Injectable()
export class SecurityAuditImportService {
  constructor(private readonly prisma: PrismaService, private readonly storage: S3Service,
    private readonly capture: EvidenceCaptureService, private readonly retention: RetentionPolicyService) {}

  async import(projectId: string, auditId: string, body: unknown): Promise<SecurityAuditImportResult> {
    const parsed = SecurityAuditReportSchema.safeParse(body);
    if (!parsed.success) {
      throw new ProblemException('VALIDATION_FAILED', 'findings.json does not match the security-audit report schema', {
        findings: parsed.error.errors.slice(0, 20).map(e => `${e.path.join('.')}: ${e.message}`) });
    }
    const audit = await this.prisma.audit.findFirst({ where: { id: auditId, projectId }, include: { target: true, repository: true, buildProvenance: true } });
    if (!audit) throw new ProblemException('NOT_FOUND', 'Audit not found');
    const commitSha = audit.buildProvenance?.commitSha;
    if (!commitSha) throw new ProblemException('CONFLICT', 'Audit has no build provenance; source locations cannot be anchored');
    const target = audit.target?.baseUrl ?? audit.repository?.url ?? '';
    const { findings, rejected } = normalizeSecurityAudit(parsed.data, { target });
    const evidenceId = await this.storeEvidence(projectId, auditId, JSON.stringify(parsed.data), parsed.data.length);
    const findingIds: string[] = [];

    await this.prisma.$transaction(async tx => {
      for (const f of findings) {
        const { findingId, created } = await upsertFindingOccurrence(tx, { projectId, auditId, fingerprint: f.fingerprint, severity: f.severity,
          create: { origin: 'whitebox', category: f.category, ruleId: f.ruleId, cwe: f.cwe, title: f.title, severity: f.severity,
            severitySource: f.severitySource, affectedTarget: target, description: f.description,
            reproduction: { ...f.reproduction, verdict: f.verdict, upstreamFingerprint: f.upstreamFingerprint, merged: f.merged, blockers: f.blockers },
            impact: f.impact, rootCause: f.rootCause, fix: f.fix, fixPatch: f.fixPatch, confidenceBand: f.confidenceBand,
            aiGenerated: true, gateEligible: false } });
        if (created) {
          await tx.sourceLocation.createMany({ data: f.sourceLocations.map(l => ({
            id: deterministicId('sourceLocation', `${findingId}:${l.file}:${l.enclosingSymbol}`),
            findingId, file: l.file, enclosingSymbol: l.enclosingSymbol, line: l.line, commitSha, verified: false })) });
        }
        await tx.findingEvidence.upsert({ where: { findingId_evidenceId: { findingId, evidenceId } },
          create: { findingId, evidenceId, role: 'primary' }, update: {} });
        findingIds.push(findingId);
      }
      // Coverage is recorded under the import role only; audit.executedCategories is deliberately untouched,
      // so an import can never satisfy a policy's required category on its own.
      const outcome = findings.length ? 'finding' : 'passed';
      await tx.agentCoverageResult.upsert({ where: { auditId_agentRole_category: { auditId, agentRole: SECURITY_AUDIT_IMPORT_ROLE, category: SECURITY_AUDIT_CATEGORY } },
        create: { id: deterministicId('coverage', `${auditId}:${SECURITY_AUDIT_IMPORT_ROLE}:${SECURITY_AUDIT_CATEGORY}`), auditId, agentRole: SECURITY_AUDIT_IMPORT_ROLE, category: SECURITY_AUDIT_CATEGORY, outcome },
        update: { outcome } });
      for (const r of rejected) {
        const id = deterministicId('passingCheck', `${auditId}:${createHash('sha256').update(r.upstreamFingerprint).digest('hex')}`);
        await tx.passingCheck.upsert({ where: { id }, update: {}, create: { id, auditId, checkId: `security-audit:${r.upstreamFingerprint}`, category: SECURITY_AUDIT_CATEGORY, target, evidenceIds: [evidenceId] } });
      }
    });
    return { evidenceId, confirmed: findings.filter(f => f.verdict === 'confirmed').length,
      needsValidation: findings.filter(f => f.verdict === 'needs_validation').length, rejected: rejected.length,
      merged: findings.reduce((n, f) => n + f.merged.length, 0), findingIds };
  }

  /**
   * Captures the raw report once per distinct content. The Evidence row is committed before any finding
   * is written, so a failed finding transaction never orphans the stored object: retention still owns it.
   */
  private async storeEvidence(projectId: string, auditId: string, raw: string, records: number): Promise<string> {
    const captured = this.capture.captureJson(auditId, raw);
    const evidenceId = deterministicId('evidence', `${auditId}:security_audit_json:${captured.sha256}`);
    const existing = await this.prisma.evidence.findUnique({ where: { id: evidenceId } });
    if (existing) {
      if (existing.tombstonedAt || existing.objectDeletedAt || existing.expiresAt <= new Date()) {
        throw new ProblemException('EVIDENCE_EXPIRED', 'This report was imported before and its evidence has since expired');
      }
      return evidenceId;
    }
    const stored = await this.storage.uploadEvidence(projectId, auditId, captured.bytes);
    if (stored.sha256 !== captured.sha256) throw new Error('Evidence storage returned a mismatched digest');
    await this.storage.verifyEvidence(stored.uri, captured.sha256, captured.sizeBytes);
    const expiresAt = await this.retention.expiryForCapture(projectId, { type: 'security_audit_json', replayable: false });
    await this.prisma.evidence.upsert({ where: { id: evidenceId }, update: {}, create: {
      id: evidenceId, auditId, tool: 'security-audit-skill', type: 'security_audit_json', replayable: false,
      artifactUri: stored.uri, sha256: captured.sha256, fullRedactedSha256: captured.fullRedactedSha256,
      sizeBytes: captured.sizeBytes, truncated: captured.truncated, redacted: captured.redacted, expiresAt,
      metadata: { source: 'cloudflare/security-audit-skill', records } } });
    return evidenceId;
  }
}
