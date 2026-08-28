/**
 * RS256 public key resolution.
 *
 * 02-stack §5: Next signs the session JWT; Nest only ever verifies it. Nest
 * therefore holds the PUBLIC half only — this file has no way to load a
 * private key, on purpose. A compromised API process cannot mint a session
 * for any user, only reject or accept ones Next already signed.
 *
 * Same fail-loud posture as resolveDatabaseUrl in prisma.service.ts: a
 * missing key fails at boot with the fix, not on the first request that
 * happens to need it.
 */
export function resolveJwtPublicKey(): string {
  const raw = process.env.KASE_JWT_PUBLIC_KEY;
  if (!raw || raw.trim() === '') {
    throw new Error(
      'KASE_JWT_PUBLIC_KEY is not set. It must hold the RS256 public key (PEM) Next.js ' +
        'signs session JWTs with. See apps/api/.env.example.',
    );
  }
  // A PEM in a single-line env var commonly carries literal "\n" rather than
  // real newlines; env files and most process managers cannot store a
  // multi-line value directly.
  return raw.includes('\\n') ? raw.replace(/\\n/g, '\n') : raw;
}
