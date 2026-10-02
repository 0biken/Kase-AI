import { GateEvaluationService } from './gate-evaluation.service';
import { parsePolicy } from '../policy/policy-schema';
import type { Actor } from '../../projects/projects.service';

const ACTOR: Actor = { type: 'user', id: 'usr_1', organizationId: 'org_1' };

function fullPolicy() {
  return parsePolicy({
    version: 3,
    name: 'default',
    mode: 'full',
    block_on: [{ severity: ['critical'] }],
    waivers: { max_duration_days: 30, require_separate_approver: true, warn_before_expiry_days: 7 },
  });
}

function findingRow(over: Record<string, unknown> = {}) {
  return {
    id: 'fnd_1',
    auditId: 'aud_1',
    origin: 'tool',
    category: 'static_security',
    severity: 'critical',
    identity: { fingerprint: 'fp1', status: 'open' },
    sourceLocations: [{ file: 's.ts', enclosingSymbol: 'S.f', verified: true }],
    findingEvidence: [
      { role: 'primary', evidence: { id: 'ev1', type: 'http_exchange', replayable: true, tombstonedAt: null, objectDeletedAt: null } },
    ],
    ...over,
  };
}

function harness(opts: {
  audit?: Record<string, unknown> | null;
  findings?: unknown[];
  correlations?: unknown[];
  waivers?: unknown[];
  suppressions?: unknown[];
  getActiveParsed?: jest.Mock;
  replayResult?: 'reproduced' | 'not_reproduced' | 'error';
}) {
  const audit = opts.audit === undefined
    ? { id: 'aud_1', projectId: 'project', status: 'completed', degraded: false, executedCategories: [], buildProvenanceId: null, requestedCommitSha: 'abc123' }
    : opts.audit;

  const gateEvaluationCreate = jest.fn(async ({ data }: { data: unknown }) => data);
  const prisma = {
    audit: { findUnique: jest.fn(async () => audit) },
    project: { findUnique: jest.fn(async () => ({ defaultGatePolicyId: 'gpol_default' })) },
    buildProvenance: { findUnique: jest.fn(async () => ({ verified: false })) },
    finding: { findMany: jest.fn(async () => opts.findings ?? []) },
    correlation: { findMany: jest.fn(async () => opts.correlations ?? []) },
    waiver: { findMany: jest.fn(async () => opts.waivers ?? []) },
    suppression: { findMany: jest.fn(async () => opts.suppressions ?? []) },
    gateEvaluation: { create: gateEvaluationCreate },
  };
  const policies = { getActiveParsed: opts.getActiveParsed ?? jest.fn(async () => ({ id: 'gpol_3', version: 3, policy: fullPolicy() })) };
  const trail = { record: jest.fn().mockResolvedValue(undefined) };
  const replay = { verify: jest.fn().mockResolvedValue(opts.replayResult ?? 'reproduced') };

  const service = new GateEvaluationService(prisma as never, policies as never, trail as never, replay as never);
  return { service, prisma, policies, trail, replay, gateEvaluationCreate };
}

describe('GateEvaluationService', () => {
  const now = new Date('2026-10-01T00:00:00.000Z');

  it('blocks a verified-correlated critical finding whose replay reproduces, and persists it', async () => {
    const h = harness({
      findings: [findingRow()],
      correlations: [{ blackboxFindingId: 'fnd_1', whiteboxFindingId: null, method: 'runtime_dump', verified: true }],
      replayResult: 'reproduced',
    });
    const { decision } = await h.service.evaluate('aud_1', ACTOR, now);
    expect(decision.outcome).toBe('fail');
    expect(decision.blocking.map((b) => b.findingId)).toEqual(['fnd_1']);
    expect(h.replay.verify).toHaveBeenCalledWith({ auditId: 'aud_1', evidenceId: 'ev1' });
    expect(h.gateEvaluationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: 'fail', gatePolicyId: 'gpol_3', gatePolicyVersion: 3, blockingFindingIds: ['fnd_1'], commitSha: 'abc123' }),
    });
  });

  it('clears the block when the replay does not reproduce', async () => {
    const h = harness({ findings: [findingRow()], replayResult: 'not_reproduced' });
    const { decision } = await h.service.evaluate('aud_1', ACTOR, now);
    expect(decision.outcome).toBe('pass');
    expect(decision.blocking).toHaveLength(0);
  });

  it('fails closed and records version 0 when the active policy cannot be loaded', async () => {
    const h = harness({ getActiveParsed: jest.fn().mockRejectedValue(new Error('corrupt policy')) });
    const { decision } = await h.service.evaluate('aud_1', ACTOR, now);
    expect(decision.outcome).toBe('fail');
    expect(h.gateEvaluationCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: 'fail', gatePolicyVersion: 0, gatePolicyId: 'gpol_default' }),
    });
    expect(h.trail.record).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ policyLoaded: false }) }));
  });

  it('moves a blocked finding to waived under an active waiver', async () => {
    const h = harness({
      findings: [findingRow()],
      correlations: [{ blackboxFindingId: 'fnd_1', whiteboxFindingId: null, method: 'runtime_dump', verified: true }],
      waivers: [{ fingerprint: 'fp1', expiresAt: new Date(now.getTime() + 5 * 86_400_000), approvedBy: 'a', requestedBy: 'b' }],
    });
    const { decision } = await h.service.evaluate('aud_1', ACTOR, now);
    expect(decision.outcome).toBe('pass');
    expect(decision.waived.flatMap((w) => w.findingIds)).toEqual(['fnd_1']);
    expect(h.gateEvaluationCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ waivedFindingIds: ['fnd_1'] }) });
  });

  it('rejects evaluation of a missing audit', async () => {
    const h = harness({ audit: null });
    await expect(h.service.evaluate('aud_missing', ACTOR, now)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
