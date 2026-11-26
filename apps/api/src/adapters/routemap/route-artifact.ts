import { z } from 'zod';
import type { MappingMethod, ResolvedRoute, SymbolLocation } from '../../correlation/correlation.types';
import { symbolKey } from '../../correlation/correlation.types';
import { ingestOpenApi, normalizeRoutePath } from '../../correlation/route-resolution';

/**
 * Commit-bound route artifacts (10-correlation, GATES-M5 G3).
 *
 * A route artifact is what a route-map adapter hands to correlation: either a
 * runtime dump of the live routing table (NestJS, FastAPI) or an OpenAPI
 * document. Every artifact names the commit it was produced from, and it is
 * only usable for an audit whose checkout is that exact commit. A route map
 * from any other commit is a description of different code, so it is rejected
 * outright rather than "mostly" trusted.
 *
 * Artifacts are produced by code running inside the audited application, so
 * everything in them is untrusted: paths are normalised, files must sit inside
 * the checkout, and every handler symbol must be located in the checked-out
 * source before it can carry a source location.
 */

export const ROUTE_ARTIFACT_SCHEMA = 'kase.routemap/v1';
export const MAX_ARTIFACT_ROUTES = 5000;
const METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE'] as const;
const COMMIT = /^[0-9a-f]{40}$/u;

const runtimeRoute = z.object({
  method: z.enum(METHODS),
  pathTemplate: z.string().min(1).max(2048),
  handler: z.object({
    /** `Class.method` for NestJS; `module.qualname` for FastAPI. */
    symbol: z.string().min(1).max(512),
    /** Path relative to the checkout root, when the runtime can report it. */
    file: z.string().min(1).max(1024).optional(),
    line: z.number().int().positive().optional(),
  }).strict(),
}).strict();

const runtimeArtifact = z.object({
  schema: z.literal(ROUTE_ARTIFACT_SCHEMA),
  source: z.literal('runtime_dump'),
  framework: z.enum(['nestjs', 'fastapi']),
  commitSha: z.string().regex(COMMIT),
  generatedAt: z.string().datetime(),
  routes: z.array(runtimeRoute).max(MAX_ARTIFACT_ROUTES),
}).strict();

const openApiArtifact = z.object({
  schema: z.literal(ROUTE_ARTIFACT_SCHEMA),
  source: z.literal('openapi'),
  framework: z.literal('openapi'),
  commitSha: z.string().regex(COMMIT),
  generatedAt: z.string().datetime(),
  document: z.unknown(),
}).strict();

export const routeArtifactSchema = z.discriminatedUnion('source', [runtimeArtifact, openApiArtifact]);
export type RouteArtifact = z.infer<typeof routeArtifactSchema>;
export type RuntimeRouteArtifact = z.infer<typeof runtimeArtifact>;

export type ArtifactErrorCode = 'invalid_artifact' | 'commit_mismatch' | 'invalid_openapi';
export class RouteArtifactError extends Error {
  constructor(readonly code: ArtifactErrorCode, message: string) { super(message); }
}

export type RouteRejectionReason =
  | 'unsupported_path' | 'file_outside_checkout' | 'file_not_in_checkout'
  | 'symbol_not_found' | 'symbol_ambiguous' | 'symbol_file_mismatch' | 'conflicting_handlers';
export interface RouteRejection { method: string; pathTemplate: string; symbol: string; reason: RouteRejectionReason }

export interface BindContext {
  /** The audit's checked-out commit; artifacts from any other commit are rejected. */
  checkoutCommit: string;
  /** Every source file in the checkout, relative to its root with `/` separators. */
  sourceFiles: ReadonlySet<string>;
  /** Locates a handler symbol in the checked-out source; returns every candidate. */
  locateSymbol(symbol: string, framework: 'nestjs' | 'fastapi'): SymbolLocation[];
}

export interface BoundRoutes { source: MappingMethod; framework: string; commitSha: string; routes: ResolvedRoute[]; rejected: RouteRejection[] }

export function parseRouteArtifact(raw: unknown): RouteArtifact {
  const parsed = routeArtifactSchema.safeParse(raw);
  if (!parsed.success) throw new RouteArtifactError('invalid_artifact', `Route artifact failed validation: ${parsed.error.issues[0]?.path.join('.') || 'root'} ${parsed.error.issues[0]?.message ?? ''}`.trim());
  return parsed.data;
}

function assertCommit(artifact: RouteArtifact, checkoutCommit: string): void {
  if (!COMMIT.test(checkoutCommit.toLowerCase())) throw new RouteArtifactError('commit_mismatch', 'Audit checkout commit is not a full SHA');
  if (artifact.commitSha !== checkoutCommit.toLowerCase()) {
    throw new RouteArtifactError('commit_mismatch', `Route artifact was produced from ${artifact.commitSha}, not the audited commit ${checkoutCommit.toLowerCase()}`);
  }
}

