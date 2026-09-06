import { ProblemException } from '../common/problem-details';
import {
  PLATFORM_EVIDENCE_POLICY,
  resolveProjectPolicy,
  RetentionPolicyService,
} from './retention-policy.service';

const ORG_POLICY = {
  replayableEvidenceDays: 80,
  nonReplayableEvidenceDays: 25,
  rawToolOutputDays: 20,
  agentTranscriptDays: 15,
};

describe('retention-policy inheritance and enforcement', () => {
  it('resolves every field independently as project, organization, then platform', () => {
    const result = resolveProjectPolicy(
      {
        replayableEvidenceDays: null,
        nonReplayableEvidenceDays: 14,
        rawToolOutputDays: null,
        agentTranscriptDays: null,
      },
      {
        replayableEvidenceDays: 80,
        nonReplayableEvidenceDays: 25,
        rawToolOutputDays: 20,
        // deliberately absent to exercise platform fallback
      },
    );

    expect(result.configured.nonReplayableEvidenceDays).toBe(14);
    expect(result.effective).toEqual({
      replayableEvidenceDays: { days: 80, source: 'organization' },
      nonReplayableEvidenceDays: { days: 14, source: 'project' },
      rawToolOutputDays: { days: 20, source: 'organization' },
      agentTranscriptDays: { days: 30, source: 'platform' },
    });
  });

  it('defaults to 90/30/30/30', () => {
    const result = resolveProjectPolicy(null, null);
    for (const [field, days] of Object.entries(PLATFORM_EVIDENCE_POLICY)) {
      expect(result.effective[field as keyof typeof result.effective]).toEqual({
        days,
        source: 'platform',
      });
    }
  });

  it('rejects fractions, strings, zero, and values above 365 even when called outside DTO validation', async () => {
    const { service } = fixture();
    const invalid = [0, 366, 1.5, '30'];
    for (const days of invalid) {
      await expect(
        service.putOrganizationPolicy(
          'org_1',
          { ...ORG_POLICY, replayableEvidenceDays: days as never },
          userActor,
        ),
      ).rejects.toBeInstanceOf(ProblemException);
    }
  });

  it('requires organization admin membership and never permits an API token', async () => {
    const { service, prisma } = fixture();
    await expect(
      service.putOrganizationPolicy('org_1', ORG_POLICY, { type: 'token', id: 'tok_1' }),
    ).rejects.toMatchObject({ code: 'FORBIDDEN' });

    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'member' });
    await expect(service.putOrganizationPolicy('org_1', ORG_POLICY, userActor)).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
  });

  it('upserts the organization policy, reschedules with monotonic SQL, and records a diff', async () => {
    const { service, prisma, trail, tx } = fixture();
    prisma.organizationMember.findUnique.mockResolvedValue({ role: 'admin' });
    prisma.evidenceRetentionPolicy.findUnique.mockResolvedValue(null);
    tx.evidenceRetentionPolicy.upsert.mockResolvedValue({ organizationId: 'org_1', ...ORG_POLICY });

    await expect(service.putOrganizationPolicy('org_1', ORG_POLICY, userActor)).resolves.toEqual(
      ORG_POLICY,
    );
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      expect.stringContaining('LEAST(e."expiresAt"'),
      'org_1',
    );
    expect(tx.$executeRawUnsafe.mock.calls[0][0]).toContain('ProjectEvidenceRetentionOverride');
    expect(trail.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'evidence_policy.organization_update', outcome: 'allowed' }),
    );
  });
});

const userActor = {
  type: 'user' as const,
  id: 'usr_1',
  organizationId: 'org_1',
};

function fixture() {
  const tx = {
    evidenceRetentionPolicy: { upsert: jest.fn() },
    projectEvidenceRetentionOverride: { upsert: jest.fn() },
    $executeRawUnsafe: jest.fn().mockResolvedValue(0),
  };
  const prisma = {
    organizationMember: { findUnique: jest.fn() },
    evidenceRetentionPolicy: { findUnique: jest.fn() },
    project: { findUnique: jest.fn() },
    $transaction: jest.fn((callback: (value: typeof tx) => unknown) => callback(tx)),
  };
  const trail = { record: jest.fn().mockResolvedValue(undefined) };
  return {
    service: new RetentionPolicyService(prisma as never, trail as never),
    prisma,
    trail,
    tx,
  };
}
