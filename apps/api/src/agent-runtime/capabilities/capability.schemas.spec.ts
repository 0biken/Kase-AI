import { CapabilityExecutor } from './capability.executor';
import { RunHttpProbeSchema, CapabilitySchema } from './capability.schemas';
import { computeFingerprint, computeSeverity } from './finding-authority';

describe('M4 capability security and persistence', () => {
  function setup() {
    const evidence = { id: 'ev', auditId: 'audit', type: 'http_exchange', replayable: true, truncated: false, metadata: { url: 'https://target.test/invoices/1' } };
    const db: any = { audit: { findFirst: jest.fn().mockResolvedValue({ id: 'audit', status: 'running', cancellationRequestedAt: null, target: { baseUrl: 'https://target.test' } }), update: jest.fn() }, evidence: { findMany: jest.fn().mockResolvedValue([evidence]) }, findingIdentity: { upsert: jest.fn().mockResolvedValue({ id: 'identity' }) }, finding: { upsert: jest.fn() }, agentCoverageResult: { upsert: jest.fn() }, agentRun: { update: jest.fn() }, passingCheck: { upsert: jest.fn() }, endpointInventory: { findFirst: jest.fn().mockResolvedValue(null) }, testIdentity: { findMany: jest.fn().mockResolvedValue([]) } };
    db.$transaction = (fn: any) => fn(db);
    const trail = { record: jest.fn() }; const events = { append: jest.fn() };
    const executor = new CapabilityExecutor(db, trail as any, events as any, {} as any, {} as any);
    const call = (name: string, args: unknown, role = 'blackbox', attempt = 0) => executor.execute('audit','project','parent',role,0,'call',name,args,attempt);
    return { db, call, trail };
  }
  const finding = { category: 'authorization', severityProposed: 'low', title: 'Other owner invoice accessible', cwe: 'CWE-639', reproduction: { kind: 'http_replay', evidenceId: 'ev' }, impact: 'Other user data exposed', remediation: 'Check ownership', evidenceIds: ['ev'] };
  it('persists schema-shaped finding with trusted origin and authoritative severity', async () => {
    const { db, call } = setup();
    expect((await call('create_finding', { ...finding, type: 'white_box' })).success).toBe(true);
    expect(db.finding.upsert.mock.calls[0][0].create).toMatchObject({ origin: 'blackbox', severity: 'high', cwe: 'CWE-639', gateEligible: false, fix: 'Check ownership' });
  });
  it('rejects missing, expired or foreign evidence returned by scoped lookup', async () => {
    const { db, call } = setup(); db.evidence.findMany.mockResolvedValue([]);
    expect((await call('create_finding', finding)).success).toBe(false);
    expect(db.finding.upsert).not.toHaveBeenCalled();
    expect(db.evidence.findMany.mock.calls[0][0].where).toMatchObject({ auditId: 'audit', tombstonedAt: null, expiresAt: { gt: expect.any(Date) } });
  });
  it('requires blackbox reproduction itself to be replayable HTTP', async () => {
    const { db, call } = setup(); db.evidence.findMany.mockResolvedValue([{ id: 'ev', type: 'http_exchange', replayable: false, truncated: false }]);
    expect((await call('create_finding', finding)).error).toBe('missing_http_evidence');
  });
  it('rejects evidence whose type contradicts the reproduction kind', async () => {
    const { db, call } = setup(); db.evidence.findMany.mockResolvedValue([{ id: 'ev', type: 'http_exchange', replayable: true, truncated: false }]);
    expect((await call('create_finding', { ...finding, reproduction: { kind: 'scanner_hit', evidenceId: 'ev' } }, 'whitebox')).error).toBe('reproduction_evidence_mismatch');
    expect(db.finding.upsert).not.toHaveBeenCalled();
  });
  it('does not allow blackbox findings to invoke source lookup', async () => {
    const { call } = setup();
    expect((await call('create_finding', { ...finding, sourceLocations: [{ file: 'src/a.ts', enclosingSymbol: 'A.run' }] })).error).toBe('tool_unavailable');
  });
  it('stores model-proposed whitebox source locations as unverified', async () => {
    const { db } = setup();
    db.evidence.findMany.mockResolvedValue([{ id: 'ev', type: 'source_excerpt', replayable: true, truncated: false }]);
    db.audit.findFirst.mockResolvedValue({ id: 'audit', status: 'running', cancellationRequestedAt: null, repository: { url: 'repo' }, buildProvenance: { commitSha: 'a'.repeat(40) } });
    const executor = new CapabilityExecutor(db, { record: jest.fn() } as any, { append: jest.fn() } as any, {} as any,
      { source: jest.fn().mockResolvedValue({ startLine: 12 }) } as any);
    const result = await executor.execute('audit','project','parent','whitebox',0,'source','create_finding',
      { ...finding, reproduction: { kind: 'code_location', evidenceId: 'ev' }, sourceLocations: [{ file: 'src/a.ts', enclosingSymbol: 'A.run' }] });
    expect(result.success).toBe(true);
    expect(db.finding.upsert.mock.calls[0][0].create.sourceLocations.create[0]).toMatchObject({ line: 12, verified: false });
  });
  it('refuses capabilities once the audit is terminal or cancelled', async () => {
    const { db, call } = setup();
    db.audit.findFirst.mockResolvedValue({ id: 'audit', status: 'failed', cancellationRequestedAt: null });
    expect((await call('finish_audit', { summary: 'done' })).error).toBe('audit_not_active');
    db.audit.findFirst.mockResolvedValue({ id: 'audit', status: 'running', cancellationRequestedAt: new Date() });
    expect((await call('finish_audit', { summary: 'done' })).error).toBe('audit_not_active');
  });
  it('does not expose internal exception messages to the model', async () => {
    const { db, call } = setup(); db.evidence.findMany.mockRejectedValue(new Error('postgresql://user:secret@db/internal'));
    expect(await call('attach_evidence', { evidenceId: 'ev' })).toEqual({ success: false, error: 'capability_failed', message: 'Capability failed' });
  });
  it('bounds and orders the test identity inventory', async () => {
    const { db, call } = setup();
    expect((await call('get_endpoint_inventory', {})).success).toBe(true);
    expect(db.testIdentity.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { id: 'asc' }, take: 100 }));
  });
  it('cannot override capability discriminator through arguments', async () => {
    const { call, db } = setup();
    expect((await call('unknown', { capability: 'finish_audit', summary: 'done' })).success).toBe(false);
    expect(db.agentRun.update).not.toHaveBeenCalled();
  });
  it('reuses completed child invocation without redispatching effects', async () => {
    const { call, db } = setup(); db.auditJob = { findFirst: jest.fn().mockResolvedValue({ id: 'parent' }) };
    db.agentRun.findUniqueOrThrow = jest.fn().mockResolvedValue({ id: 'run' });
    db.agentToolInvocation = { findUnique: jest.fn().mockResolvedValue({ childJobId: 'child', status: 'completed', resultEvidenceIds: ['ev'] }) };
    expect(await call('run_http_probe', { testIdentityId: 'bob', url: 'https://target.test/invoices/1', method: 'GET' })).toEqual({ success: true, data: { jobId: 'child', status: 'completed', evidenceIds: ['ev'] } });
  });
  it('acknowledges finish for the loop to checkpoint before changing terminal state', async () => {
    const { call, db } = setup();
    expect(await call('finish_audit', { summary: 'done' })).toMatchObject({ success: true, data: { finished: true } });
    expect(db.agentRun.update).not.toHaveBeenCalled(); expect(db.audit.update).not.toHaveBeenCalled();
  });
  it('records correct coverage category and audit degradation', async () => {
    const { call, db } = setup(); await call('report_blocked', { category: 'authorization', reason: 'auth_failed' });
    expect(db.agentCoverageResult.upsert.mock.calls[0][0].create).toMatchObject({ category: 'authorization', blockedReason: 'auth_failed' });
    expect(db.audit.update).toHaveBeenCalledWith({ where: { id: 'audit' }, data: { degraded: true } });
  });
  it('records scope denials in durable audit trail', async () => {
    const { call, trail } = setup(); expect((await call('request_scope_change', { host: 'evil.test', reason: 'try more' })).error).toBe('scope_change_denied');
    expect(trail.record).toHaveBeenCalledWith(expect.objectContaining({ outcome: 'denied', projectId: 'project' }));
  });
  it.each(['Authorization','Cookie','Host','Proxy-Authorization','Connection','Content-Length'])('denies model supplied reserved header %s', name => {
    expect(RunHttpProbeSchema.safeParse({ capability: 'run_http_probe', testIdentityId: 'i', url: 'https://target.test', method: 'GET', headers: { [name]: 'secret' } }).success).toBe(false);
  });
  it('enforces bounded validation corrections', async () => { const {call}=setup(); expect((await call('run_tool', {}, 'blackbox', 100)).error).toBe('validation_limit_exceeded'); });
  it('keeps deterministic fingerprints independent of prose', () => {
    const input={ category:'authorization',ruleKey:'kase.agent.blackbox.authorization',target:'https://target.test',cwe:'CWE-639' };
    expect(computeFingerprint(input)).toBe(computeFingerprint({...input})); expect(computeSeverity('low','CWE-639').severity).toBe('high');
  });
});
