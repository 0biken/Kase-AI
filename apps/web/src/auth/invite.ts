import type { PrismaClient } from '@prisma/client';
import { newId } from './ids';

/**
 * Invite-only provisioning (ADR-013).
 *
 * The load-bearing property, and the one worth testing hardest: a successful
 * OAuth handshake MUST NOT by itself create a User. Google, GitHub and Apple
 * each tell us *who someone is*; none of them tells us they are allowed into
 * this organization. Only a pending invite does that.
 */

export interface OAuthIdentity {
  email: string | null | undefined;
  /** Whether the PROVIDER asserts it verified this address. */
  emailVerified: boolean;
  name?: string | null;
  provider: string;
}

export type SignInDecision =
  | { allowed: true; userId: string; organizationId: string }
  | { allowed: false; reason: SignInDenialReason };

export type SignInDenialReason =
  | 'no_email'
  | 'email_unverified'
  | 'no_invite'
  | 'invite_expired'
  | 'invite_already_accepted';

export const DENIAL_MESSAGES: Record<SignInDenialReason, string> = {
  no_email: 'Your provider did not release an email address to Kase.',
  email_unverified: 'Your provider has not verified this email address.',
  no_invite: 'No pending invite for this address. Ask an organization admin to invite you.',
  invite_expired: 'Your invite has expired. Ask an organization admin for a new one.',
  invite_already_accepted: 'This invite has already been used.',
};

/**
 * Resolves an OAuth identity to a Kase user, creating one only if a valid
 * invite exists. Returns a decision rather than throwing so the caller can
 * record the denial and show the reason.
 */
export async function resolveSignIn(
  prisma: PrismaClient,
  identity: OAuthIdentity,
  now: Date = new Date(),
): Promise<SignInDecision> {
  if (!identity.email) return { allowed: false, reason: 'no_email' };

  // An unverified address is an unauthenticated claim: anyone can put
  // someone else's address on an account at a provider that does not verify
  // it. Matching an invite against that would let an attacker claim an
  // invite intended for a colleague.
  if (!identity.emailVerified) return { allowed: false, reason: 'email_unverified' };

  const email = identity.email.toLowerCase();

  // Returning users: already provisioned, no invite needed.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { allowed: true, userId: existing.id, organizationId: existing.organizationId };
  }

  const invite = await prisma.invite.findFirst({ where: { email } });
  if (!invite) return { allowed: false, reason: 'no_invite' };
  if (invite.acceptedAt) return { allowed: false, reason: 'invite_already_accepted' };
  if (invite.expiresAt < now) return { allowed: false, reason: 'invite_expired' };

  const userId = newId('user');

  // One transaction: a User created without its ProjectMember rows, or an
  // invite marked accepted without its User, are both states nothing else
  // would repair.
  await prisma.$transaction(async (tx) => {
    await tx.user.create({
      data: {
        id: userId,
        email,
        // Apple returns the display name ONLY on first authorization and
        // never again, so if it is present here it must be persisted now.
        name: identity.name ?? null,
        organizationId: invite.organizationId,
      },
    });

    for (const projectId of invite.projectIds) {
      await tx.projectMember.create({ data: { userId, projectId, role: invite.role } });
    }

    await tx.invite.update({
      where: { id: invite.id },
      data: { acceptedAt: now, acceptedUserId: userId },
    });
  });

  return { allowed: true, userId, organizationId: invite.organizationId };
}
