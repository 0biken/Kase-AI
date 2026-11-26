import { evaluateGate, type GateFindingInput } from '../assurance/gate/gate-engine';
import { parsePolicy } from '../assurance/policy/policy-schema';
import { advisorResponseSchema, classifyDedup, compatibleSeverity, normalizeTarget, pairKey, type DedupSubject } from './dedup';
import { checkDecision, DECISIONS, observe, producingCategories, promoteNew } from './lifecycle';
import { applyAuditOutcome, DedupService, LifecycleService, runDedup } from './finding-review.service';
import type { Actor } from '../projects/projects.service';

const ACTOR: Actor = { type: 'user', id: 'usr_reviewer', organizationId: 'org' };

function subject(over: Partial<DedupSubject> = {}): DedupSubject {
  return { identityId: 'new', fingerprint: 'fp-new', category: 'authorization', cwe: 'CWE-639', severity: 'high',
    normalizedTarget: 'GET /api/invoices/{id}', hasSourceLocation: false, title: 't', description: 'd', ...over };
}
const none = { rejectedPairs: new Set<string>() };

describe('M5 dedup — classification (09-findings §5)', () => {
  it('level 1: equal fingerprints always MATCH', () => {
    expect(classifyDedup(subject(), [subject({ identityId: 'old', fingerprint: 'fp-new', category: 'other' })], none))
      .toEqual({ outcome: 'MATCH', level: 1, identityId: 'old' });
  });

  it('level 2: a single fully agreeing structural candidate MATCHes', () => {
    expect(classifyDedup(subject(), [subject({ identityId: 'old', fingerprint: 'fp-old', severity: 'critical' })], none))
      .toEqual({ outcome: 'MATCH', level: 2, identityId: 'old' });
  });

  it('level 2: cwe absent on one side is POSSIBLE_MATCH, never MATCH', () => {
    expect(classifyDedup(subject({ cwe: null }), [subject({ identityId: 'old', fingerprint: 'fp-old' })], none))
      .toEqual({ outcome: 'POSSIBLE_MATCH', level: 2, candidates: [{ identityId: 'old', confidenceBand: 'medium' }] });
  });

  it('level 2: several agreeing candidates are ambiguous and go to a human', () => {
    const out = classifyDedup(subject(), [subject({ identityId: 'a', fingerprint: 'fa' }), subject({ identityId: 'b', fingerprint: 'fb' })], none);
    expect(out).toMatchObject({ outcome: 'POSSIBLE_MATCH', level: 2 });
  });

  it('level 2: needs the same category, target, cwe and a compatible severity band, and no source location', () => {
    for (const other of [
      subject({ identityId: 'o', fingerprint: 'f', category: 'injection' }),
      subject({ identityId: 'o', fingerprint: 'f', normalizedTarget: 'GET /api/orders/{id}' }),
      subject({ identityId: 'o', fingerprint: 'f', cwe: 'CWE-89' }),
      subject({ identityId: 'o', fingerprint: 'f', severity: 'low' }),
      subject({ identityId: 'o', fingerprint: 'f', hasSourceLocation: true }),
    ]) expect(classifyDedup(subject(), [other], none)).toEqual({ outcome: 'NEW_FINDING' });
    expect(classifyDedup(subject({ hasSourceLocation: true }), [subject({ identityId: 'o', fingerprint: 'f' })], none)).toEqual({ outcome: 'NEW_FINDING' });
    expect(compatibleSeverity('high', 'critical')).toBe(true);
    expect(compatibleSeverity('high', 'low')).toBe(false);
    expect(compatibleSeverity('high', 'bogus')).toBe(false);
  });

  it('never re-proposes a pair a human rejected', () => {
    const rejected = { rejectedPairs: new Set([pairKey('old', 'new')]) };
    expect(classifyDedup(subject({ cwe: null }), [subject({ identityId: 'old', fingerprint: 'fp-old' })], rejected)).toEqual({ outcome: 'NEW_FINDING' });
  });

  it('level 3: AI similarity yields POSSIBLE_MATCH at most, and only for known same-category identities', () => {
    const others = [subject({ identityId: 'a', fingerprint: 'fa', normalizedTarget: null }), subject({ identityId: 'x', fingerprint: 'fx', category: 'injection' })];
    const out = classifyDedup(subject({ normalizedTarget: null }), others, none, [
      { identityId: 'a', band: 'high' }, { identityId: 'x', band: 'high' }, { identityId: 'ghost', band: 'high' },
    ]);
    expect(out).toEqual({ outcome: 'POSSIBLE_MATCH', level: 3, candidates: [{ identityId: 'a', confidenceBand: 'high' }] });
    expect(classifyDedup(subject({ normalizedTarget: null }), others, none, [{ identityId: 'a', band: 'low' }])).toEqual({ outcome: 'NEW_FINDING' });
  });

  it('accepts only schema-valid advisor output, with bands and no numeric scores', () => {
    expect(advisorResponseSchema.safeParse({ similar: [{ identityId: 'a', band: 'high' }] }).success).toBe(true);
    for (const bad of [{ similar: [{ identityId: 'a', band: 'high', score: 0.97 }] }, { similar: [{ identityId: 'a', band: 0.9 }] }, { similar: [], match: 'a' }, 'MATCH']) {
      expect(advisorResponseSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('normalises targets structurally, never from prose', () => {
    expect(normalizeTarget('GET https://t.test/api/invoices/inv_1001?x=1')).toBe('GET /api/invoices/{id}');
    expect(normalizeTarget('get /api/invoices/42/')).toBe('GET /api/invoices/{id}');
    expect(normalizeTarget('https://t.test/api/users/0e8f9a3c-1234-4abc-8def-0123456789ab')).toBe('ANY /api/users/{id}');
    expect(normalizeTarget(null)).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */
/* A small in-memory Prisma for the persistence paths.                       */
/* ------------------------------------------------------------------------ */

type Row = Record<string, any>;
function matches(row: Row, where: Row = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as Row[]).some(c => matches(row, c));
    if (key === 'findings') return true; // relation filter: callers in these tests only ever pass `some: { category }` that holds
    if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
      if ('in' in cond) return (cond.in as unknown[]).includes(row[key]);
      if ('notIn' in cond) return !(cond.notIn as unknown[]).includes(row[key]);
      if ('not' in cond) return row[key] !== cond.not;
      return false;
    }
    return row[key] === cond;
  });
}
function apply(row: Row, data: Row) {
  for (const [k, v] of Object.entries(data)) {
    if (v && typeof v === 'object' && 'increment' in v) row[k] += v.increment;
    else if (v && typeof v === 'object' && 'decrement' in v) row[k] -= v.decrement;
    else row[k] = v;
  }
  return row;
}

function store() {
  const t = { identities: [] as Row[], findings: [] as Row[], relations: [] as Row[], evidence: [] as Row[], locations: [] as Row[], suppressions: [] as Row[] };
  const findingView = (f: Row) => ({ ...f,
    identity: t.identities.find(i => i.id === f.identityId),
    findingEvidence: t.evidence.filter(e => e.findingId === f.id),
    _count: { sourceLocations: t.locations.filter(l => l.findingId === f.id).length } });
  const db: any = {
    finding: {
      findFirst: async ({ where }: Row) => { const f = t.findings.find(r => matches(r, where)); return f ? findingView(f) : null; },
      findUnique: async ({ where }: Row) => {
        const f = where.auditId_identityId ? t.findings.find(r => r.auditId === where.auditId_identityId.auditId && r.identityId === where.auditId_identityId.identityId) : t.findings.find(r => r.id === where.id);
        return f ? findingView(f) : null;
      },
      findMany: async ({ where }: Row) => t.findings.filter(r => matches(r, where)).map(findingView),
      update: async ({ where, data }: Row) => apply(t.findings.find(r => r.id === where.id)!, data),
      delete: async ({ where }: Row) => { t.findings = t.findings.filter(r => r.id !== where.id); t.evidence = t.evidence.filter(e => e.findingId !== where.id); },
    },
    findingIdentity: {
      findUnique: async ({ where }: Row) => { const r = t.identities.find(i => i.id === where.id); return r ? { ...r } : null; },
      findMany: async ({ where }: Row) => t.identities.filter(r => matches(r, where)).map(i => ({ ...i,
        findings: t.findings.filter(f => f.identityId === i.id).slice(0, 1).map(findingView) })),
      update: async ({ where, data }: Row) => apply(t.identities.find(r => r.id === where.id)!, data),
    },
    findingRelation: {
      findUnique: async ({ where }: Row) => t.relations.find(r => r.id === where.id) ?? null,
      findMany: async ({ where }: Row) => t.relations.filter(r => matches(r, where)),
      upsert: async ({ where, create }: Row) => {
        const k = where.fromFindingId_toFindingId_kind;
        const found = t.relations.find(r => r.fromFindingId === k.fromFindingId && r.toFindingId === k.toFindingId && r.kind === k.kind);
        if (found) return found;
        const row = { createdAt: new Date(), ...create }; t.relations.push(row); return row;
      },
      update: async ({ where, data }: Row) => apply(t.relations.find(r => r.id === where.id)!, data),
      updateMany: async ({ where, data }: Row) => { const rows = t.relations.filter(r => matches(r, where)); rows.forEach(r => apply(r, data)); return { count: rows.length }; },
    },
    findingEvidence: {
      createMany: async ({ data }: Row) => { for (const d of data) if (!t.evidence.some(e => e.findingId === d.findingId && e.evidenceId === d.evidenceId)) t.evidence.push(d); },
    },
    sourceLocation: { updateMany: async ({ where, data }: Row) => { t.locations.filter(l => matches(l, where)).forEach(l => apply(l, data)); } },
    suppression: {
      findFirst: async ({ where }: Row) => t.suppressions.find(r => matches(r, where)) ?? null,
      create: async ({ data }: Row) => { t.suppressions.push(data); return data; },
      deleteMany: async ({ where }: Row) => { t.suppressions = t.suppressions.filter(r => !matches(r, where)); },
    },
  };
  db.$transaction = async (fn: (tx: unknown) => unknown) => fn(db);

  const add = (id: string, o: { audit?: string; category?: string; cwe?: string | null; target?: string; status?: string; firstSeen?: string; occurrences?: number; evidence?: string[]; locations?: number } = {}) => {
    const audit = o.audit ?? 'aud_1';
    t.identities.push({ id, projectId: 'prj', fingerprint: `fp-${id}`, status: o.status ?? 'new', firstSeenAuditId: o.firstSeen ?? audit,
      lastSeenAuditId: audit, occurrences: o.occurrences ?? 1, currentSeverity: 'high', mergedIntoIdentityId: null });
    const findingId = `f_${id}_${audit}`;
    t.findings.push({ id: findingId, auditId: audit, identityId: id, origin: 'blackbox', category: o.category ?? 'authorization', cwe: o.cwe === undefined ? 'CWE-639' : o.cwe,
      severity: 'high', title: `title ${id}`, description: 'd', affectedTarget: o.target ?? 'GET https://t.test/api/invoices/inv_1', reproduction: { kind: 'http_replay' } });
    for (const ev of o.evidence ?? [`ev_${id}`]) t.evidence.push({ findingId, evidenceId: ev, role: 'primary' });
    for (let i = 0; i < (o.locations ?? 0); i++) t.locations.push({ id: `loc_${id}_${i}`, findingId });
    return findingId;
  };
  return { t, db, add };
}

const trail = { record: jest.fn().mockResolvedValue(undefined) };
beforeEach(() => trail.record.mockClear());

describe('M5 dedup — persistence and the human review queue', () => {
  it('level-2 MATCH merges the new occurrence into the existing identity, keeping its evidence', async () => {
    const { t, db, add } = store();
    add('old', { audit: 'aud_0', status: 'open' });
    const fid = add('new', { audit: 'aud_1' });
    const out = await runDedup(db, { projectId: 'prj', auditId: 'aud_1', findingId: fid });
    expect(out).toMatchObject({ outcome: 'MATCH', level: 2, identityId: 'old', findingId: fid });
    expect(t.findings.find(f => f.id === fid)!.identityId).toBe('old');
    expect(t.identities.find(i => i.id === 'new')).toMatchObject({ mergedIntoIdentityId: 'old', occurrences: 0 });
    expect(t.identities.find(i => i.id === 'old')!.occurrences).toBe(2);
    expect(t.evidence.filter(e => e.findingId === fid).map(e => e.evidenceId)).toEqual(['ev_new']);
    expect(t.relations).toEqual([expect.objectContaining({ kind: 'match', status: 'auto', level: 2, fromFindingId: fid, toFindingId: 'f_old_aud_0' })]);
  });

  it('a later occurrence of a merged-away fingerprint follows the merge', async () => {
    const { t, db, add } = store();
    add('old', { audit: 'aud_0', status: 'open' });
    add('new', { audit: 'aud_1' });
    t.identities.find(i => i.id === 'new')!.mergedIntoIdentityId = 'old';
    const fid = 'f_new_again';
    t.findings.push({ ...t.findings.find(f => f.id === 'f_new_aud_1'), id: fid, auditId: 'aud_2' });
    t.findings = t.findings.filter(f => f.id !== 'f_new_aud_1');
    const out = await runDedup(db, { projectId: 'prj', auditId: 'aud_2', findingId: fid });
    expect(out).toMatchObject({ outcome: 'MATCH', mergedInto: 'old' });
    expect(t.findings.find(f => f.id === fid)!.identityId).toBe('old');
  });

  it('POSSIBLE_MATCH creates a pending proposal, keeps both identities, and never auto-resolves', async () => {
    const { t, db, add } = store();
    add('old', { audit: 'aud_0', status: 'open' });
    const fid = add('new', { audit: 'aud_1', cwe: null });
    expect(await runDedup(db, { projectId: 'prj', auditId: 'aud_1', findingId: fid })).toMatchObject({ outcome: 'POSSIBLE_MATCH', level: 2 });
    expect(t.relations).toEqual([expect.objectContaining({ kind: 'possible_match', status: 'pending', confidenceBand: 'medium' })]);
    expect(t.findings.find(f => f.id === fid)!.identityId).toBe('new');
    // Running dedup again (a retry) does not duplicate or resolve the proposal.
    await runDedup(db, { projectId: 'prj', auditId: 'aud_1', findingId: fid });
    expect(t.relations).toHaveLength(1);
    expect(t.relations[0].status).toBe('pending');

    const service = new DedupService(db, trail as never);
    const queue = await service.queue('prj') as Row[];
    expect(queue).toEqual([expect.objectContaining({ id: t.relations[0].id, finding: expect.objectContaining({ id: fid }), candidate: expect.objectContaining({ id: 'f_old_aud_0' }) })]);
  });

  it('a rejected proposal is recorded, attributed, and never proposed again for the same identities', async () => {
    const { t, db, add } = store();
    add('old', { audit: 'aud_0', status: 'open' });
    const fid = add('new', { audit: 'aud_1', cwe: null });
    await runDedup(db, { projectId: 'prj', auditId: 'aud_1', findingId: fid });
    const service = new DedupService(db, trail as never);
    await service.decide('prj', t.relations[0].id, { decision: 'reject', rationale: 'different invoices endpoint semantics' }, ACTOR);
    expect(t.relations[0]).toMatchObject({ status: 'rejected', decidedBy: 'usr_reviewer', rationale: 'different invoices endpoint semantics' });
    expect(trail.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'finding.dedup.reject', actorId: 'usr_reviewer' }));
    // A second occurrence of the new identity in a later audit is not re-proposed.
    t.identities.find(i => i.id === 'new')!.occurrences = 1;
    t.identities.find(i => i.id === 'new')!.firstSeenAuditId = 'aud_2';
    t.findings.find(f => f.id === fid)!.auditId = 'aud_2';
    expect(await runDedup(db, { projectId: 'prj', auditId: 'aud_2', findingId: fid })).toMatchObject({ outcome: 'NEW_FINDING' });
    await expect(service.decide('prj', t.relations[0].id, { decision: 'confirm', rationale: 'changed my mind' }, ACTOR)).rejects.toMatchObject({ code: 'CONFLICT' });
  });

  it('confirming merges identities without evidence loss, even within one audit', async () => {
    const { t, db, add } = store();
    add('old', { audit: 'aud_1', status: 'open', evidence: ['ev_shared', 'ev_old'] });
    const fid = add('new', { audit: 'aud_1', cwe: null, evidence: ['ev_shared', 'ev_new'] });
    await runDedup(db, { projectId: 'prj', auditId: 'aud_1', findingId: fid });
    // A source location attached after triage must survive the merge too.
    t.locations.push({ id: 'loc_new', findingId: fid });
    const service = new DedupService(db, trail as never);
    await service.decide('prj', t.relations[0].id, { decision: 'confirm', rationale: 'same IDOR via the same handler' }, ACTOR);
    expect(t.findings.map(f => f.id)).toEqual(['f_old_aud_1']);
    expect(t.evidence.filter(e => e.findingId === 'f_old_aud_1').map(e => e.evidenceId).sort()).toEqual(['ev_new', 'ev_old', 'ev_shared']);
    expect(t.locations[0].findingId).toBe('f_old_aud_1');
    expect(t.identities.find(i => i.id === 'new')).toMatchObject({ mergedIntoIdentityId: 'old', occurrences: 0 });
    expect(t.relations[0]).toMatchObject({ status: 'confirmed' });
  });

  it('refuses decisions without a rationale, from another project, or on unknown proposals', async () => {
    const { t, db, add } = store();
    add('old', { audit: 'aud_0', status: 'open' });
    await runDedup(db, { projectId: 'prj', auditId: 'aud_1', findingId: add('new', { audit: 'aud_1', cwe: null }) });
    const service = new DedupService(db, trail as never);
    await expect(service.decide('prj', t.relations[0].id, { decision: 'confirm', rationale: ' ' }, ACTOR)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service.decide('prj_other', t.relations[0].id, { decision: 'confirm', rationale: 'looks same' }, ACTOR)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(service.decide('prj', 'frel_missing', { decision: 'confirm', rationale: 'looks same' }, ACTOR)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(t.relations[0].status).toBe('pending');
  });

  it('an AI advisor can only propose, and broken advisor output leaves the finding new', async () => {
    const { t, db, add } = store();
    add('old', { audit: 'aud_0', status: 'open', target: 'GET https://t.test/api/orders/1' });
    const fid = add('new', { audit: 'aud_1' });
    const advisor = { similar: jest.fn().mockResolvedValue({ similar: [{ identityId: 'old', band: 'high' }] }) };
    expect(await runDedup(db, { projectId: 'prj', auditId: 'aud_1', findingId: fid }, advisor)).toMatchObject({ outcome: 'POSSIBLE_MATCH', level: 3 });
    expect(t.findings.find(f => f.id === fid)!.identityId).toBe('new');

    const second = store();
    second.add('old', { audit: 'aud_0', status: 'open', target: 'GET https://t.test/api/orders/1' });
    const fid2 = second.add('new', { audit: 'aud_1' });
    for (const bad of [{ similar: [{ identityId: 'old', band: 'high', score: 1 }] }, 'MATCH old']) {
      expect(await runDedup(second.db, { projectId: 'prj', auditId: 'aud_1', findingId: fid2 }, { similar: async () => bad })).toMatchObject({ outcome: 'NEW_FINDING' });
    }
    expect(await runDedup(second.db, { projectId: 'prj', auditId: 'aud_1', findingId: fid2 }, { similar: async () => { throw new Error('model down'); } })).toMatchObject({ outcome: 'NEW_FINDING' });
    expect(second.t.relations).toEqual([]);
  });
});

describe('M5 finding lifecycle — decisions (09-findings §6)', () => {
  it('enforces the transition table, roles and a reason', () => {
    expect(checkDecision('open', 'false_positive', 'approver', 'scanner misread the ORM call')).toEqual({ allowed: true, to: 'false_positive' });
    expect(checkDecision('open', 'false_positive', 'operator', 'reason')).toEqual({ allowed: false, reason: 'forbidden_role' });
    expect(checkDecision('open', 'false_positive', 'viewer', 'reason')).toEqual({ allowed: false, reason: 'forbidden_role' });
    expect(checkDecision('open', 'false_positive', undefined, 'reason')).toEqual({ allowed: false, reason: 'forbidden_role' });
    expect(checkDecision('fixed', 'false_positive', 'admin', 'reason')).toEqual({ allowed: false, reason: 'illegal_transition' });
    expect(checkDecision('open', 'accepted_risk', 'admin', '  ')).toEqual({ allowed: false, reason: 'reason_required' });
    expect(checkDecision('false_positive', 'reopen', 'approver', 'reason')).toEqual({ allowed: false, reason: 'forbidden_role' });
    expect(checkDecision('false_positive', 'reopen', 'admin', 'reason')).toEqual({ allowed: true, to: 'open' });
    expect(checkDecision('not_reproduced', 'confirm_fixed', 'operator', 'regression check passed')).toEqual({ allowed: true, to: 'fixed' });
    expect(checkDecision('open', 'bogus' as never, 'admin', 'reason')).toEqual({ allowed: false, reason: 'illegal_transition' });
    // No decision leads anywhere from verified, and nothing but confirm_fixed reaches fixed.
    expect(Object.values(DECISIONS).filter(rule => rule.to === 'fixed')).toHaveLength(1);
  });

  it('false_positive feeds the suppression store once, and reopening removes it', async () => {
    const { t, db, add } = store();
    add('id1', { status: 'open' });
    const service = new LifecycleService(db, trail as never);
    await service.decide('prj', 'id1', { decision: 'false_positive', reason: 'scanner misread the ORM call' }, ACTOR, 'approver');
    expect(t.identities[0]).toMatchObject({ status: 'false_positive', statusDecidedBy: 'usr_reviewer', statusReason: 'scanner misread the ORM call' });
    expect(t.suppressions).toEqual([expect.objectContaining({ projectId: 'prj', fingerprint: 'fp-id1', markedBy: 'usr_reviewer' })]);
    expect(trail.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'finding.status.transition', diff: { status: { from: 'open', to: 'false_positive' } } }));

    await service.decide('prj', 'id1', { decision: 'reopen', reason: 'it was real after all' }, ACTOR, 'admin');
    expect(t.identities[0].status).toBe('open');
    expect(t.suppressions).toEqual([]);
    await service.decide('prj', 'id1', { decision: 'false_positive', reason: 'confirmed noise again' }, ACTOR, 'admin');
    await service.decide('prj', 'id1', { decision: 'reopen', reason: 'reopen once more' }, ACTOR, 'admin');
    await service.decide('prj', 'id1', { decision: 'false_positive', reason: 'and back' }, ACTOR, 'admin');
    expect(t.suppressions).toHaveLength(1);
  });

  it('accepted_risk records the approver and rationale and creates no suppression', async () => {
    const { t, db, add } = store();
    add('id1', { status: 'regressed' });
    await new LifecycleService(db, trail as never).decide('prj', 'id1', { decision: 'accepted_risk', reason: 'internal-only admin tool, owner: platform' }, ACTOR, 'approver');
    expect(t.identities[0]).toMatchObject({ status: 'accepted_risk', statusDecidedBy: 'usr_reviewer', statusReason: 'internal-only admin tool, owner: platform' });
    expect(t.suppressions).toEqual([]);
  });

  it('refuses illegal, unauthorised, foreign and merged-identity decisions without changing anything', async () => {
    const { t, db, add } = store();
    add('id1', { status: 'verified' });
    add('id2', { status: 'open' });
    t.identities[1].mergedIntoIdentityId = 'id1';
    const service = new LifecycleService(db, trail as never);
    await expect(service.decide('prj', 'id1', { decision: 'false_positive', reason: 'reason' }, ACTOR, 'admin')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.decide('prj', 'id2', { decision: 'false_positive', reason: 'reason' }, ACTOR, 'admin')).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(service.decide('prj_other', 'id1', { decision: 'confirm_fixed', reason: 'reason' }, ACTOR, 'admin')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    add('id3', { status: 'open' });
    await expect(service.decide('prj', 'id3', { decision: 'false_positive', reason: 'reason' }, ACTOR, 'operator')).rejects.toMatchObject({ code: 'FORBIDDEN' });
    expect(t.identities.map(i => i.status)).toEqual(['verified', 'open', 'open']);
    expect(trail.record).not.toHaveBeenCalled();
  });
});

describe('M5 finding lifecycle — observation when an audit settles', () => {
  const o = (status: any, seen: boolean, covered = true, completed = true) => observe({ identityId: 'i', status, seen, covered }, completed);

  it('reappearance reopens or regresses; it never resolves', () => {
    expect(o('fixed', true)).toBe('regressed');
    expect(o('verified', true)).toBe('regressed');
    expect(o('not_reproduced', true)).toBe('open');
    expect(o('open', true)).toBeUndefined();
    expect(o('regressed', true)).toBeUndefined();
    expect(promoteNew('new', 'aud_0', 'aud_1')).toBe('open');
    expect(promoteNew('new', 'aud_1', 'aud_1')).toBeUndefined();
  });

  it('absence is not a fix: it becomes not_reproduced, and only a confirmed fix ages into verified', () => {
    expect(o('open', false)).toBe('not_reproduced');
    expect(o('new', false)).toBe('not_reproduced');
    expect(o('regressed', false)).toBe('not_reproduced');
    expect(o('not_reproduced', false)).toBeUndefined();
    expect(o('fixed', false)).toBe('verified');
  });

  it('partial audits and audits that did not run the producing category say nothing', () => {
    expect(o('open', false, true, false)).toBeUndefined();
    expect(o('open', false, false, true)).toBeUndefined();
    expect(o('fixed', false, true, false)).toBeUndefined();
  });

  it('human decisions are never overturned by observation', () => {
    for (const status of ['false_positive', 'accepted_risk']) for (const seen of [true, false]) expect(o(status, seen)).toBeUndefined();
  });

  it('knows which jobs must have run, and that imports are never observed absent', () => {
    expect(producingCategories('tool', {})).toEqual(['sast']);
    expect(producingCategories('correlated', {})).toEqual(['blackbox', 'whitebox']);
    expect(producingCategories('whitebox', { upstreamFingerprint: 'x' })).toBeNull();
    expect(producingCategories('unknown', {})).toBeNull();
  });

  it('applies the changes for a settled audit and reports them', async () => {
    const { t, db, add } = store();
    add('seen_fixed', { audit: 'aud_0', status: 'fixed' });
    add('gone_open', { audit: 'aud_0', status: 'open' });
    add('gone_fp', { audit: 'aud_0', status: 'false_positive' });
    t.findings.push({ id: 'f_now', auditId: 'aud_9', identityId: 'seen_fixed', origin: 'blackbox', category: 'authorization', reproduction: {} });
    const changes = await applyAuditOutcome(db, { projectId: 'prj', auditId: 'aud_9', completed: true, succeededCategories: ['blackbox'] });
    expect(changes).toEqual([
      { identityId: 'seen_fixed', from: 'fixed', to: 'regressed' },
      { identityId: 'gone_open', from: 'open', to: 'not_reproduced' },
    ]);
    expect(t.identities.find(i => i.id === 'gone_fp')!.status).toBe('false_positive');
    expect(await applyAuditOutcome(db, { projectId: 'prj', auditId: 'aud_10', completed: true, succeededCategories: ['sast'] })).toEqual([]);
  });
});

describe('M5 finding lifecycle — gate eligibility (09-findings §8)', () => {
  const policy = parsePolicy({ version: 1, name: 't', mode: 'full', block_on: [{ severity: ['critical'] }],
    waivers: { max_duration_days: 30, require_separate_approver: true, warn_before_expiry_days: 7 } });
  const finding = (identityStatus: GateFindingInput['identityStatus']): GateFindingInput => ({ findingId: 'f1', fingerprint: 'fp1', identityStatus, severity: 'critical',
    origin: 'tool', category: 'static_security', evidence: [{ id: 'e1', class: 'scanner', integrityOk: true }] });
  const decide = (status: GateFindingInput['identityStatus']) => evaluateGate({ audit: { status: 'completed', degraded: false, executedCategories: [] },
    findings: [finding(status)], policy, waivers: [], suppressions: [], now: new Date('2026-11-26') });

  it('accepted_risk and false_positive never block but stay visible as warnings', () => {
    for (const status of ['accepted_risk', 'false_positive'] as const) {
      const d = decide(status);
      expect(d.outcome).toBe('pass');
      expect(d.warnings).toEqual([expect.objectContaining({ reason: `not gate-eligible: finding is ${status}` })]);
    }
  });

  it('not_reproduced keeps blocking', () => {
    expect(decide('not_reproduced').outcome).toBe('fail');
    expect(decide('open').outcome).toBe('fail');
  });
});
