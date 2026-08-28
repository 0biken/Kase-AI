import NextAuth from 'next-auth';
import { buildProviders } from './providers';
import { resolveSignIn, DENIAL_MESSAGES, type SignInDenialReason } from './invite';
import { providerVerifiedEmail } from './email-verification';
import { recordAuthEvent } from './audit';
import { prisma } from './prisma';

/**
 * Auth.js configuration (02-stack §5).
 *
 * Auth.js owns session, OAuth and CSRF here in Next, and — per §5 — never
 * runs inside Nest. The API's only contact with a session is verifying the
 * RS256 JWT this app mints (see session-token.ts).
 *
 * Session strategy is `jwt`, not `database`: Auth.js's own session table
 * would duplicate `User` for no benefit, since Kase already models users and
 * their org membership itself.
 */
export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: buildProviders(),
  session: { strategy: 'jwt' },
  pages: { signIn: '/signin', error: '/signin' },

  callbacks: {
    /**
     * The invite gate. Returning false here aborts sign-in and creates
     * nothing — which is the property ADR-013 turns on: a successful OAuth
     * handshake proves identity, never authorization.
     */
    async signIn({ user, account, profile }) {
      const providerId = account?.provider ?? 'unknown';
      const email = user.email ?? null;

      const decision = await resolveSignIn(prisma, {
        email,
        emailVerified: providerVerifiedEmail(providerId, profile),
        name: user.name,
        provider: providerId,
      });

      if (!decision.allowed) {
        await recordAuthEvent(prisma, {
          action: 'auth.signin.denied',
          outcome: 'denied',
          // The address is the whole point of the record — an admin needs to
          // see who was turned away to know whether to invite them.
          metadata: { provider: providerId, email, reason: decision.reason },
        });
        // Surfaced on /signin via the `error` query param.
        return `/signin?error=${encodeURIComponent(decision.reason)}`;
      }

      await recordAuthEvent(prisma, {
        actorId: decision.userId,
        action: 'auth.signin.allowed',
        outcome: 'allowed',
        metadata: { provider: providerId },
      });

      // Carried to the jwt callback, which cannot re-query cheaply.
      (user as { kaseUserId?: string; kaseOrgId?: string }).kaseUserId = decision.userId;
      (user as { kaseUserId?: string; kaseOrgId?: string }).kaseOrgId = decision.organizationId;
      return true;
    },

    /**
     * Persists the Kase user/org ids onto the Auth.js token. Note these are
     * OUR ids, not the provider's — the provider's subject is meaningless to
     * the API.
     */
    jwt({ token, user }) {
      const u = user as { kaseUserId?: string; kaseOrgId?: string } | undefined;
      if (u?.kaseUserId) {
        token.kaseUserId = u.kaseUserId;
        token.kaseOrgId = u.kaseOrgId;
      }
      return token;
    },

    session({ session, token }) {
      (session as { kaseUserId?: string; kaseOrgId?: string }).kaseUserId = token.kaseUserId as string;
      (session as { kaseUserId?: string; kaseOrgId?: string }).kaseOrgId = token.kaseOrgId as string;
      return session;
    },
  },
});

export { DENIAL_MESSAGES };
export type { SignInDenialReason };