/** Accepts only plain relative paths inside the checkout. */
export function checkoutRelative(file: string): string | null {
  const normalized = file.replace(/\\/gu, '/').replace(/^\.\//u, '');
  if (!normalized || normalized.startsWith('/') || /^[A-Za-z]:/u.test(normalized)) return null;
  if (normalized.split('/').some(part => part === '..' || part === '' || part === '.')) return null;
  return normalized;
}

function bindRuntime(artifact: RuntimeRouteArtifact, ctx: BindContext): BoundRoutes {
  const rejected: RouteRejection[] = [];
  const bound: ResolvedRoute[] = [];
  for (const route of artifact.routes) {
    const base = { method: route.method, pathTemplate: route.pathTemplate, symbol: route.handler.symbol };
    let normalized: string;
    try { normalized = normalizeRoutePath(route.pathTemplate); } catch { rejected.push({ ...base, reason: 'unsupported_path' }); continue; }

    let hintedFile: string | undefined;
    if (route.handler.file !== undefined) {
      const relative = checkoutRelative(route.handler.file);
      if (!relative) { rejected.push({ ...base, reason: 'file_outside_checkout' }); continue; }
      if (!ctx.sourceFiles.has(relative)) { rejected.push({ ...base, reason: 'file_not_in_checkout' }); continue; }
      hintedFile = relative;
    }

    const candidates = ctx.locateSymbol(route.handler.symbol, artifact.framework);
    const matching = hintedFile ? candidates.filter(candidate => candidate.file === hintedFile) : candidates;
    if (!candidates.length) { rejected.push({ ...base, reason: 'symbol_not_found' }); continue; }
    if (!matching.length) { rejected.push({ ...base, reason: 'symbol_file_mismatch' }); continue; }
    if (matching.length > 1) { rejected.push({ ...base, reason: 'symbol_ambiguous' }); continue; }

    bound.push({
      id: JSON.stringify(['runtime_dump', route.method, normalized, symbolKey(matching[0])]),
      method: route.method, pathTemplate: route.pathTemplate, handler: matching[0], source: 'runtime_dump',
    });
  }

  // One method + path served by two different handlers is not a routing table
  // we can trust for attribution: drop every handler for that pair.
  const byEndpoint = new Map<string, ResolvedRoute[]>();
  for (const route of bound) {
    const key = `${route.method} ${normalizeRoutePath(route.pathTemplate)}`;
    byEndpoint.set(key, [...(byEndpoint.get(key) ?? []), route]);
  }
  const routes: ResolvedRoute[] = [];
  for (const group of byEndpoint.values()) {
    const handlers = new Set(group.map(route => symbolKey(route.handler)));
    if (handlers.size > 1) {
      for (const route of group) rejected.push({ method: route.method, pathTemplate: route.pathTemplate, symbol: route.handler.enclosingSymbol, reason: 'conflicting_handlers' });
      continue;
    }
    routes.push(group[0]);
  }
  routes.sort((a, b) => a.id.localeCompare(b.id));
  return { source: 'runtime_dump', framework: artifact.framework, commitSha: artifact.commitSha, routes, rejected };
}

/**
 * Validates an artifact, enforces its commit binding and binds every route to
 * a located source symbol. Envelope problems throw `RouteArtifactError`;
 * individual unusable routes are returned in `rejected`, never silently kept.
 * OpenAPI documents carry paths but no symbols, so they bind through the
 * static routes of the same checkout (`ingestOpenApi`).
 */
export function bindRouteArtifact(raw: unknown, ctx: BindContext, staticRoutes: ResolvedRoute[]): BoundRoutes {
  const artifact = parseRouteArtifact(raw);
  assertCommit(artifact, ctx.checkoutCommit);
  if (artifact.source === 'runtime_dump') return bindRuntime(artifact, ctx);
  let routes: ResolvedRoute[];
  try { routes = ingestOpenApi(artifact.document, staticRoutes); }
  catch (error) { throw new RouteArtifactError('invalid_openapi', (error as Error).message); }
  return { source: 'openapi', framework: 'openapi', commitSha: artifact.commitSha, routes, rejected: [] };
}

export interface AssembledRoutes {
  routes: ResolvedRoute[];
  sources: Array<{ source: MappingMethod; framework: string; routes: number; rejected: number }>;
  rejected: RouteRejection[];
  /** Artifact-level failures; each one is an audit degradation reason. */
  failures: Array<{ index: number; code: ArtifactErrorCode; message: string }>;
}

/**
 * Combines static routes with every supplied artifact. Ranking itself is
 * applied per request by `resolveRoutes` (runtime_dump > openapi >
 * static_parse), so a lower-ranked source never overrides a higher one; this
 * only decides which artifacts are admissible at all.
 */
export function assembleRoutes(artifacts: unknown[], staticRoutes: ResolvedRoute[], ctx: BindContext): AssembledRoutes {
  const result: AssembledRoutes = {
    routes: [...staticRoutes],
    sources: [{ source: 'static_parse', framework: 'source', routes: staticRoutes.length, rejected: 0 }],
    rejected: [], failures: [],
  };
  artifacts.forEach((raw, index) => {
    try {
      const bound = bindRouteArtifact(raw, ctx, staticRoutes);
      result.routes.push(...bound.routes);
      result.rejected.push(...bound.rejected);
      result.sources.push({ source: bound.source, framework: bound.framework, routes: bound.routes.length, rejected: bound.rejected.length });
    } catch (error) {
      if (!(error instanceof RouteArtifactError)) throw error;
      result.failures.push({ index, code: error.code, message: error.message });
    }
  });
  return result;
}
