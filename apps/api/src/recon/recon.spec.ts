import { normalizeEndpoint } from './endpoint-normalizer';
import { ReconScopeService } from './recon-scope.service';
import { mergeCandidates, metadataFingerprint } from './inventory.service';
import { parseKatanaJsonl } from '../adapters/recon/katana.adapter';
import { parseHttpxJsonl } from '../adapters/recon/httpx.adapter';

describe('M3 recon contracts', () => {
  const scope = new ReconScopeService();
  const policy = { allowedHosts: ['fixture'], deniedPaths: ['/admin', '/private/*'], targetBaseUrl: 'http://fixture:3000/' };

  it('normalizes ids, duplicate slashes, trailing slashes, fragments, and query names without values', () => {
    expect(normalizeEndpoint('http://fixture:3000//api/invoices/123/?q=secret&page=2#frag')).toEqual({
      method: 'GET', pathTemplate: '/api/invoices/{id}',
      parameters: [{ name: 'page', in: 'query', type: 'string' }, { name: 'q', in: 'query', type: 'string' }],
      rawExample: 'http://fixture:3000/api/invoices/123?page=&q=',
    });
    expect(normalizeEndpoint('https://app.example.com/releases/summer-sale').pathTemplate).toBe('/releases/summer-sale');
  });

  it('rejects foreign hosts, ports, denied paths, credentials, and unsafe schemes', () => {
    expect(scope.check('http://fixture:3000/api/invoices/123', policy).allowed).toBe(true);
    expect(scope.check('http://trap:3000/', policy).reason).toBe('host_not_allowed');
    expect(scope.check('http://fixture:4000/', policy).reason).toBe('port_not_allowed');
    expect(scope.check('http://fixture:3000/admin/users', policy).reason).toBe('path_denied');
    expect(scope.check('http://user:pass@fixture:3000/', policy).reason).toBe('credentials_forbidden');
    expect(scope.check('file:///etc/passwd', policy).reason).toBe('scheme_not_allowed');
  });

  it('compiles a target-origin Katana scope and explicit denied paths', () => {
    expect(scope.katanaScope(policy)).toEqual({
      crawlScope: '^http://fixture:3000(/|$)',
      crawlOutScope: ['http://fixture:3000/admin($|[/?#])', 'http://fixture:3000/private/.*($|[/?#])'],
    });
  });

  it('parses bounded JSONL and rejects malformed tool output', () => {
    expect(parseKatanaJsonl('{"request":{"method":"GET","endpoint":"http://fixture:3000/a"}}\n')).toHaveLength(1);
    expect(parseHttpxJsonl('{"url":"http://fixture:3000/a","status_code":200,"tech":["NestJS"]}\n')[0]).toMatchObject({ status: 200, technologies: ['NestJS'] });
    expect(() => parseKatanaJsonl('{bad')).toThrow(/Malformed Katana/u);
    expect(() => parseHttpxJsonl('{bad')).toThrow(/Malformed httpx/u);
  });

  it('merges duplicate endpoint variants while retaining source and observed metadata', () => {
    const merged = mergeCandidates([
      { url: 'http://fixture:3000/api/invoices/123?q=a', method: 'GET', source: 'httpx', status: 200, technologies: ['NestJS'], contentType: 'application/json' },
      { url: 'http://fixture:3000/api/invoices/456/?q=b&page=2', method: 'GET', source: 'httpx_redirect', status: 401, technologies: ['Node.js'] },
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ pathTemplate: '/api/invoices/{id}', statusObserved: [200, 401], requiresAuth: true, discoveredBy: ['httpx', 'httpx_redirect'], technologies: ['NestJS', 'Node.js'] });
  });

  it('compares status classes and stable technology sets for drift', () => {
    const baseline = { statusObserved: [200], contentType: 'application/json', requiresAuth: null, technologies: ['Node', 'Nest'] };
    expect(metadataFingerprint(baseline)).toBe(metadataFingerprint({ ...baseline, statusObserved: [201, 204], technologies: ['Nest', 'Node', 'Node'] }));
    for (const change of [{ statusObserved: [404] }, { contentType: 'text/html' }, { requiresAuth: true }, { technologies: ['Other'] }]) {
      expect(metadataFingerprint({ ...baseline, ...change })).not.toBe(metadataFingerprint(baseline));
    }
  });

  it('requires a completed predecessor that predates the current audit for inventory history', () => {
    const source = require('fs').readFileSync(require('path').join(__dirname, 'inventory.service.ts'), 'utf8');
    expect(source).toContain("status: { in: ['completed', 'partial'] }");
    expect(source).toContain('completedAt: { lte: audit.startedAt }');
    expect(source).toContain('SELECT id FROM "Target" WHERE id = $1 FOR UPDATE');
    expect(source).toContain('update: { status: \'building\', generatedAt: null }');
  });
});
