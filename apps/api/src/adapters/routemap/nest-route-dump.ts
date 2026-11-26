import { RequestMethod } from '@nestjs/common';
import { ROUTE_ARTIFACT_SCHEMA, type RuntimeRouteArtifact } from './route-artifact';

/**
 * `kase-routemap` for NestJS: dumps the live routing table of a booted Nest
 * application into a commit-bound route artifact.
 *
 * It reads Nest's own decorator metadata off the instantiated controllers in
 * the DI container, which is the ground truth for what is actually routed.
 * Express's router stack is not used: it carries the path but only an
 * anonymous bound function, and the handler symbol is the join key
 * (spike/correlation finding 1).
 *
 * The metadata keys are Nest's public string constants ('path', 'method'), so
 * this works against an application booted with its own copy of @nestjs/core.
 */
const PATH_METADATA = 'path';
const METHOD_METADATA = 'method';
const ALL_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
type Verb = RuntimeRouteArtifact['routes'][number]['method'];

const VERBS: Partial<Record<number, Verb>> = {
  [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT',
  [RequestMethod.DELETE]: 'DELETE', [RequestMethod.PATCH]: 'PATCH',
  [RequestMethod.OPTIONS]: 'OPTIONS', [RequestMethod.HEAD]: 'HEAD',
};

interface NestAppLike { container?: { getModules(): Map<unknown, { controllers: Map<unknown, { instance?: object | null }> }> } }

export interface NestDumpOptions {
  commitSha: string;
  /** The prefix the target's bootstrap passes to `app.setGlobalPrefix`, if any. */
  globalPrefix?: string;
  now?: Date;
}

function paths(value: unknown): string[] {
  if (value === undefined) return [];
  const list = Array.isArray(value) ? value : [value];
  return list.filter((item): item is string => typeof item === 'string');
}

/** Joins prefix, controller and method paths and converts `:id` to `{id}`. */
export function joinNestPath(...parts: string[]): string {
  const joined = '/' + parts.map(part => part.replace(/^\/+|\/+$/gu, '')).filter(Boolean).join('/');
  return joined.replace(/:([A-Za-z_][A-Za-z0-9_]*)/gu, '{$1}');
}

export function dumpNestRoutes(app: unknown, options: NestDumpOptions): RuntimeRouteArtifact {
  const container = (app as NestAppLike).container;
  if (!container || typeof container.getModules !== 'function') throw new Error('Not a booted Nest application');
  const seen = new Set<string>();
  const routes: RuntimeRouteArtifact['routes'] = [];

  for (const moduleRef of container.getModules().values()) {
    for (const wrapper of moduleRef.controllers.values()) {
      const instance = wrapper.instance;
      if (!instance) continue;
      const ctor = instance.constructor as { name: string };
      const controllerPaths = paths(Reflect.getMetadata(PATH_METADATA, ctor));
      if (!controllerPaths.length) controllerPaths.push('');
      const proto = Object.getPrototypeOf(instance) as Record<string, unknown>;

      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = proto[name];
        if (typeof handler !== 'function') continue;
        const methodPaths = paths(Reflect.getMetadata(PATH_METADATA, handler));
        if (!methodPaths.length) continue; // not a route handler
        const verbCode = Reflect.getMetadata(METHOD_METADATA, handler) as number | undefined;
        const verbs: readonly Verb[] = verbCode === RequestMethod.ALL ? ALL_METHODS : [VERBS[verbCode ?? RequestMethod.GET]].filter((v): v is Verb => !!v);

        for (const controllerPath of controllerPaths) for (const methodPath of methodPaths) for (const method of verbs) {
          const pathTemplate = joinNestPath(options.globalPrefix ?? '', controllerPath, methodPath);
          const symbol = `${ctor.name}.${name}`;
          const key = `${method} ${pathTemplate} ${symbol}`;
          if (seen.has(key)) continue;
          seen.add(key);
          routes.push({ method, pathTemplate, handler: { symbol } });
        }
      }
    }
  }

  routes.sort((a, b) => `${a.pathTemplate} ${a.method}`.localeCompare(`${b.pathTemplate} ${b.method}`));
  return {
    schema: ROUTE_ARTIFACT_SCHEMA, source: 'runtime_dump', framework: 'nestjs',
    commitSha: options.commitSha.toLowerCase(), generatedAt: (options.now ?? new Date()).toISOString(), routes,
  };
}
