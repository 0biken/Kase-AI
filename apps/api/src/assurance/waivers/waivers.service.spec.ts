import { WaiverService } from './waiver.service';
import { SuppressionService } from './suppression.service';
import { parsePolicy } from '../policy/policy-schema';
import type { Actor } from '../../projects/projects.service';

const NOW = new Date('2026-10-02T00:00:00.000Z');
const DAY = 86_400_000;
const ACTOR: Actor = { type: 'user', id: 'usr_1', organizationId: 'org_1' };

function policyWith(waivers: Record<string, unknown>) {
  return parsePolicy({
    version: 1,
    name: 'default',
    block_on: [{ severity: ['critical'] }],
    waivers: { max_duration_days: 30, require_separate_approver: true, warn_before_expiry_days: 7, ...waivers },
  });
}

function fakePrisma() {
  const waivers: Array<Record<string, unknown>> = [];
  const suppressions: Array<Record<string, unknown>> = [];
  const identityUpdates: unknown[] = [];
  const client = {
    project: { findUnique: jest.fn(async () => ({ id: 'project' })) },
    waiver: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        waivers.push(data);
        return data;
      }),
      findMany: jest.fn(async () => waivers),
    },
    suppression: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        suppressions.push(data);
        return data;
      }),
      findMany: jest.fn(async () => suppressions),
    },
    findingIdentity: { updateMany: jest.fn(async (args: unknown) => { identityUpdates.push(args); return { count: 1 }; }) },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  return { client, waivers, suppressions, identityUpdates };
}

const trail = { record: jest.fn().mockResolvedValue(undefined) };

function waiverDto(over: Record<string, unknown> = {}) {
  return { fingerprint: 'fp1', reason: 'known false alarm pending fix', approvedBy: 'usr_2', expiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString(), ...over };
}

describe('WaiverService', () => {
  beforeEach(() => trail.record.mockClear());

  function make(waiverRules: Record<string, unknown> = {}) {
    const fake = fakePrisma();
    const policies = { getActiveParsed: jest.fn(async () => ({ id: 'gpol_1', version: 1, policy: policyWith(waiverRules) })) };
    const service = new WaiverService(fake.client as never, policies as never, trail as never);
    return { service, fake, policies };
  }

  it('creates a waiver within the window and links the finding identity', async () => {
    const { service, fake } = make();
    const row = (await service.create('project', waiverDto(), ACTOR, NOW)) as { id: string; requestedBy: string };
    expect(row.requestedBy).toBe('usr_1');
    expect(fake.identityUpdates[0]).toMatchObject({ where: { projectId: 'project', fingerprint: 'fp1' }, data: { waiverId: row.id } });
    expect(trail.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'waiver.create' }));
  });

  it('rejects a past expiry', async () => {
    const { service } = make();
    await expect(service.create('project', waiverDto({ expiresAt: new Date(NOW.getTime() - DAY).toISOString() }), ACTOR, NOW))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects an expiry beyond the policy maximum', async () => {
    const { service } = make({ max_duration_days: 7 });
    await expect(service.create('project', waiverDto({ expiresAt: new Date(NOW.getTime() + 10 * DAY).toISOString() }), ACTOR, NOW))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('rejects a self-approved waiver when the policy requires a separate approver', async () => {
    const { service } = make({ require_separate_approver: true });
    await expect(service.create('project', waiverDto({ approvedBy: 'usr_1' }), ACTOR, NOW))
      .rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
  });

  it('allows a self-approved waiver when the policy does not require a separate approver', async () => {
    const { service } = make({ require_separate_approver: false });
    await expect(service.create('project', waiverDto({ approvedBy: 'usr_1' }), ACTOR, NOW)).resolves.toBeDefined();
  });

  it('404s for a missing project', async () => {
    const { service, fake } = make();
    fake.client.project.findUnique.mockResolvedValueOnce(null as never);
    await expect(service.create('nope', waiverDto(), ACTOR, NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('SuppressionService', () => {
  beforeEach(() => trail.record.mockClear());

  it('records a suppression attributed to the actor', async () => {
    const fake = fakePrisma();
    const service = new SuppressionService(fake.client as never, trail as never);
    const row = (await service.create('project', { fingerprint: 'fp9', reason: 'confirmed false positive' }, ACTOR)) as { markedBy: string; fingerprint: string };
    expect(row).toMatchObject({ markedBy: 'usr_1', fingerprint: 'fp9' });
    expect(trail.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'suppression.create' }));
  });
});
