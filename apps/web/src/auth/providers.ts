import Apple from 'next-auth/providers/apple';
import GitHub from 'next-auth/providers/github';
import Google from 'next-auth/providers/google';
import type { Provider } from 'next-auth/providers';

/**
 * OAuth providers, assembled from env under the locked KASE_ prefix.
 *
 * Each is INDIVIDUALLY SKIPPABLE. A deployment with no Apple credentials
 * boots with Google and GitHub rather than crashing — Apple has hard
 * external prerequisites (a paid developer account and a .p8 key) that the
 * other two do not, so coupling the whole app's startup to it would make a
 * billing problem look like an outage.
 */
export interface ProviderStatus {
  id: 'github' | 'google' | 'apple';
  configured: boolean;
  /** Why it is unavailable, for the sign-in page and for boot logging. */
  reason?: string;
}

function env(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v : undefined;
}

export function providerStatuses(): ProviderStatus[] {
  const gh = env('KASE_GITHUB_CLIENT_ID') && env('KASE_GITHUB_CLIENT_SECRET');
  const goog = env('KASE_GOOGLE_CLIENT_ID') && env('KASE_GOOGLE_CLIENT_SECRET');
  const apple = env('KASE_APPLE_CLIENT_ID') && env('KASE_APPLE_CLIENT_SECRET');

  return [
    { id: 'github', configured: Boolean(gh), reason: gh ? undefined : 'KASE_GITHUB_CLIENT_ID/SECRET not set' },
    { id: 'google', configured: Boolean(goog), reason: goog ? undefined : 'KASE_GOOGLE_CLIENT_ID/SECRET not set' },
    {
      id: 'apple',
      configured: Boolean(apple),
      reason: apple ? undefined : 'KASE_APPLE_CLIENT_ID/SECRET not set (needs a Services ID and a .p8-signed client secret)',
    },
  ];
}

export function buildProviders(): Provider[] {
  const providers: Provider[] = [];

  if (env('KASE_GITHUB_CLIENT_ID') && env('KASE_GITHUB_CLIENT_SECRET')) {
    providers.push(
      GitHub({
        clientId: env('KASE_GITHUB_CLIENT_ID')!,
        clientSecret: env('KASE_GITHUB_CLIENT_SECRET')!,
        // Login scopes ONLY. Deliberately not `repo`: Kase reads repositories
        // through a separate credential (Repository.credentialId), and
        // bundling code access into the sign-in grant would silently give the
        // app read access to every private repo of everyone who logs in.
        authorization: { params: { scope: 'read:user user:email' } },
      }),
    );
  }

  if (env('KASE_GOOGLE_CLIENT_ID') && env('KASE_GOOGLE_CLIENT_SECRET')) {
    providers.push(
      Google({
        clientId: env('KASE_GOOGLE_CLIENT_ID')!,
        clientSecret: env('KASE_GOOGLE_CLIENT_SECRET')!,
        authorization: { params: { scope: 'openid email profile' } },
      }),
    );
  }

  if (env('KASE_APPLE_CLIENT_ID') && env('KASE_APPLE_CLIENT_SECRET')) {
    providers.push(
      Apple({
        clientId: env('KASE_APPLE_CLIENT_ID')!,
        // Not a static secret: Apple requires a JWT signed with the .p8 key,
        // valid at most 6 months. It therefore EXPIRES, and needs a rotation
        // owner — see docs/17-security and ADR-013.
        clientSecret: env('KASE_APPLE_CLIENT_SECRET')!,
      }),
    );
  }

  return providers;
}
