import { blockedJobs, graphTemplate, InvalidJobGraphError, readyJobs, validateJobGraph } from './job-graph';

describe('orchestrator durable job graph', () => {
  it('builds the Semgrep-only graph in dependency order with snapshotted limits', () => {
    const graph = graphTemplate('security');
    expect(graph.map((job) => job.kind)).toEqual([
      'build_provenance', 'semgrep', 'normalize_severity',
    ]);
    expect(graph[1]).toMatchObject({ dependsOnKinds: ['build_provenance'], timeoutMs: 600_000, maxRetries: 2 });
    expect(graph[2]).toMatchObject({ dependsOnKinds: ['semgrep'], timeoutMs: 120_000 });
  });

  it('fans HTTP and Semgrep out in full mode', () => {
    expect(graphTemplate('full').map((job) => job.kind)).toEqual([
      'build_provenance', 'semgrep', 'katana_discover', 'scope_filter', 'httpx_verify',
      'inventory_merge', 'inventory_drift', 'normalize_severity',
    ]);
    expect(graphTemplate('full').at(-1)).toMatchObject({ kind: 'normalize_severity', dependsOnKinds: ['semgrep'] });
  });

  it('persists only explicitly selected full-mode adapters', () => {
    expect(graphTemplate('full', ['http']).map((job) => job.kind)).toEqual([
      'build_provenance', 'katana_discover', 'scope_filter', 'httpx_verify',
      'inventory_merge', 'inventory_drift',
    ]);
    expect(graphTemplate('full', ['http']).find((job) => job.kind === 'scope_filter')).toMatchObject({ maxRetries: 0, timeoutMs: 120_000 });
  });

  it('selects at most four ready jobs after dependencies terminally settle', () => {
    const root = { id: 'root', kind: 'build_provenance', dependsOn: [], status: 'succeeded' as const };
    const children = Array.from({ length: 6 }, (_, i) => ({
      id: `child-${i}`, kind: 'semgrep', dependsOn: ['root'], status: 'queued' as const,
    }));
    expect(readyJobs([root, ...children], 4).map((job) => job.id)).toEqual([
      'child-0', 'child-1', 'child-2', 'child-3',
    ]);
  });

  it('blocks adapters after failed provenance and cascades to normalization', () => {
    const provenance = { id: 'prov', kind: 'build_provenance', dependsOn: [], status: 'failed' as const };
    const semgrep = { id: 'sast', kind: 'semgrep', dependsOn: ['prov'], status: 'queued' as const };
    expect(blockedJobs([provenance, semgrep]).map((job) => job.id)).toEqual(['sast']);
    const skipped = { ...semgrep, status: 'skipped' as const };
    const normalize = { id: 'norm', kind: 'normalize_severity', dependsOn: ['sast'], status: 'queued' as const };
    expect(blockedJobs([provenance, skipped, normalize]).map((job) => job.id)).toEqual(['norm']);
    expect(readyJobs([provenance, skipped, normalize])).toEqual([]);
  });

  it('allows normalization when one of several settled adapters succeeded', () => {
    const sast = { id: 'sast', kind: 'semgrep', dependsOn: [], status: 'succeeded' as const };
    const http = { id: 'http', kind: 'http', dependsOn: [], status: 'failed' as const };
    const normalize = { id: 'norm', kind: 'normalize_severity', dependsOn: ['sast', 'http'], status: 'queued' as const };
    expect(readyJobs([sast, http, normalize]).map((job) => job.id)).toEqual(['norm']);
    expect(blockedJobs([sast, http, normalize])).toEqual([]);
  });

  it('rejects missing dependencies and cycles', () => {
    expect(() => validateJobGraph([
      { id: 'a', kind: 'x', dependsOn: ['missing'], status: 'queued' },
    ])).toThrow(InvalidJobGraphError);
    expect(() => validateJobGraph([
      { id: 'a', kind: 'x', dependsOn: ['b'], status: 'queued' },
      { id: 'b', kind: 'x', dependsOn: ['a'], status: 'queued' },
    ])).toThrow(/cycle/i);
  });
});
