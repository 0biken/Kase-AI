import { createHash } from 'crypto';
import { SecurityAuditReportSchema } from '../adapters/security-audit/security-audit.schema';
import { normalizeSecurityAudit } from './security-audit-normalizer';
import { SecurityAuditImportService, SECURITY_AUDIT_IMPORT_ROLE } from './security-audit-import.service';
import { EvidenceCaptureService } from '../evidence/evidence-capture.service';
import { classifyEvidence } from '../assurance/gate/evidence-classification';

const trace = [
  { kind: 'entrypoint', file: 'src/orders.controller.ts', line: 10, scope: 'OrdersController.get', description: 'route' },
  { kind: 'sink', file: 'src/orders.service.ts', line: 42, scope: 'OrdersService.getOrder', description: 'unscoped lookup' },
];
const loopyTrace = [trace[0],
  { kind: 'propagation', file: 'src/orders.service.ts', line: 40, scope: 'OrdersService.getOrder', description: 'a' },
  { kind: 'propagation', file: 'src/orders.service.ts', line: 41, scope: 'OrdersService.getOrder', description: 'b' }, trace[1]];
const ssrfTrace = [
  { kind: 'entrypoint', file: 'src/webhooks.controller.ts', line: 5, scope: 'WebhooksController.create', description: 'route' },
  { kind: 'sink', file: 'src/webhooks.service.ts', line: 30, scope: 'WebhooksService.deliver', description: 'fetch(url)' },
];
const evidence = [{ file: 'src/orders.service.ts', line: 42, description: 'findOne without owner' }];
const confirmed = {
  verdict: 'confirmed', fingerprint: 'idor:orders.getOrder', title: 'IDOR in orders (CWE-639)', description: 'Any user reads any order',
  root_cause: 'No ownership predicate', intended_behavior: 'Owner-only access', trace, evidence, conditions: [],
  execution: { attacker_perspective: 'user A', payloads: ['GET /orders/2'], instructions: ['login as A'], observed_result: '200 with B data' },
  remediation: { strategy: 'Add owner predicate', code_changes: [{ file_name: 'src/orders.service.ts', fixed_code: 'where: { id, ownerId }' }] },
  severity: { likelihood: { score: 'high', reason: 'easy' }, impact: { score: 'low', reason: 'order data exposed' }, overall_severity: 'low' },
  confidence: { score: 'high', reason: 'traced' },
};
const needsValidation = { verdict: 'needs_validation', fingerprint: 'ssrf:webhook', title: 'Possible SSRF (CWE-918)', description: 'd', claimed_root_cause: 'c',
  trace: ssrfTrace, evidence, blockers: ['needs deployed egress config'], validation_plan: { deployment: 'probe staging' } };
const rejected = { verdict: 'rejected', fingerprint: 'xss:x', title: 'XSS', description: 'd', claimed_root_cause: 'c', trace, evidence, reason: 'output is encoded' };

const norm = (records: unknown[]) => normalizeSecurityAudit(SecurityAuditReportSchema.parse(records), { target: 'https://git.example/o/r' });

