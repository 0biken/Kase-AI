import { generateKeyPair, exportPKCS8, exportSPKI, importSPKI, jwtVerify, decodeJwt } from 'jose';
import { mintApiToken, resetSigningKeyCache } from './session-token';
import { newId, isId } from './ids';

/**
 * The contract between apps/web and apps/api.
 *
 * Splitting auth across two processes means the interesting failure is not
 * "does signing work" but "does the API actually accept what this app
 * produces". These tests mint with the private key and verify with the
 * public one exactly as AuthGuard does — same algorithm pinning, same
 * required claims — so a drift in either half fails here rather than in
 * production.
 */
describe('mintApiToken -> apps/api AuthGuard contract', () => {
  let privatePem: string;
  let publicPem: string;
  const userId = newId('user');
  const orgId = newId('organization');

  beforeAll(async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256');
    privatePem = await exportPKCS8(privateKey);
    publicPem = await exportSPKI(publicKey);
  });

  beforeEach(() => {
    resetSigningKeyCache();
    process.env.KASE_JWT_PRIVATE_KEY = privatePem;
  });

  afterEach(() => {
    delete process.env.KASE_JWT_PRIVATE_KEY;
    resetSigningKeyCache();
  });

  it('produces a token the API can verify with only the public key', async () => {
    const jwt = await mintApiToken(userId, orgId);

    // Byte-for-byte what apps/api/src/auth/auth.guard.ts does.
    const key = await importSPKI(publicPem, 'RS256');
    const { payload } = await jwtVerify(jwt, key, {
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'org', 'exp'],
    });

    expect(payload.sub).toBe(userId);
    expect(payload.org).toBe(orgId);
  });

  it('emits claims whose ids pass the API id validation', async () => {
    const jwt = await mintApiToken(userId, orgId);
    const payload = decodeJwt(jwt);

    // AuthGuard rejects a token whose sub/org are not well-formed Kase ids.
    // Shared prefix map means this cannot drift, but assert it anyway —
    // this is the assertion that would catch someone "helpfully" putting the
    // provider's subject in `sub`.
    expect(isId('user', payload.sub)).toBe(true);
    expect(isId('organization', payload.org)).toBe(true);
  });

  it('signs with RS256, not a symmetric algorithm', async () => {
    const jwt = await mintApiToken(userId, orgId);
    const header = JSON.parse(Buffer.from(jwt.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('RS256');
  });

  it('is short-lived — under an hour', async () => {
    const payload = decodeJwt(await mintApiToken(userId, orgId));
    const ttl = (payload.exp ?? 0) - (payload.iat ?? 0);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('does NOT carry a role claim', async () => {
    // Roles live on ProjectMember and are re-read per request, so revoking
    // access is immediate. A role baked into a 15-minute token would keep
    // working for 15 minutes after being revoked.
    const payload = decodeJwt(await mintApiToken(userId, orgId));
    expect(payload).not.toHaveProperty('role');
    expect(payload).not.toHaveProperty('roles');
  });

  it('a token from a different key is rejected by the API public key', async () => {
    const other = await generateKeyPair('RS256');
    process.env.KASE_JWT_PRIVATE_KEY = await exportPKCS8(other.privateKey);
    resetSigningKeyCache();

    const jwt = await mintApiToken(userId, orgId);
    const key = await importSPKI(publicPem, 'RS256');

    await expect(jwtVerify(jwt, key, { algorithms: ['RS256'] })).rejects.toThrow();
  });

  it('fails loudly when the private key is unset, rather than signing with a default', async () => {
    delete process.env.KASE_JWT_PRIVATE_KEY;
    resetSigningKeyCache();
    await expect(mintApiToken(userId, orgId)).rejects.toThrow(/KASE_JWT_PRIVATE_KEY/);
  });
});
