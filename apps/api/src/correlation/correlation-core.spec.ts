import { Project } from 'ts-morph';
import { CorrelationEngine } from './correlation-engine.service';
import { buildNestGraph, nestStaticRoutes } from './nest-source-graph';
import { ingestOpenApi, resolveRoutes } from './route-resolution';
import { symbolKey, type CorrelationInput } from './correlation.types';

function fixture() {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  project.createSourceFile('/src/controller.ts', `
    import {Controller, Get} from '@nestjs/common';
    import {InvoiceService as Invoices} from './service';
    @Controller('api/invoices') export class InvoiceController {
      constructor(private invoices: Invoices) {}
      @Get(':id') findOne() { return this.invoices.find(); }
    }`);
  project.createSourceFile('/src/service.ts', `
    export class InvoiceService {
      find() { return this.query(); }
      query() { return this.find(); }
      unused() { return 'dead code'; }
    }`);
  project.createSourceFile('/src/other.ts', 'export class InvoiceService { find() { return 1; } }');
  const routes = nestStaticRoutes(project, '/src');
  const graph = buildNestGraph(project, '/src', routes[0])!;
  const commit = 'a'.repeat(40);
  const input: CorrelationInput = {
    auditId: 'audit', projectId: 'project', targetOrigin: 'https://target.test', checkoutCommit: commit,
    provenance: { commitSha: commit, verified: true }, routes, graphs: new Map([[symbolKey(routes[0].handler), graph]]),
    now: new Date('2026-01-01'),
    evidence: ['http', 'sast'].map(id => ({ id, auditId: 'audit', type: id === 'http' ? 'http_exchange' : 'sast_json', replayable: true, truncated: false, expiresAt: new Date('2027-01-01'), tombstonedAt: null })),
    blackbox: [{ id: 'bb', auditId: 'audit', category: 'authorization', ruleId: null, cwe: 'CWE-639', sourceLocations: [], evidenceIds: ['http'], observation: { method: 'GET', url: 'https://target.test/api/invoices/inv_1001', evidenceId: 'http' } }],
    whitebox: [{ id: 'wb', auditId: 'audit', category: 'authorization', ruleId: 'kase.idor', cwe: 'CWE-639', evidenceIds: ['sast'], sourceLocations: [{ file: 'service.ts', enclosingSymbol: 'InvoiceService.find', line: 3, commitSha: commit, verified: true }] }],
  };
  return { input, graph, project, engine: new CorrelationEngine() };
}

describe('M5 deterministic correlation core', () => {
  it('produces one source-attributed finding preserving both artifacts', () => {
    const { input, engine } = fixture();
    const result = engine.correlate(input);
    expect(result.correlated).toHaveLength(1);
    expect(result.uncorrelatedIds).toEqual([]);
    expect(result.correlated[0]).toMatchObject({ evidenceIds: ['http', 'sast'], method: 'static_parse', verified: true, confidenceBand: 'medium', gateEligible: false,
      sourceLocation: { file: 'service.ts', enclosingSymbol: 'InvoiceService.find', verified: true } });
  });
  it.each([null, { commitSha: null, verified: false }, { commitSha: 'b'.repeat(40), verified: true }])('keeps the finding advisory with missing or mismatched provenance: %j', provenance => {
    const { input, engine } = fixture(); input.provenance = provenance;
    expect(engine.correlate(input).correlated[0]).toMatchObject({ verified: false, gateEligible: false, sourceLocation: { verified: false } });
  });
  it.each(['method', 'origin', 'category', 'cwe', 'unreachable', 'file', 'commit', 'unverified_source', 'audit', 'expired', 'truncated', 'tombstone', 'graph_limit'])('rejects unsafe join: %s', change => {
    const { input, engine, graph } = fixture();
    const wb = input.whitebox[0];
    if (change === 'method') input.blackbox[0].observation!.method = 'POST';
    if (change === 'origin') input.blackbox[0].observation!.url = 'https://other.test/api/invoices/1';
    if (change === 'category') wb.category = 'code_quality';
    if (change === 'cwe') wb.cwe = 'CWE-79';
    if (change === 'unreachable') wb.sourceLocations[0].enclosingSymbol = 'InvoiceService.unused';
    if (change === 'file') wb.sourceLocations[0].file = 'other.ts';
    if (change === 'commit') wb.sourceLocations[0].commitSha = 'b'.repeat(40);
    if (change === 'unverified_source') wb.sourceLocations[0].verified = false;
    if (change === 'audit') input.evidence[1].auditId = 'another-audit';
    if (change === 'expired') input.evidence[0].expiresAt = new Date('2025-01-01');
    if (change === 'truncated') input.evidence[0].truncated = true;
    if (change === 'tombstone') input.evidence[0].tombstonedAt = new Date();
    if (change === 'graph_limit') graph.truncated = true;
    expect(engine.correlate(input)).toEqual({ correlated: [], uncorrelatedIds: ['bb', 'wb'] });
  });
  it('does not select arbitrarily between equally strong route bindings', () => {
    const { input, engine } = fixture();
    input.routes.push({ ...input.routes[0], id: 'ambiguous', handler: { ...input.routes[0].handler, file: 'other.ts' } });
    expect(engine.correlate(input).correlated).toEqual([]);
  });
  it('selects the deepest matching symbol and leaves shallower independent findings intact', () => {
    const { input, engine } = fixture();
    input.whitebox.push({ ...input.whitebox[0], id: 'deep', sourceLocations: [{ ...input.whitebox[0].sourceLocations[0], enclosingSymbol: 'InvoiceService.query' }] });
    const result = engine.correlate(input);
    expect(result.correlated[0].sourceLocation.enclosingSymbol).toBe('InvoiceService.query');
    expect(result.uncorrelatedIds).toEqual(['wb']);
  });
  it('preserves identity across line shifts, parameter names and repeated observations', () => {
    const { input, engine, graph } = fixture();
    const before = engine.correlate(input).correlated[0].fingerprint;
    graph.reachable.forEach(location => location.line += 100);
    input.routes[0].pathTemplate = '/api/invoices/{invoiceId}';
    input.blackbox.push({ ...input.blackbox[0], id: 'bb-repeat' });
    const result = engine.correlate(input);
    expect(result.correlated).toHaveLength(1);
    expect(result.correlated[0].fingerprint).toBe(before);
    expect(result.correlated[0].blackboxFindingIds).toEqual(['bb', 'bb-repeat']);
  });
});

