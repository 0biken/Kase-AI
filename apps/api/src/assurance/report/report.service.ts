import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { ProblemException } from '../../common/problem-details';
import { methodologyRoot } from '../../agent-runtime/methodology.guard';
import { GatePolicyService } from '../policy/gate-policy.service';
import { buildReport, type ReportDocument, type ReportInput } from './report-builder';

const DEFAULT_WARN_DAYS = 7;

/** The "## Severity rubric" section of the methodology's finding format, verbatim. */
export function extractSeverityRubric(findingFormat: string): string {
  const start = findingFormat.search(/^## Severity rubric\s*$/mu);
  if (start < 0) return '';
  const rest = findingFormat.slice(start).split('\n').slice(1);
  const end = rest.findIndex(line => /^## /u.test(line));
  return (end < 0 ? rest : rest.slice(0, end)).join('\n').trim();
}

function notExecuted(value: unknown): Array<{ category: string; reason: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap(entry => {
    if (typeof entry === 'string') return [{ category: entry, reason: 'not executed' }];
    if (entry && typeof entry === 'object' && typeof (entry as { category?: unknown }).category === 'string') {
      const e = entry as { category: string; reason?: unknown };
      return [{ category: e.category, reason: typeof e.reason === 'string' ? e.reason : 'not executed' }];
    }
    return [];
  });
}

/**
 * Loads one audit's state and hands it to the pure report builder. Read-only:
 * a report never changes findings, waivers or the gate record.
 */
@Injectable()
export class ReportService {
  private rubric?: string;

  constructor(private readonly prisma: PrismaService, private readonly policies: GatePolicyService) {}

  private severityRubric(): string {
    if (this.rubric === undefined) {
      try {
        this.rubric = extractSeverityRubric(readFileSync(join(methodologyRoot(), 'blackbox/finding-format.md'), 'utf8'));
      } catch {
        this.rubric = '';
      }
    }
    return this.rubric || '_Severity rubric unavailable: the methodology could not be read._';
  }

  async build(auditId: string, now = new Date()): Promise<ReportDocument> {
    const audit = await this.prisma.audit.findUnique({
      where: { id: auditId },
      include: { project: true, target: true, repository: true, buildProvenance: true },
    });
    if (!audit) throw new ProblemException('NOT_FOUND', `No audit with id "${auditId}"`);

    const [rows, correlations, passing, waivers, suppressions, gate, warnDays] = await Promise.all([
      this.prisma.finding.findMany({
        where: { auditId },
        include: { identity: true, sourceLocations: true, findingEvidence: { include: { evidence: true } } },
      }),
      this.prisma.correlation.findMany({ where: { auditId } }),
      this.prisma.passingCheck.findMany({ where: { auditId } }),
      this.prisma.waiver.findMany({ where: { projectId: audit.projectId } }),
      this.prisma.suppression.findMany({ where: { projectId: audit.projectId } }),
      this.prisma.gateEvaluation.findFirst({ where: { auditId }, orderBy: { evaluatedAt: 'desc' } }),
      this.policies.getActiveParsed(audit.projectId)
        .then(active => active.policy.waivers.warn_before_expiry_days)
        .catch(() => DEFAULT_WARN_DAYS),
    ]);

    const byFinding = new Map<string, { method: string; verified: boolean }>();
    for (const c of correlations) {
      const info = { method: c.method, verified: c.verified };
      byFinding.set(c.blackboxFindingId, info);
      if (c.whiteboxFindingId) byFinding.set(c.whiteboxFindingId, info);
    }
    const suppressed = new Set(suppressions.map(s => s.fingerprint));
    const fingerprints = new Set(rows.map(f => f.identity.fingerprint));

    const input: ReportInput = {
      project: { name: audit.project.name, slug: audit.project.slug },
      audit: {
        id: audit.id, mode: audit.mode, status: audit.status, degraded: audit.degraded,
        degradationReasons: audit.degradationReasons ?? [],
        target: audit.target?.baseUrl ?? null, repository: audit.repository?.url ?? null,
        commitSha: audit.requestedCommitSha ?? null, provenanceVerified: audit.buildProvenance?.verified ?? false,
        startedAt: audit.startedAt, completedAt: audit.completedAt ?? null,
        requestedCategories: audit.requestedCategories ?? [], executedCategories: audit.executedCategories ?? [],
        notExecutedCategories: notExecuted(audit.notExecutedCategories),
      },
      findings: rows.map(f => ({
        id: f.id, fingerprint: f.identity.fingerprint, status: f.identity.status, origin: f.origin, category: f.category,
        cwe: f.cwe, title: f.title, severity: f.severity, affectedTarget: f.affectedTarget, description: f.description,
        reproduction: f.reproduction, impact: f.impact, rootCause: f.rootCause, fix: f.fix, fixPatch: f.fixPatch,
        confidenceBand: f.confidenceBand, aiGenerated: f.aiGenerated,
        sourceLocations: f.sourceLocations.map(s => ({ file: s.file, enclosingSymbol: s.enclosingSymbol, line: s.line, verified: s.verified })),
        evidence: f.findingEvidence.map(fe => ({ id: fe.evidence.id, type: fe.evidence.type, replayable: fe.evidence.replayable, sha256: fe.evidence.sha256 })),
        correlation: byFinding.get(f.id) ?? null,
        suppressed: suppressed.has(f.identity.fingerprint),
      })),
      passingChecks: passing.map(p => ({ category: p.category, checkId: p.checkId, target: p.target ?? null })),
      // Only waivers that cover something in this audit belong in its report.
      waivers: waivers.filter(w => fingerprints.has(w.fingerprint)).map(w => ({
        fingerprint: w.fingerprint, reason: w.reason, requestedBy: w.requestedBy, approvedBy: w.approvedBy, expiresAt: w.expiresAt,
      })),
      gate: gate ? {
        outcome: gate.outcome, policyVersion: gate.gatePolicyVersion, blockingFindingIds: gate.blockingFindingIds,
        waivedFindingIds: gate.waivedFindingIds, evaluatedAt: gate.evaluatedAt,
      } : null,
      warnBeforeExpiryDays: warnDays,
      severityRubric: this.severityRubric(),
      generatedAt: now,
    };
    return buildReport(input);
  }
}
