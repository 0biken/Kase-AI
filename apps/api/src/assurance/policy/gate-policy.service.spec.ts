import { GatePolicyService } from './gate-policy.service';
import { ProblemException } from '../../common/problem-details';
import type { Actor } from '../../projects/projects.service';

type Row = { id: string; projectId: string; version: number; name: string; rules: unknown };

/**
 * A minimal in-memory Prisma double covering exactly the calls the service
 * makes. Keeps the test free of a database while still exercising version
 * assignment, promotion, and the fail-closed validation path.
 */
function fakePrisma() {
  const projects = new Map<string, { id: string; defaultGatePolicyId: string | null }>();
  const gatePolicies: Row[] = [];
  projects.set('project', { id: 'project', defaultGatePolicyId: null });

  const client = {
    project: {
      findUnique: async ({ where, select }: { where: { id: string }; select?: Record<string, boolean> }) => {
        const p = projects.get(where.id);
        if (!p) return null;
        return select?.defaultGatePolicyId ? { defaultGatePolicyId: p.defaultGatePolicyId } : { id: p.id };
      },
      update: async ({ where, data }: { where: { id: string }; data: { defaultGatePolicyId: string } }) => {
        const p = projects.get(where.id)!;
        p.defaultGatePolicyId = data.defaultGatePolicyId;
        return p;
      },
    },
    gatePolicy: {
      findFirst: async ({ where, orderBy }: { where: { projectId: string; version?: number }; orderBy?: unknown }) => {
        let rows = gatePolicies.filter((r) => r.projectId === where.projectId);
        if (typeof where.version === 'number') return rows.find((r) => r.version === where.version) ?? null;
        if (orderBy) rows = [...rows].sort((a, b) => b.version - a.version);
        return rows[0] ?? null;
      },
      findUnique: async ({ where }: { where: { id: string } }) => gatePolicies.find((r) => r.id === where.id) ?? null,
      findMany: async ({ where }: { where: { projectId: string } }) =>
        gatePolicies.filter((r) => r.projectId === where.projectId).sort((a, b) => a.id.localeCompare(b.id)),
      create: async ({ data }: { data: Row }) => {
        gatePolicies.push(data);
        return data;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn(client),
  };
  return { client, projects, gatePolicies };
}

const ACTOR: Actor = { type: 'user', id: 'usr_1', organizationId: 'org_1' };
const trail = { record: jest.fn().mockResolvedValue(undefined) };

function validRules(over: Record<string, unknown> = {}) {
  return {
    name: 'default',
    mode: 'full',
    block_on: [{ severity: ['critical'] }],
    waivers: { max_duration_days: 30, require_separate_approver: true, warn_before_expiry_days: 7 },
    ...over,
  };
}

function makeService(fake = fakePrisma()) {
  return { service: new GatePolicyService(fake.client as never, trail as never), fake };
}

describe('GatePolicyService', () => {
  beforeEach(() => trail.record.mockClear());

  it('assigns version 1 on first create and promotes it to the active default', async () => {
    const { service, fake } = makeService();
    const row = (await service.create('project', validRules(), ACTOR)) as Row;
    expect(row.version).toBe(1);
    expect(fake.projects.get('project')!.defaultGatePolicyId).toBe(row.id);
    expect(trail.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'gate_policy.create', resourceId: row.id }));
  });

  it('increments the version on each create and promotes the newest', async () => {
    const { service, fake } = makeService();
    const v1 = (await service.create('project', validRules(), ACTOR)) as Row;
    const v2 = (await service.create('project', validRules({ mode: 'observe' }), ACTOR)) as Row;
    expect([v1.version, v2.version]).toEqual([1, 2]);
    expect(fake.projects.get('project')!.defaultGatePolicyId).toBe(v2.id);
  });

  it('ignores a client-supplied version so versions stay monotonic', async () => {
    const { service } = makeService();
    const row = (await service.create('project', validRules({ version: 99 }), ACTOR)) as Row;
    expect(row.version).toBe(1);
  });

  it('rejects an invalid policy with field errors and stores nothing (fail closed)', async () => {
    const { service, fake } = makeService();
    const bad = validRules();
    delete (bad as Record<string, unknown>).waivers;
    await expect(service.create('project', bad, ACTOR)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(service.create('project', bad, ACTOR)).rejects.toBeInstanceOf(ProblemException);
    expect(fake.gatePolicies).toHaveLength(0);
    expect(trail.record).not.toHaveBeenCalled();
  });

  it('rejects a create against a missing project', async () => {
    const { service } = makeService();
    await expect(service.create('project_missing', validRules(), ACTOR)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getActive returns the promoted row; 404 when the project is unknown', async () => {
    const { service } = makeService();
    const created = (await service.create('project', validRules(), ACTOR)) as Row;
    expect((await service.getActive('project')) as Row).toMatchObject({ id: created.id, version: 1 });
    await expect(service.getActive('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getVersion returns a specific version and 404s for an absent one', async () => {
    const { service } = makeService();
    await service.create('project', validRules(), ACTOR);
    expect((await service.getVersion('project', 1)) as Row).toMatchObject({ version: 1 });
    await expect(service.getVersion('project', 5)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  it('getActiveParsed returns the engine-ready parsed policy with its id and version', async () => {
    const { service } = makeService();
    await service.create('project', validRules({ mode: 'block_critical' }), ACTOR);
    const active = await service.getActiveParsed('project');
    expect(active.version).toBe(1);
    expect(active.policy.mode).toBe('block_critical');
    expect(active.policy.block_on[0].severity).toEqual(['critical']);
  });
});
