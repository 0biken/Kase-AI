import 'reflect-metadata';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { Controller, Get, All, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Project } from 'ts-morph';
import { nestStaticRoutes, nestSymbolLocator } from '../../correlation/nest-source-graph';
import { resolveRoutes } from '../../correlation/route-resolution';
import type { ResolvedRoute } from '../../correlation/correlation.types';
import { runNestDump } from '../../routemap-nest-main';
import { dumpNestRoutes, joinNestPath } from './nest-route-dump';
import { pythonModuleName, pythonSymbolLocator, scanPythonSymbols } from './python-symbols';
import { assembleRoutes, bindRouteArtifact, checkoutRelative, RouteArtifactError, ROUTE_ARTIFACT_SCHEMA, type BindContext } from './route-artifact';

const REPO = resolve(__dirname, '../../../../..');
const NEST_FIXTURE = join(REPO, 'fixtures/vulnerable-app');
const FASTAPI_ROOT = join(REPO, 'spike/correlation-fastapi');
const COMMIT = '0123456789abcdef0123456789abcdef01234567';
const OTHER = 'f'.repeat(40);
const NOW = new Date('2026-11-26T00:00:00.000Z');

function walk(root: string, accept: (file: string) => boolean): string[] {
  const out: string[] = [];
  const visit = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      if (entry === 'node_modules' || entry === '__pycache__' || entry.startsWith('.')) continue;
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) visit(full);
      else if (accept(full)) out.push(relative(root, full).replace(/\\/gu, '/'));
    }
  };
  visit(root);
  return out.sort();
}

/** The fixture's checked-out TypeScript, loaded as Kase loads a checkout. */
function nestCheckout() {
  const project = new Project({ useInMemoryFileSystem: true, skipAddingFilesFromTsConfig: true });
  const files = walk(NEST_FIXTURE, file => file.endsWith('.ts'));
  for (const file of files) project.createSourceFile(`/src/${file}`, readFileSync(join(NEST_FIXTURE, file), 'utf8'));
  const locate = nestSymbolLocator(project, '/src');
  const ctx: BindContext = { checkoutCommit: COMMIT, sourceFiles: new Set(files), locateSymbol: symbol => locate(symbol) };
  return { project, ctx, staticRoutes: nestStaticRoutes(project, '/src') };
}

function runtime(routes: unknown[], overrides: Record<string, unknown> = {}) {
  return { schema: ROUTE_ARTIFACT_SCHEMA, source: 'runtime_dump', framework: 'nestjs', commitSha: COMMIT, generatedAt: NOW.toISOString(), routes, ...overrides };
}

