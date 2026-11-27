import type { INestApplication } from '@nestjs/common';

/**
 * A security-audit findings.json (traces, payloads, code changes) routinely
 * exceeds Express's default 100kb JSON limit. The limit is raised for that one
 * route only. Call before `app.init()`/`listen()`: Nest registers its own
 * parser at init, and it skips a body that is already parsed.
 */
export const ROUTE_BODY_LIMITS: ReadonlyArray<{ path: string; limit: string }> = [
  { path: '/api/v1/audits/:auditId/import/security-audit', limit: '10mb' },
  // GitHub sends webhook payloads up to 25 MB; pull_request events with large bodies exceed 100kb.
  { path: '/api/v1/integrations/github/webhook', limit: '25mb' },
];

type Middleware = (req: unknown, res: unknown, next: (error?: unknown) => void) => void;

export function applyRouteBodyLimits(app: INestApplication): void {
  for (const { path, limit } of ROUTE_BODY_LIMITS) app.use(path, expressJson({ limit }));
}

/**
 * Express's json parser, resolved through @nestjs/platform-express so it is the same Express Nest runs on.
 *
 * It must not be registered under its own function name (`jsonParser`): Nest decides whether to install
 * its global JSON parser by looking for a middleware of that name, so exposing it would silently disable
 * body parsing on every other route.
 */
function expressJson(options: { limit: string }): Middleware {
  const express = require(require.resolve('express', { paths: [require.resolve('@nestjs/platform-express')] })) as {
    json(o: { limit: string; verify?: (req: { rawBody?: Buffer }, res: unknown, buf: Buffer) => void }): Middleware;
  };
  // Keep the raw bytes, as Nest's own parser does with `rawBody: true`, so signature checks still work.
  const parse = express.json({ ...options, verify: (req, _res, buf) => { req.rawBody = buf; } });
  return function routeScopedJsonParser(req, res, next) { parse(req, res, next); };
}
