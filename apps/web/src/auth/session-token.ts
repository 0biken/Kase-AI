import { SignJWT, importPKCS8 } from 'jose';
import type { KeyLike } from 'jose';

/**
 * Mints the short-lived RS256 JWT that apps/api verifies (02-stack §5,
 * ADR-013).
 *
 * This is the *only* place in the system that holds the private key. The API
 * holds the public half and can therefore verify a session but never forge
 * one — which is the whole reason for RS256 over a shared HS256 secret.
 *
 * The claim set is deliberately minimal: `sub` (user id) and `org`. Roles are
 * NOT carried here. They live on ProjectMember and are re-read per request by
 * ProjectScopeGuard, so revoking someone's access takes effect immediately
 * rather than waiting out the token's lifetime.
 */

/** Short by design — the API re-checks membership on every request anyway. */
const TOKEN_TTL = '15m';

let cachedKey: Promise<KeyLike> | undefined;

export function resolveSigningKey(): Promise<KeyLike> {
  cachedKey ??= (async () => {
    const raw = process.env.KASE_JWT_PRIVATE_KEY;
    if (!raw || raw.trim() === '') {
      throw new Error(
        'KASE_JWT_PRIVATE_KEY is not set. It must hold the RS256 private key (PKCS#8 PEM) ' +
          'used to sign session JWTs for the API. See apps/web/.env.example.',
      );
    }
    // A PEM in a single-line env var commonly carries literal "\n"; most env
    // stores cannot hold a real multi-line value.
    const pem = raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
    return importPKCS8(pem, 'RS256');
  })();
  return cachedKey;
}

/** Test seam: the key is cached per process, so tests must be able to reset it. */
export function resetSigningKeyCache(): void {
  cachedKey = undefined;
}

export async function mintApiToken(userId: string, organizationId: string): Promise<string> {
  const key = await resolveSigningKey();
  return new SignJWT({ org: organizationId })
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(userId)
    .setIssuedAt()
    .setExpirationTime(TOKEN_TTL)
    .sign(key);
}
