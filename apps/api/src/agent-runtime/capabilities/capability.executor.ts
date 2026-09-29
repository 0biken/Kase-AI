import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditTrailService } from '../../audit-trail/audit-trail.service';
import { AuditEventsService } from '../../audit-events/audit-events.service';
import { DurableQueueDispatcher } from '../../queue/durable-queue-dispatcher';
import { deterministicId } from '../../findings/finding-persistence.service';
import { CapabilitySchema, CapabilityArgs } from './capability.schemas';
import { computeSeverity, computeFingerprint, syntheticRuleKey } from './finding-authority';
import { MAX_VALIDATION_CORRECTIONS } from '../budget/budget-defaults';
import { CodeMapService } from '../code-map/code-map.service';

export interface CapabilityResult { success: boolean; data?: Record<string, unknown>; error?: string; validationErrors?: string[]; message?: string }
@Injectable()
export class CapabilityExecutor {
  constructor(private readonly prisma: PrismaService, private readonly auditTrail: AuditTrailService,
    private readonly auditEvents: AuditEventsService, private readonly queue: DurableQueueDispatcher,
    private readonly maps: CodeMapService) {}

  async execute(auditId: string, projectId: string, parentJobId: string, agentRole: string, turnSequence: number,
    callId: string, capabilityName: string, rawArgs: unknown, validationAttempt = 0): Promise<CapabilityResult> {
    const parsed = CapabilitySchema.safeParse({ ...(rawArgs && typeof rawArgs === 'object' ? rawArgs : {}), capability: capabilityName });
    if (!parsed.success) return { success: false, error: validationAttempt >= MAX_VALIDATION_CORRECTIONS ? 'validation_limit_exceeded' : 'validation_error', validationErrors: parsed.error.errors.map(e => `${e.path.join('.')}: ${e.message}`) };
    try {
      const audit = await this.prisma.audit.findFirst({ where: { id: auditId, projectId }, include: { target: true, repository: true, buildProvenance: true } });
      if (!audit || !['blackbox', 'whitebox'].includes(agentRole)) return { success: false, error: 'invalid_audit_context' };
      if (!['queued', 'running'].includes(audit.status) || audit.cancellationRequestedAt) return { success: false, error: 'audit_not_active' };
      const args = parsed.data;
      if (agentRole === 'blackbox' && ['get_source', 'search_source', 'get_route_map', 'run_sast'].includes(args.capability)) return { success: false, error: 'tool_unavailable', message: 'Source capabilities require whitebox role' };
      if (agentRole === 'whitebox' && args.capability === 'run_http_probe') return { success: false, error: 'tool_unavailable', message: 'HTTP capabilities require blackbox role' };
      const key = deterministicId('capability', `${auditId}:${agentRole}:${turnSequence}:${callId}`);
      switch (args.capability) {
        case 'request_scope_change':
          await this.auditTrail.record({ projectId, actorType: 'system', action: 'agent.scope_change.denied', resourceType: 'Audit', resourceId: auditId, metadata: { host: args.host, reason: args.reason }, outcome: 'denied' });
          return { success: false, error: 'scope_change_denied' };
        case 'run_http_probe': case 'run_sast': {
          if (args.capability === 'run_sast' && args.packReference !== 'typescript-security') return { success: false, error: 'tool_unavailable' };
          const parent = await this.prisma.auditJob.findFirst({ where: { id: parentJobId, auditId } });
          if (!parent) return { success: false, error: 'invalid_parent_job' };
          const run = await this.prisma.agentRun.findUniqueOrThrow({ where: { auditId_role: { auditId, role: agentRole } } });
          const prior = await this.prisma.agentToolInvocation.findUnique({ where: { agentRunId_turnSequence_callId: { agentRunId: run.id, turnSequence, callId } } });
          if (prior?.childJobId) return { success: true, data: { jobId: prior.childJobId, status: prior.status, evidenceIds: prior.resultEvidenceIds } };
          const kind = args.capability === 'run_http_probe' ? 'http' : 'semgrep';
          const jobId = deterministicId('auditJob', key);
          await this.prisma.$transaction(async tx => {
            await tx.auditJob.upsert({ where: { id: jobId }, create: { id: jobId, auditId, parentJobId, kind, status: 'queued', timeoutMs: 60000 }, update: {} });
            await tx.agentToolInvocation.upsert({ where: { agentRunId_turnSequence_callId: { agentRunId: run.id, turnSequence, callId } }, create: { id: key, agentRunId: run.id, turnSequence, callId, capability: args.capability, arguments: args, argumentsValid: true, status: 'dispatched', childJobId: jobId }, update: { arguments: args, argumentsValid: true, validationErrors: [], childJobId: jobId, status: 'dispatched' } });
          });
          await this.queue.enqueue(kind, { auditId, auditJobId: jobId, projectId });
          return { success: true, data: { jobId, status: 'pending' } };
        }
        case 'attach_evidence':
          await this.liveEvidence(auditId, [args.evidenceId]);
          return { success: true, data: { evidenceId: args.evidenceId } };
        case 'create_finding': {
          if (agentRole === 'blackbox' && args.sourceLocations?.length) return { success: false, error: 'tool_unavailable', message: 'Source locations require whitebox role' };
          const ids = [...new Set(args.evidenceIds)];
          const evidence = await this.liveEvidence(auditId, ids);
          const reproduction = evidence.find(e => e.id === args.reproduction.evidenceId);
          if (!reproduction) return { success: false, error: 'invalid_reproduction_evidence' };
          const reproductionEvidenceTypes: Record<typeof args.reproduction.kind, string> = {
            http_replay: 'http_exchange', code_location: 'source_excerpt', scanner_hit: 'sast_json',
          };
          if (reproduction.type !== reproductionEvidenceTypes[args.reproduction.kind]) return { success: false, error: 'reproduction_evidence_mismatch' };
          if (agentRole === 'blackbox' && (reproduction.type !== 'http_exchange' || !reproduction.replayable || reproduction.truncated)) return { success: false, error: 'missing_http_evidence' };
          const origin = agentRole as 'blackbox' | 'whitebox';
          const severity = computeSeverity(args.severityProposed, args.cwe, args.category);
          const metadata = reproduction.metadata as Record<string, unknown> | null;
          const endpoint = typeof metadata?.url === 'string' ? new URL(metadata.url).pathname : '';
          const target = audit.target?.baseUrl ?? audit.repository?.url ?? '';
          const ruleId = syntheticRuleKey(origin, args.category);
          const fingerprint = computeFingerprint({ category: args.category, ruleKey: ruleId, target, endpoint, cwe: args.cwe });
          const locations: Array<{ id: string; file: string; enclosingSymbol: string; line: number; commitSha: string; verified: boolean }> = [];
          for (const location of args.sourceLocations ?? []) {
            if (!audit.buildProvenance?.commitSha) throw new Error('Source locations require audit provenance');
            const excerpt = await this.maps.source(auditId, projectId, { file: location.file, symbol: location.enclosingSymbol, maxLines: 1 });
            locations.push({ id: deterministicId('sourceLocation', `${key}:${location.file}:${location.enclosingSymbol}`), file: location.file, enclosingSymbol: location.enclosingSymbol, line: excerpt.startLine, commitSha: audit.buildProvenance.commitSha, verified: false });
          }
          let identityId = deterministicId('findingIdentity', `${projectId}:${fingerprint}`);
          let findingId = deterministicId('finding', `${auditId}:${identityId}`);
          await this.prisma.$transaction(async tx => {
            const identity = await tx.findingIdentity.upsert({ where: { projectId_fingerprint: { projectId, fingerprint } }, create: { id: identityId, projectId, fingerprint, status: 'new', firstSeenAuditId: auditId, lastSeenAuditId: auditId, occurrences: 1, currentSeverity: severity.severity }, update: { lastSeenAuditId: auditId, currentSeverity: severity.severity } });
            identityId = identity.id;
            findingId = deterministicId('finding', `${auditId}:${identityId}`);
            await tx.finding.upsert({ where: { auditId_identityId: { auditId, identityId } }, create: { id: findingId, auditId, identityId, origin, category: args.category, ruleId, cwe: args.cwe, title: args.title, ...severity, affectedTarget: target, description: args.impact, reproduction: args.reproduction, impact: args.impact, fix: args.remediation, fixPatch: args.remediationPatch, confidenceBand: 'medium', aiGenerated: true, gateEligible: false, sourceLocations: { create: locations }, findingEvidence: { create: ids.map(evidenceId => ({ evidenceId, role: 'primary' })) } }, update: {} });
            await tx.agentCoverageResult.upsert({ where: { auditId_agentRole_category: { auditId, agentRole, category: args.category } }, create: { id: deterministicId('coverage', `${auditId}:${agentRole}:${args.category}`), auditId, agentRole, category: args.category, outcome: 'finding' }, update: { outcome: 'finding', blockedReason: null } });
          });
          return { success: true, data: { findingId, ...severity, gateEligible: false } };
        }
        case 'record_passing_check':
          if (args.evidenceIds?.length) await this.liveEvidence(auditId, args.evidenceIds);
          await this.prisma.passingCheck.upsert({ where: { id: key }, create: { id: key, auditId, checkId: args.checkId, category: args.category, target: args.target }, update: {} });
          await this.coverage(auditId, agentRole, args.category, 'passed');
          return { success: true, data: { checkId: key } };
        case 'report_blocked':
          await this.coverage(auditId, agentRole, args.category, 'blocked', args.reason);
          await this.prisma.audit.update({ where: { id: auditId }, data: { degraded: true } });
          return { success: true };
        case 'get_endpoint_inventory': {
          const inventory = await this.prisma.endpointInventory.findFirst({ where: { auditId, projectId }, include: { endpoints: { take: 200, orderBy: { pathTemplate: 'asc' } } } });
          const identities = await this.prisma.testIdentity.findMany({ where: { projectId, targetId: audit.targetId ?? '', active: true, credentialSecret: { revokedAt: null } }, select: { id: true, label: true, targetId: true }, orderBy: { id: 'asc' }, take: 100 });
          return { success: true, data: { inventory: inventory?.endpoints ?? [], identities, untrusted: true } };
        }
        case 'get_route_map': return { success: true, data: { routes: await this.maps.routes(auditId, projectId), untrusted: true } };
        case 'get_source': return { success: true, data: { ...(await this.maps.source(auditId, projectId, args)), untrusted: true } };
        case 'search_source': return { success: true, data: { results: await this.maps.search(auditId, projectId, args), untrusted: true } };
        case 'finish_audit':
          // The loop checkpoints this acknowledgement before marking the run
          // terminal. A crash here must not bypass durable transcript storage.
          return { success: true, data: { finished: true, summary: args.summary } };
      }
    } catch { return { success: false, error: 'capability_failed', message: 'Capability failed' }; }
  }
  private async liveEvidence(auditId: string, ids: string[]) {
    const rows = await this.prisma.evidence.findMany({ where: { id: { in: [...new Set(ids)] }, auditId, tombstonedAt: null, expiresAt: { gt: new Date() } } });
    if (rows.length !== new Set(ids).size) throw new Error('Evidence must be live and belong to this audit');
    return rows;
  }
  private async coverage(auditId: string, agentRole: string, category: string, outcome: string, blockedReason?: string) {
    await this.prisma.agentCoverageResult.upsert({ where: { auditId_agentRole_category: { auditId, agentRole, category } }, create: { id: deterministicId('coverage', `${auditId}:${agentRole}:${category}`), auditId, agentRole, category, outcome, blockedReason }, update: { outcome, blockedReason: blockedReason ?? null } });
  }
}

