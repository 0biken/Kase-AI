/**
 * Whether the PROVIDER asserts it verified the email it just gave us.
 *
 * This is not a formality. ADR-013 makes an invite match on a verified
 * address the sole gate on account creation, so accepting an unverified
 * address would let anyone who can set an arbitrary email on a provider
 * account claim an invite meant for someone else.
 *
 * Each provider reports this differently, and two of them do not report it
 * as a boolean at all — so a generic `profile.email_verified` read would
 * silently treat Apple's string "false" as truthy.
 */
export function providerVerifiedEmail(provider: string, profile: unknown): boolean {
  const p = (profile ?? {}) as Record<string, unknown>;

  switch (provider) {
    case 'google':
      // Google sends a real boolean on the OIDC profile.
      return p.email_verified === true;

    case 'apple':
      // Apple sends "true"/"false" as STRINGS in the id_token claims, so a
      // truthiness check would accept "false".
      return p.email_verified === true || p.email_verified === 'true';

    case 'github':
      // GitHub's profile has no email_verified field. The Auth.js provider
      // resolves the address via /user/emails and only returns one marked
      // verified AND primary, so reaching here means it already passed that
      // check — there is nothing further to assert.
      return true;

    default:
      // Unknown provider: deny rather than assume. A provider added later
      // without updating this function should fail closed.
      return false;
  }
}
