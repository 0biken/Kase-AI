import type { PrismaClient } from '@prisma/client';
import { newId } from './ids';

/**
 * Authentication-decision trail (17 §9: "authentication and authorization
 * decisions" are among the events that must be recorded).
 *
 * Mirrors the failure posture of AuditTrailService in apps/api: a failed
 * trail write must never fail the request that triggered it, or trail
 * storage becomes a denial-of-service on sign-in. Logged loudly instead — a
 * silently missing trail is worse than a noisy one.
 */
export async function recordAuthEvent(
  prisma: PrismaClient,
  input: {
    actorId?: string | null;
    action: string;
    outcome: 'allowed' | 'denied' | 'error';
    metadata?: Record<string, unknown>;
  },
): Promise<void> {
  try {
    await prisma.auditTrailEvent.create({
      data: {
        id: newId('auditTrailEvent'),
        projectId: null, // sign-in is not scoped to a project
        actorType: 'user',
        actorId: input.actorId ?? null,
        action: input.action,
        metadata: (input.metadata ?? undefined) as never,
        outcome: input.outcome,
      },
    });
  } catch (err) {
    console.error('[audit-trail] failed to record auth event', input.action, err);
  }
}
