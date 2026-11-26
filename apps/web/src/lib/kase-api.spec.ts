import { ApiError, createKaseApi } from './kase-api';
import { applyFindingFilters, bySeverity, type FindingRow } from './workspace-types';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function finding(over: Partial<FindingRow>): FindingRow {
  return {
    id: 'fnd_1', title: 't', severity: 'low', category: 'sast', origin: 'tool', confidenceBand: 'high',
    aiGenerated: false, gateEligible: false, sourceLocations: [], findingEvidence: [], ...over,
  };
}

describe('createKaseApi', () => {
  it('sends the bearer token and never caches workspace data', async () => {
    const fetcher = jest.fn(async () => json([]));
    await createKaseApi('http://api/v1/', 'tok', fetcher as unknown as typeof fetch).listAudits('prj_1');

    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://api/v1/projects/prj_1/audits');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok');
    expect(init.cache).toBe('no-store');
  });

  it('unwraps the paginated projects response and tolerates a bare array', async () => {
    const paged = createKaseApi('http://api', 't', (async () => json({ data: [{ id: 'prj_1' }], hasMore: false })) as typeof fetch);
    const bare = createKaseApi('http://api', 't', (async () => json([{ id: 'prj_2' }])) as typeof fetch);

    expect(await paged.listProjects()).toEqual([{ id: 'prj_1' }]);
    expect(await bare.listProjects()).toEqual([{ id: 'prj_2' }]);
  });

  it('passes only the filters that are set', async () => {
    const fetcher = jest.fn(async () => json([]));
    const api = createKaseApi('http://api', 't', fetcher as unknown as typeof fetch);

    await api.listFindings('aud_1', { severity: 'critical', category: '', gateEligible: 'true' });
    await api.listFindings('aud_1');

    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe('http://api/audits/aud_1/findings?severity=critical&gateEligible=true');
    expect((fetcher.mock.calls[1] as unknown as [string])[0]).toBe('http://api/audits/aud_1/findings');
  });

  it('treats a missing gate evaluation as "not evaluated", not an error', async () => {
    const api = createKaseApi('http://api', 't', (async () => json({ code: 'NOT_FOUND', detail: 'no gate evaluation' }, 404)) as typeof fetch);
    expect(await api.getGate('aud_1')).toBeNull();
  });

  it('still raises other gate failures', async () => {
    const api = createKaseApi('http://api', 't', (async () => json({ code: 'FORBIDDEN', detail: 'no access' }, 403)) as typeof fetch);
    await expect(api.getGate('aud_1')).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: 'no access' });
  });

  it('maps problem-details errors, falling back when the body is not JSON', async () => {
    const api = createKaseApi('http://api', 't', (async () => new Response('oops', { status: 500 })) as typeof fetch);
    await expect(api.getAudit('aud_1')).rejects.toMatchObject({ status: 500, code: 'HTTP_ERROR', message: 'HTTP 500' });
  });

  it('reports a network failure as UNREACHABLE', async () => {
    const api = createKaseApi('http://api', 't', (async () => { throw new TypeError('fetch failed'); }) as typeof fetch);
    const error = await api.listProjects().catch((e) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe('UNREACHABLE');
  });

  it('escapes ids placed in the path', async () => {
    const fetcher = jest.fn(async () => json({}));
    await createKaseApi('http://api', 't', fetcher as unknown as typeof fetch).getAudit('a/../b');
    expect((fetcher.mock.calls[0] as unknown as [string])[0]).toBe('http://api/audits/a%2F..%2Fb');
  });
});

describe('finding helpers', () => {
  it('sorts most severe first and keeps unknown severities last', () => {
    const sorted = [finding({ id: 'c', severity: 'weird' }), finding({ id: 'b', severity: 'low' }), finding({ id: 'a', severity: 'critical' })].sort(bySeverity);
    expect(sorted.map((f) => f.id)).toEqual(['a', 'b', 'c']);
  });

  it('filters like the API does', () => {
    const rows = [
      finding({ id: '1', severity: 'high', category: 'http', gateEligible: true }),
      finding({ id: '2', severity: 'high', category: 'sast', gateEligible: false }),
      finding({ id: '3', severity: 'low', category: 'http', gateEligible: false }),
    ];
    expect(applyFindingFilters(rows, { severity: 'high' }).map((f) => f.id)).toEqual(['1', '2']);
    expect(applyFindingFilters(rows, { category: 'http', gateEligible: 'false' }).map((f) => f.id)).toEqual(['3']);
    expect(applyFindingFilters(rows, {})).toHaveLength(3);
  });
});
