import { createHash, randomBytes } from 'crypto';

/**
 * API token generation and verification, per 14-api §2 and 20-adr (auth ADR).
 *
 * SHA-256, not a password hash (bcrypt/argon2). Those exist to slow down
 * brute-forcing a *low-entropy* human password. A Kase token is 30 bytes of
 * CSPRNG output — brute force is already infeasible — so a slow hash buys
 * nothing and only adds latency on a path budgeted at 600 req/min (14 §11).
 * This is the same reasoning GitHub and Stripe apply to their own tokens.
 *
 * There is deliberately no constant-time comparison here. The hash is looked
 * up via a unique DB index (`ApiToken.tokenHash`), not compared byte-by-byte
 * against a value an attacker can retry — the comparison an attacker could
 * time is Postgres's index lookup, not application code.
 */
const PREFIX = 'kase_';
const SECRET_BYTES = 30;
const DISPLAY_PREFIX_LEN = 8;

export interface GeneratedToken {
  /** Shown to the caller exactly once. Never persisted. */
  plaintext: string;
  /** Persisted. Looked up on every authenticated request. */
  tokenHash: string;
  /** Persisted and listable — enough to recognise a token, not enough to use it. */
  displayPrefix: string;
}

export function generateApiToken(): GeneratedToken {
  const secret = randomBytes(SECRET_BYTES).toString('base64url');
  const plaintext = `${PREFIX}${secret}`;
  return {
    plaintext,
    tokenHash: hashApiToken(plaintext),
    displayPrefix: plaintext.slice(0, DISPLAY_PREFIX_LEN),
  };
}

export function hashApiToken(plaintext: string): string {
  return createHash('sha256').update(plaintext, 'utf8').digest('hex');
}

/** The `kase_` prefix is the AuthGuard's discriminator between the two credential types. */
export function looksLikeApiToken(bearerValue: string): boolean {
  return bearerValue.startsWith(PREFIX);
}
