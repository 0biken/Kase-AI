import type { ResolvedRoute } from './correlation.types';
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE']);
const RANK = { runtime_dump: 0, openapi: 1, static_parse: 2 };

/** Supports plain segments and named parameters; regex routes are rejected. */
export function normalizeRoutePath(path: string): string {
  if (!path.startsWith('/') || path.includes('?') || path.includes('#') || path.includes('\\')) throw new Error('Unsupported route path');
  return '/' + path.split('/').filter(Boolean).map(segment => {
    if (/^:[A-Za-z_][\w]*$/u.test(segment) || /^\{[A-Za-z_][\w]*\}$/u.test(segment)) return '{param}';
    if (/[{}:*()[\]]/u.test(segment) || segment === '.' || segment === '..') throw new Error('Unsupported route segment');
    return segment;
  }).join('/');
}

export function resolveRoutes(method: string, pathname: string, routes: ResolvedRoute[]): ResolvedRoute[] {
  if (!METHODS.has(method.toUpperCase())) return [];
  const actual = pathname.split('/').filter(Boolean);
  const candidates = routes.filter(route => route.method.toUpperCase() === method.toUpperCase()).flatMap(route => {
    try {
      const expected = normalizeRoutePath(route.pathTemplate).split('/').filter(Boolean);
      if (expected.length !== actual.length || expected.some((part, i) => part !== '{param}' && part !== actual[i])) return [];
      return [{ route, specificity: expected.filter(part => part !== '{param}').length }];
    } catch { return []; }
  });
  if (!candidates.length) return [];
  const specificity = Math.max(...candidates.map(candidate => candidate.specificity));
  const best = candidates.filter(candidate => candidate.specificity === specificity);
  const rank = Math.min(...best.map(candidate => RANK[candidate.route.source]));
  return best.filter(candidate => RANK[candidate.route.source] === rank).map(candidate => candidate.route);
}

/** OpenAPI defines paths, not source symbols: require a unique static binding. */
export function ingestOpenApi(document: unknown, staticRoutes: ResolvedRoute[]): ResolvedRoute[] {
  if (!document || typeof document !== 'object' || Array.isArray(document)) throw new Error('Invalid OpenAPI document');
  const spec = document as Record<string, unknown>;
  if (typeof spec.openapi !== 'string' || !/^3\.[01]\./u.test(spec.openapi)) throw new Error('Only OpenAPI 3.0/3.1 is supported');
  if (!spec.paths || typeof spec.paths !== 'object' || Array.isArray(spec.paths)) throw new Error('OpenAPI paths unavailable');
  const paths = Object.entries(spec.paths);
  if (paths.length > 5000) throw new Error('OpenAPI path limit exceeded');
  const result: ResolvedRoute[] = [];
  for (const [path, item] of paths) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid OpenAPI path item');
    if ('$ref' in item) continue;
    let normalized: string;
    try { normalized = normalizeRoutePath(path); } catch { continue; }
    for (const [verb, operation] of Object.entries(item)) {
      if (!METHODS.has(verb.toUpperCase()) || !operation || typeof operation !== 'object' || Array.isArray(operation)) continue;
      const candidates = staticRoutes.filter(route => {
        try { return route.method === verb.toUpperCase() && normalizeRoutePath(route.pathTemplate) === normalized; }
        catch { return false; }
      });
      const unique = new Map(candidates.map(route => [JSON.stringify([route.handler.file, route.handler.enclosingSymbol]), route]));
      if (unique.size !== 1) continue;
      const route = [...unique.values()][0];
      result.push({ ...route, id: `openapi:${verb.toUpperCase()}:${normalized}`, pathTemplate: path, source: 'openapi' });
    }
  }
  return result;
}
