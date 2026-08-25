import { INestApplication } from '@nestjs/common';
import { PATH_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { RouteMapping } from './types';

/**
 * LAYER 1 — deterministic route dump.
 *
 * Reads Nest's own decorator metadata off the live application's DI
 * container. This is ground truth, not a static parse: these are the
 * controllers Nest actually instantiated and is actually routing to.
 *
 * Why this beats parsing Express's `_router.stack`: the Express layer
 * knows the path but only carries an anonymous bound function, so the
 * handler identity — `InvoiceController.findOne` — is lost. Correlation
 * needs the symbol, so we read it where it still exists.
 */
export function dumpRoutes(app: INestApplication): RouteMapping[] {
  const container = (app as any).container;
  const modules: Map<unknown, any> = container.getModules();
  const routes: RouteMapping[] = [];

  for (const [, moduleRef] of modules) {
    for (const [, wrapper] of moduleRef.controllers as Map<unknown, any>) {
      const instance = wrapper.instance;
      if (!instance) continue;

      const ctor = instance.constructor;
      const controllerPath: string = Reflect.getMetadata(PATH_METADATA, ctor) ?? '';

      const proto = Object.getPrototypeOf(instance);
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name === 'constructor') continue;
        const handler = proto[name];
        if (typeof handler !== 'function') continue;

        const methodPath = Reflect.getMetadata(PATH_METADATA, handler);
        if (methodPath === undefined) continue;   // not a route handler

        const verbEnum = Reflect.getMetadata(METHOD_METADATA, handler);
        const method = RequestMethod[verbEnum] ?? 'GET';

        routes.push({
          method: method === 'ALL' ? 'GET' : method,
          pathTemplate: normalizePath(controllerPath, methodPath),
          framework: 'nestjs',
          handlerSymbol: `${ctor.name}.${name}`,
          controllerClass: ctor.name,
          handlerMethod: name,
          source: 'runtime_dump',
        });
      }
    }
  }

  return routes.sort((a, b) => a.pathTemplate.localeCompare(b.pathTemplate));
}

/**
 * Nest writes ':id'. The endpoint inventory keys on '{id}'. Both sides of
 * the join must normalize identically or nothing ever matches — see
 * docs/06-recon on path-template normalization.
 */
export function normalizePath(controllerPath: string, methodPath: string): string {
  const joined = `/${controllerPath}/${methodPath}`
    .replace(/\/+/g, '/')
    .replace(/\/$/, '');
  const withBraces = joined.replace(/:([A-Za-z0-9_]+)/g, '{$1}');
  return withBraces === '' ? '/' : withBraces;
}

/** Normalizes a concrete observed URL path to its template form. */
export function templatize(observedPath: string, routes: RouteMapping[]): string | null {
  for (const route of routes) {
    const pattern = new RegExp(
      '^' + route.pathTemplate.replace(/\{[A-Za-z0-9_]+\}/g, '[^/]+') + '$',
    );
    if (pattern.test(observedPath)) return route.pathTemplate;
  }
  return null;
}
