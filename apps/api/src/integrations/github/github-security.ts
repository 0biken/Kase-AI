import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Verifies `X-Hub-Signature-256` over the exact bytes GitHub sent. The body
 * is not parsed, or trusted, until this passes.
 */
export function verifyWebhookSignature(secret: string, rawBody: Buffer | undefined, header: string | undefined): boolean {
  if (!secret || !rawBody || typeof header !== 'string' || !header.startsWith('sha256=')) return false;
  const expected = Buffer.from(`sha256=${createHmac('sha256', secret).update(rawBody).digest('hex')}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

const b64url = (value: Buffer | string) => Buffer.from(value).toString('base64url');

/**
 * Install `state`: binds a GitHub installation redirect to the project and
 * Kase user that started it, for ten minutes. HMAC-signed so a crafted
 * callback cannot name a different project.
 */
export function signInstallState(key: string, payload: { projectId: string; actorId: string }, now = new Date()): string {
  const body = b64url(JSON.stringify({ ...payload, exp: now.getTime() + 10 * 60_000, nonce: randomBytes(12).toString('hex') }));
  return `${body}.${b64url(createHmac('sha256', key).update(body).digest())}`;
}

const stateSchema = z.object({ projectId: z.string(), actorId: z.string(), exp: z.number(), nonce: z.string() });

export function verifyInstallState(key: string, state: string | undefined, now = new Date()): { projectId: string; actorId: string } | null {
  if (!key || typeof state !== 'string') return null;
  const [body, mac, extra] = state.split('.');
  if (!body || !mac || extra !== undefined) return null;
  const expected = Buffer.from(b64url(createHmac('sha256', key).update(body).digest()));
  const given = Buffer.from(mac);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  let parsed: z.infer<typeof stateSchema>;
  try {
    parsed = stateSchema.parse(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')));
  } catch {
    return null;
  }
  if (parsed.exp < now.getTime()) return null;
  return { projectId: parsed.projectId, actorId: parsed.actorId };
}

/* ------------------------- webhook payload shapes ------------------------ */

const repo = z.object({
  id: z.number(),
  full_name: z.string(),
  name: z.string(),
  html_url: z.string().url(),
  owner: z.object({ login: z.string() }),
});

export const pullRequestEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }),
  repository: repo,
  pull_request: z.object({
    number: z.number().int().positive(),
    draft: z.boolean().optional().default(false),
    head: z.object({ sha: z.string().regex(/^[a-f0-9]{40}$/u), repo: z.object({ id: z.number(), full_name: z.string() }).nullable() }),
    base: z.object({ repo: z.object({ id: z.number() }) }),
  }),
});
export type PullRequestEvent = z.infer<typeof pullRequestEventSchema>;

export const checkRunEventSchema = z.object({
  action: z.string(),
  installation: z.object({ id: z.number() }),
  repository: repo,
  check_run: z.object({ id: z.number(), external_id: z.string().nullable().optional(), app: z.object({ id: z.number() }).optional() }),
});
export type CheckRunEvent = z.infer<typeof checkRunEventSchema>;

/** `https://github.com/Owner/Repo(.git)(/)` → `github.com/owner/repo`, for matching a registered repository. */
export function normalizeRepoUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/u, '').replace(/\.git$/u, '');
    return `${u.hostname.toLowerCase()}${path.toLowerCase()}`;
  } catch {
    return null;
  }
}