describe('security-audit skill import', () => {
  it('parses all three verdicts and rejects unknown keys / missing fields', () => {
    expect(SecurityAuditReportSchema.parse([confirmed, needsValidation, rejected])).toHaveLength(3);
    expect(() => SecurityAuditReportSchema.parse([{ ...rejected, extra: 1 }])).toThrow();
    expect(() => SecurityAuditReportSchema.parse([{ ...rejected, trace: [] }])).toThrow();
    expect(() => SecurityAuditReportSchema.parse([{ ...rejected, fingerprint: '-bad' }])).toThrow();
    expect(() => SecurityAuditReportSchema.parse([{ ...confirmed, severity: undefined }])).toThrow();
  });

  it('keeps imports AI-generated and never gate-eligible', () => {
    const { findings, rejected: dropped } = norm([confirmed, needsValidation, rejected]);
    expect(findings).toHaveLength(2);
    expect(dropped).toEqual([{ upstreamFingerprint: 'xss:x', title: 'XSS', reason: 'output is encoded' }]);
    for (const f of findings) { expect(f.gateEligible).toBe(false); expect(f.aiGenerated).toBe(true); }
  });

  it('applies Kase severity floors to confirmed findings: skill severity may raise but never lower', () => {
    const [f] = norm([confirmed]).findings;
    expect(f.cwe).toBe('CWE-639');
    expect(f.severity).toBe('high'); // skill said low; CWE-639 floor is high
    expect(norm([{ ...confirmed, severity: { ...confirmed.severity, overall_severity: 'critical' } }]).findings[0].severity).toBe('critical');
  });

  it('gives unvalidated leads no severity at all, even when a CWE floor exists', () => {
    const [f] = norm([needsValidation]).findings;
    expect(f.cwe).toBe('CWE-918'); // its floor would be high
    expect(f).toMatchObject({ severity: 'informational', severitySource: 'unvalidated_lead', verdict: 'needs_validation' });
    expect(f.blockers).toEqual(['needs deployed egress config']);
  });

  it('fingerprint ignores line numbers, prose, CWE mentions and the upstream fingerprint', () => {
    const fp = (r: unknown) => norm([r]).findings[0].fingerprint;
    const reworded = { ...confirmed, fingerprint: 'other-id', title: 'Orders leak', description: 'reworded, unlike CWE-79',
      root_cause: 'reworded', trace: trace.map(t => ({ ...t, line: t.line + 100, description: 'changed' })) };
    expect(fp(reworded)).toBe(fp(confirmed));
    expect(fp({ ...confirmed, trace: [trace[0], { ...trace[1], scope: 'Other.fn' }] })).not.toBe(fp(confirmed));
    expect(fp({ ...confirmed, trace: [{ ...trace[0], scope: 'Admin.get' }, trace[1]] })).not.toBe(fp(confirmed));
  });

  it('merges records on the same entrypoint and sink visibly, preferring confirmed over leads', () => {
    const lead = { ...needsValidation, fingerprint: 'lead-on-orders', trace };
    const second = { ...confirmed, fingerprint: 'sqli:orders', title: 'Second issue', severity: { ...confirmed.severity, overall_severity: 'medium' } };
    for (const order of [[lead, confirmed, second], [second, lead, confirmed]]) {
      const { findings } = norm(order);
      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({ verdict: 'confirmed', severity: 'high' });
      const all = [findings[0].upstreamFingerprint, ...findings[0].merged.map(m => m.upstreamFingerprint)].sort();
      expect(all).toEqual(['idor:orders.getOrder', 'lead-on-orders', 'sqli:orders']);
      expect(findings[0].blockers).toEqual(['needs deployed egress config']);
    }
  });

  it('dedupes source locations that repeat a file and scope', () => {
    const [f] = norm([{ ...confirmed, trace: loopyTrace }]).findings;
    expect(f.sourceLocations.map(l => `${l.file}#${l.enclosingSymbol}`))
      .toEqual(['src/orders.controller.ts#OrdersController.get', 'src/orders.service.ts#OrdersService.getOrder']);
  });

  it('classifies imported skill output as ai_inference so it can never block', () => {
    expect(classifyEvidence('security_audit_json', true)).toBe('ai_inference');
    expect(classifyEvidence('security_audit_json', false)).toBe('ai_inference');
  });
});

