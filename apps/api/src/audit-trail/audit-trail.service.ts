import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { newId } from '../common/ids';

export type ActorType = 'user' | 'token' | 'system';
export type Outcome = 'allowed' | 'denied' | 'error';

export interface AuditTrailInput {
  projectId?: string | null;
  actorType: ActorType;
  actorId?: string | null;
  action: string;
  resourceType?: string | null;
  resourceId?: string | null;
  diff?: unknown;
  metadata?: unknown;
  outcome: Outcome;
}

/** Field names whose values must never reach the trail (17 §9: "never values"). */
const REDACT_KEYS = [
  'password', 'secret', 'token', 'tokenhash', 'apikey', 'authorization',
  'credential', 'privatekey', 'clientsecret', 'accesskey', 'secretkey',
];

/**
 * Append-only audit trail (17-security §9).
 *
 * Records authn/authz decisions, project and policy changes **with diffs**,
 * and scope denials. Retained indefinitely; there is deliberately no update or
 * delete method on this service.
 */
@Injectable()
export class AuditTrailService {
  private readonly logger = new Logger(AuditTrailService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: AuditTrailInput): Promise<void> {
    try {
      await this.prisma.auditTrailEvent.create({
        data: {
          id: newId('auditTrailEvent'),
          projectId: input.projectId ?? null,
          actorType: input.actorType,
          actorId: input.actorId ?? null,
          action: input.action,
          resourceType: input.resourceType ?? null,
          resourceId: input.resourceId ?? null,
          diff: (redact(input.diff) ?? undefined) as never,
          metadata: (redact(input.metadata) ?? undefined) as never,
          outcome: input.outcome,
        },
      });
    } catch (err) {
      // A failed trail write must not fail the request that triggered it —
      // otherwise trail storage becomes a denial-of-service on the whole API.
      // It is logged loudly instead, because a silently missing trail is worse
      // than a noisy one.
      this.logger.error(
        `Failed to write audit trail event "${input.action}": ${String(err)}`,
      );
    }
  }
}

/**
 * Before/after diff over two objects, limited to keys that actually changed.
 *
 * §9 requires policy changes carry diffs; a full snapshot of both sides would
 * bury the change and duplicate data already in the row.
 */
export function diffOf(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): Record<string, { from: unknown; to: unknown }> | undefined {
  if (!before && !after) return undefined;
  const b = before ?? {};
  const a = after ?? {};
  const keys = new Set([...Object.keys(b), ...Object.keys(a)]);
  const out: Record<string, { from: unknown; to: unknown }> = {};

  for (const k of keys) {
    if (!deepEqual(b[k], a[k])) out[k] = { from: b[k] ?? null, to: a[k] ?? null };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function deepEqual(x: unknown, y: unknown): boolean {
  if (x === y) return true;
  if (x instanceof Date && y instanceof Date) return x.getTime() === y.getTime();
  if (Array.isArray(x) && Array.isArray(y)) {
    return x.length === y.length && x.every((v, i) => deepEqual(v, y[i]));
  }
  if (x && y && typeof x === 'object' && typeof y === 'object') {
    const xk = Object.keys(x as object);
    const yk = Object.keys(y as object);
    if (xk.length !== yk.length) return false;
    return xk.every((k) =>
      deepEqual((x as Record<string, unknown>)[k], (y as Record<string, unknown>)[k]),
    );
  }
  return false;
}

/** Recursively replaces sensitive values with a marker, preserving shape. */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;
  if (depth > 8) return '[truncated]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== 'object') return value;

  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT_KEYS.includes(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}