describe('kase-routemap: NestJS runtime dump', () => {
  it('dumps the real fixture routing table with its own @nestjs/core', async () => {
    const artifact = await runNestDump({ modulePath: join(NEST_FIXTURE, 'app.module.ts'), exportName: 'AppModule', commitSha: COMMIT.toUpperCase(), now: NOW });
    expect(artifact).toMatchObject({ schema: ROUTE_ARTIFACT_SCHEMA, source: 'runtime_dump', framework: 'nestjs', commitSha: COMMIT, generatedAt: NOW.toISOString() });
    expect(artifact.routes).toContainEqual({ method: 'GET', pathTemplate: '/api/invoices/{id}', handler: { symbol: 'InvoiceController.findOne' } });
    expect(artifact.routes).toContainEqual({ method: 'GET', pathTemplate: '/healthz', handler: { symbol: 'HealthController.health' } });
  }, 30000);

  it('expands path arrays, ALL routes and the global prefix, and ignores non-handlers', async () => {
    @Controller(['v1/items', 'items'])
    class ItemsController {
      @Get(':itemId') one() { return 1; }
      @All('sync') sync() { return 2; }
      @Post() create() { return 3; }
      helper() { return 4; }
    }
    @Module({ controllers: [ItemsController] }) class TestModule {}
    const app = await NestFactory.create(TestModule, { logger: false });
    await app.init();
    try {
      const { routes } = dumpNestRoutes(app, { commitSha: COMMIT, globalPrefix: '/api/', now: NOW });
      const keys = routes.map(route => `${route.method} ${route.pathTemplate} ${route.handler.symbol}`);
      expect(keys).toContain('GET /api/v1/items/{itemId} ItemsController.one');
      expect(keys).toContain('GET /api/items/{itemId} ItemsController.one');
      expect(keys).toContain('POST /api/items ItemsController.create');
      for (const verb of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']) expect(keys).toContain(`${verb} /api/items/sync ItemsController.sync`);
      expect(keys.some(key => key.includes('helper'))).toBe(false);
    } finally { await app.close(); }
  });

  it('rejects anything that is not a booted Nest application', () => {
    expect(() => dumpNestRoutes({}, { commitSha: COMMIT })).toThrow('Not a booted Nest application');
    expect(joinNestPath('', '/', ':id')).toBe('/{id}');
  });
});

describe('kase-routemap: commit-bound binding', () => {
  it('binds the fixture runtime dump to the handler source and outranks static parse', async () => {
    const { ctx, staticRoutes } = nestCheckout();
    const artifact = await runNestDump({ modulePath: join(NEST_FIXTURE, 'app.module.ts'), exportName: 'AppModule', commitSha: COMMIT, now: NOW });
    const bound = bindRouteArtifact(artifact, ctx, staticRoutes);
    expect(bound.rejected).toEqual([]);
    const [route] = resolveRoutes('GET', '/api/invoices/inv_1001', [...staticRoutes, ...bound.routes]);
    expect(route).toMatchObject({ source: 'runtime_dump', handler: { file: 'invoices/invoice.controller.ts', enclosingSymbol: 'InvoiceController.findOne' } });
  }, 30000);

  it('rejects an artifact produced from a different commit outright', () => {
    const { ctx, staticRoutes } = nestCheckout();
    const artifact = runtime([{ method: 'GET', pathTemplate: '/api/invoices/{id}', handler: { symbol: 'InvoiceController.findOne' } }], { commitSha: OTHER });
    expect(() => bindRouteArtifact(artifact, ctx, staticRoutes)).toThrow(expect.objectContaining({ code: 'commit_mismatch' }));
    expect(() => bindRouteArtifact(runtime([]), { ...ctx, checkoutCommit: 'main' }, staticRoutes)).toThrow(expect.objectContaining({ code: 'commit_mismatch' }));
  });

  it('rejects malformed envelopes and unknown fields', () => {
    const { ctx, staticRoutes } = nestCheckout();
    for (const bad of [null, [], runtime([], { schema: 'kase.routemap/v0' }), runtime([], { commitSha: 'abc' }), runtime([], { extra: true }),
      runtime([{ method: 'GET', pathTemplate: '/x', handler: { symbol: 'A.b', exec: 'rm -rf /' } }]),
      runtime([{ method: 'BREW', pathTemplate: '/x', handler: { symbol: 'A.b' } }])]) {
      expect(() => bindRouteArtifact(bad, ctx, staticRoutes)).toThrow(RouteArtifactError);
    }
  });

  it('rejects routes it cannot attribute instead of guessing', () => {
    const { ctx, staticRoutes } = nestCheckout();
    const ambiguous: BindContext = { ...ctx, locateSymbol: symbol => symbol === 'Dup.find'
      ? [{ file: 'a.ts', enclosingSymbol: 'Dup.find', line: 1 }, { file: 'b.ts', enclosingSymbol: 'Dup.find', line: 1 }] : ctx.locateSymbol(symbol, 'nestjs') };
    const bound = bindRouteArtifact(runtime([
      { method: 'GET', pathTemplate: '/a/(.*)', handler: { symbol: 'InvoiceController.findOne' } },
      { method: 'GET', pathTemplate: '/b', handler: { symbol: 'InvoiceController.findOne', file: '../../etc/passwd' } },
      { method: 'GET', pathTemplate: '/c', handler: { symbol: 'InvoiceController.findOne', file: 'missing.ts' } },
      { method: 'GET', pathTemplate: '/d', handler: { symbol: 'Nowhere.handler' } },
      { method: 'GET', pathTemplate: '/e', handler: { symbol: 'Dup.find' } },
      { method: 'GET', pathTemplate: '/f', handler: { symbol: 'InvoiceController.findOne', file: 'health.controller.ts' } },
    ]), ambiguous, staticRoutes);
    expect(bound.routes).toEqual([]);
    expect(bound.rejected.map(r => r.reason)).toEqual(['unsupported_path', 'file_outside_checkout', 'file_not_in_checkout', 'symbol_not_found', 'symbol_ambiguous', 'symbol_file_mismatch']);
  });

  it('drops every handler for an endpoint that two handlers claim', () => {
    const { ctx, staticRoutes } = nestCheckout();
    const bound = bindRouteArtifact(runtime([
      { method: 'GET', pathTemplate: '/api/invoices/{id}', handler: { symbol: 'InvoiceController.findOne' } },
      { method: 'GET', pathTemplate: '/api/invoices/{invoiceId}', handler: { symbol: 'HealthController.health' } },
    ]), ctx, staticRoutes);
    expect(bound.routes).toEqual([]);
    expect(bound.rejected.map(r => r.reason)).toEqual(['conflicting_handlers', 'conflicting_handlers']);
  });

  it('accepts only plain checkout-relative paths', () => {
    expect(checkoutRelative('./src/a.ts')).toBe('src/a.ts');
    expect(checkoutRelative('src\\a.ts')).toBe('src/a.ts');
    for (const bad of ['/etc/passwd', 'C:/x.ts', 'a/../b.ts', 'a//b.ts', '']) expect(checkoutRelative(bad)).toBeNull();
  });
});

describe('kase-routemap: FastAPI runtime dump', () => {
  const pythonFiles = () => new Map(walk(FASTAPI_ROOT, file => file.endsWith('.py')).map(file => [file, readFileSync(join(FASTAPI_ROOT, file), 'utf8')]));

  function dumpFastApi(commit = COMMIT) {
    const result = spawnSync('python', ['-I', join(REPO, 'workers/routemap/fastapi_dump.py'), '--root', FASTAPI_ROOT, '--app', 'fixture.app:app', '--commit', commit], { encoding: 'utf8', timeout: 60000 });
    if (result.status !== 0) throw new Error(`fastapi_dump failed (${result.status}): ${result.stderr || result.error?.message}`);
    return JSON.parse(result.stdout) as unknown;
  }

  it('dumps the live FastAPI routing table and binds it to the checked-out source', () => {
    const files = pythonFiles();
    const locate = pythonSymbolLocator(files);
    const ctx: BindContext = { checkoutCommit: COMMIT, sourceFiles: new Set(files.keys()), locateSymbol: symbol => locate(symbol) };
    const bound = bindRouteArtifact(dumpFastApi(), ctx, []);
    expect(bound).toMatchObject({ source: 'runtime_dump', framework: 'fastapi', commitSha: COMMIT, rejected: [] });
    const [route] = resolveRoutes('GET', '/api/invoices/inv_1001', bound.routes);
    expect(route.handler).toEqual({ file: 'fixture/app.py', enclosingSymbol: 'find_one', line: 27 });
  }, 60000);

  it('refuses a non-SHA commit before importing the target', () => {
    expect(() => dumpFastApi('main')).toThrow('--commit must be a full 40-character SHA');
  }, 60000);

  it('rebuilds Python qualnames, ignoring docstrings', () => {
    const symbols = scanPythonSymbols('pkg/mod.py', [
      'class Service:', '    """', '    def fake(self):', '    """', '    def find(self):', '        def inner():', '            pass',
      'async def handler():', '    pass',
    ].join('\n'));
    expect(symbols.map(s => `${s.module}.${s.qualname}@${s.line}`)).toEqual(['pkg.mod.Service.find@5', 'pkg.mod.Service.find.<locals>.inner@6', 'pkg.mod.handler@8']);
    expect(pythonModuleName('pkg/__init__.py')).toBe('pkg');
    expect(pythonModuleName('bad-name/x.py')).toBeNull();
  });
});

describe('kase-routemap: OpenAPI ingest and ranking', () => {
  const openapi = (document: unknown, commitSha = COMMIT) => ({ schema: ROUTE_ARTIFACT_SCHEMA, source: 'openapi', framework: 'openapi', commitSha, generatedAt: NOW.toISOString(), document });
  const spec = { openapi: '3.1.0', paths: { '/api/invoices/{invoiceId}': { get: { operationId: 'ignored' } } } };

  it('binds a commit-matched OpenAPI document through static routes of the same checkout', () => {
    const { ctx, staticRoutes } = nestCheckout();
    const bound = bindRouteArtifact(openapi(spec), ctx, staticRoutes);
    expect(bound.routes).toHaveLength(1);
    expect(bound.routes[0]).toMatchObject({ source: 'openapi', handler: { enclosingSymbol: 'InvoiceController.findOne' } });
  });

  it('records commit-mismatched and invalid documents as failures, keeping the other sources', () => {
    const { ctx, staticRoutes } = nestCheckout();
    const assembled = assembleRoutes([openapi(spec, OTHER), openapi({ swagger: '2.0' }), { nonsense: true }], staticRoutes, ctx);
    expect(assembled.failures.map(f => [f.index, f.code])).toEqual([[0, 'commit_mismatch'], [1, 'invalid_openapi'], [2, 'invalid_artifact']]);
    expect(assembled.routes).toEqual(staticRoutes);
  });

  it('lets a higher-ranked source win and never lets a lower one override it', async () => {
    const { ctx, staticRoutes } = nestCheckout();
    const dump = await runNestDump({ modulePath: join(NEST_FIXTURE, 'app.module.ts'), exportName: 'AppModule', commitSha: COMMIT, now: NOW });
    const assembled = assembleRoutes([openapi(spec), dump], staticRoutes, ctx);
    expect(assembled.failures).toEqual([]);
    expect(assembled.sources.map(s => s.source)).toEqual(['static_parse', 'openapi', 'runtime_dump']);
    expect(resolveRoutes('GET', '/api/invoices/1', assembled.routes).map(r => r.source)).toEqual(['runtime_dump']);

    // A static route that names a different handler for the same endpoint loses to the runtime dump.
    const decoy: ResolvedRoute = { ...staticRoutes[0], id: 'decoy', pathTemplate: '/api/invoices/{id}', method: 'GET', handler: { file: 'health.controller.ts', enclosingSymbol: 'HealthController.health', line: 1 } };
    const [winner] = resolveRoutes('GET', '/api/invoices/1', [decoy, ...assembled.routes]);
    expect(winner.handler.enclosingSymbol).toBe('InvoiceController.findOne');
    // Without the runtime dump, OpenAPI outranks static parse.
    expect(resolveRoutes('GET', '/api/invoices/1', [decoy, ...assembled.routes.filter(r => r.source !== 'runtime_dump')]).map(r => r.source)).toEqual(['openapi']);
  }, 30000);
});