describe('SecurityAuditImportService', () => {
  function build(options: { existingEvidence?: Record<string, unknown> } = {}) {
    const calls: Record<string, any[]> = { evidence: [], finding: [], identityUpdate: [], locations: [], coverage: [], passing: [], uploads: [], audit: [] };
    const existingFindings = new Set<string>();
    const tx = {
      findingIdentity: { upsert: async (a: any) => ({ id: a.create.id }), update: async (a: any) => { calls.identityUpdate.push(a); } },
      finding: {
        findUnique: async (a: any) => existingFindings.has(a.where.auditId_identityId.identityId) ? { id: 'f' } : null,
        upsert: async (a: any) => { calls.finding.push(a); existingFindings.add(a.where.auditId_identityId.identityId); return { id: a.create.id }; },
      },
      sourceLocation: { createMany: async (a: any) => { calls.locations.push(...a.data); } },
      findingEvidence: { upsert: async () => undefined },
      agentCoverageResult: { upsert: async (a: any) => { calls.coverage.push(a); } },
      passingCheck: { upsert: async (a: any) => { calls.passing.push(a); } },
      audit: { update: async (a: any) => { calls.audit.push(a); } },
    };
    const prisma = {
      audit: { findFirst: async () => ({ id: 'audit_1', target: null, repository: { url: 'https://git.example/o/r' }, buildProvenance: { commitSha: 'a'.repeat(40) } }) },
      evidence: { findUnique: async () => options.existingEvidence ?? null, upsert: async (a: any) => { calls.evidence.push(a); } },
      $transaction: async (fn: any) => fn(tx),
    };
    const storage = {
      uploadEvidence: async (_p: string, _a: string, b: Buffer) => { calls.uploads.push(b); return { uri: 's3://x', sha256: createHash('sha256').update(b).digest('hex') }; },
      verifyEvidence: async () => undefined,
    };
    const retention = { expiryForCapture: async () => new Date(Date.now() + 1e9) };
    return { svc: new SecurityAuditImportService(prisma as any, storage as any, new EvidenceCaptureService(), retention as any), calls };
  }

  it('persists non-replayable evidence and AI findings without touching the audit', async () => {
    const { svc, calls } = build();
    const result = await svc.import('prj_1', 'audit_1', [confirmed, needsValidation, rejected]);
    expect(result).toMatchObject({ confirmed: 1, needsValidation: 1, rejected: 1, merged: 0 });
    expect(calls.evidence[0].create).toMatchObject({ type: 'security_audit_json', replayable: false });
    for (const c of calls.finding) expect(c.create).toMatchObject({ origin: 'whitebox', aiGenerated: true, gateEligible: false });
    expect(calls.audit).toHaveLength(0);
    expect(calls.passing).toHaveLength(1);
  });

  it('writes source locations with unique ids even when trace steps share a scope', async () => {
    const { svc, calls } = build();
    await svc.import('prj_1', 'audit_1', [{ ...confirmed, trace: loopyTrace }]);
    const ids = calls.locations.map((l: any) => l.id);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('counts an identity occurrence once per audit and does not rewrite locations on re-import', async () => {
    const { svc, calls } = build();
    await svc.import('prj_1', 'audit_1', [confirmed]);
    await svc.import('prj_1', 'audit_1', [confirmed]);
    expect(calls.identityUpdate).toHaveLength(1);
    expect(calls.identityUpdate[0].data).toEqual({ occurrences: { increment: 1 } });
    expect(calls.locations).toHaveLength(2);
  });

  it('records coverage under its own role so it cannot overwrite agent coverage', async () => {
    const { svc, calls } = build();
    await svc.import('prj_1', 'audit_1', [rejected]);
    expect(SECURITY_AUDIT_IMPORT_ROLE).not.toBe('whitebox');
    expect(calls.coverage[0].where.auditId_agentRole_category.agentRole).toBe(SECURITY_AUDIT_IMPORT_ROLE);
  });

  it('reuses live evidence instead of uploading again, and refuses expired evidence', async () => {
    const live = build({ existingEvidence: { tombstonedAt: null, objectDeletedAt: null, expiresAt: new Date(Date.now() + 1e9) } });
    await live.svc.import('prj_1', 'audit_1', [confirmed]);
    expect(live.calls.uploads).toHaveLength(0);
    expect(live.calls.evidence).toHaveLength(0);
    const expired = build({ existingEvidence: { tombstonedAt: new Date(), objectDeletedAt: null, expiresAt: new Date(Date.now() + 1e9) } });
    await expect(expired.svc.import('prj_1', 'audit_1', [confirmed])).rejects.toMatchObject({ code: 'EVIDENCE_EXPIRED' });
    expect(expired.calls.finding).toHaveLength(0);
  });

  it('rejects schema-invalid bodies with a validation problem and writes nothing', async () => {
    const { svc, calls } = build();
    await expect(svc.import('prj_1', 'audit_1', [{ verdict: 'confirmed' }])).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls.evidence).toHaveLength(0);
    expect(calls.uploads).toHaveLength(0);
  });
});