describe('M5 route ranking and OpenAPI', () => {
  it('ranks runtime above OpenAPI above static and checks HTTP method', () => {
    const { input } = fixture();
    const staticRoute = input.routes[0];
    const [openapi] = ingestOpenApi({ openapi: '3.1.0', paths: { '/api/invoices/{id}': { get: { operationId: 'untrusted.name' } } } }, input.routes);
    expect(openapi.handler).toEqual(staticRoute.handler);
    expect(resolveRoutes('GET', '/api/invoices/1', [staticRoute, openapi])).toEqual([openapi]);
    const runtime = { ...staticRoute, id: 'runtime', source: 'runtime_dump' as const };
    expect(resolveRoutes('GET', '/api/invoices/1', [openapi, runtime])).toEqual([runtime]);
    expect(resolveRoutes('POST', '/api/invoices/1', [runtime])).toEqual([]);
  });
  it('prefers exact literal routes and preserves path case', () => {
    const { input } = fixture();
    const exact = { ...input.routes[0], id: 'exact', pathTemplate: '/api/invoices/current' };
    expect(resolveRoutes('GET', '/api/invoices/current', [...input.routes, exact])).toEqual([exact]);
    expect(resolveRoutes('GET', '/API/invoices/1', input.routes)).toEqual([]);
  });
  it('never invents handlers from operationId or external refs', () => {
    expect(ingestOpenApi({ openapi: '3.0.3', paths: { '/unmapped': { get: { operationId: 'InvoiceService.find' } }, '/external': { $ref: 'https://elsewhere.test/routes' } } }, [])).toEqual([]);
  });
});

describe('M5 bounded Nest source graph', () => {
  it('resolves aliased imports and same-class calls without crossing same-name classes', () => {
    const { graph } = fixture();
    expect(graph.reachable.map(source => [source.file, source.enclosingSymbol])).toEqual([
      ['controller.ts', 'InvoiceController.findOne'], ['service.ts', 'InvoiceService.find'], ['service.ts', 'InvoiceService.query'],
    ]);
    expect(graph.truncated).toBe(false);
  });
  it.each([{ maxDepth: 1, maxNodes: 256, maxCalls: 100 }, { maxDepth: 8, maxNodes: 1, maxCalls: 100 }, { maxDepth: 8, maxNodes: 256, maxCalls: 1 }])('marks bounded traversal incomplete: %j', limits => {
    const { project, input } = fixture();
    expect(buildNestGraph(project, '/src', input.routes[0], limits)?.truncated).toBe(true);
  });
  it('omits dynamic routes and nested functions that are never called', () => {
    const { project } = fixture();
    project.createSourceFile('/src/dynamic.ts', `import {Controller,Get} from '@nestjs/common';
      @Controller(prefix) class Dynamic { @Get('x') route() {} }
      @Controller('safe') class Safe { @Get() route() { const unused = () => this.dead(); return 1; } dead() {} }`);
    const routes = nestStaticRoutes(project, '/src');
    expect(routes.some(route => route.handler.enclosingSymbol.startsWith('Dynamic.'))).toBe(false);
    const safe = routes.find(route => route.handler.enclosingSymbol === 'Safe.route')!;
    expect(buildNestGraph(project, '/src', safe)?.reachable).toHaveLength(1);
  });
});
