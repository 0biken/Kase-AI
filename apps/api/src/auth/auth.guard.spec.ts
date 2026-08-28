import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SignJWT, generateKeyPair, exportSPKI } from 'jose';
import { AuthGuard } from './auth.guard';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { ProblemException } from '../common/problem-details';
import { newId } from '../common/ids';
import { generateApiToken } from './token-secret';

function ctxWithHeader(authorization?: string): ExecutionContext {
  const req: Record<string, unknown> = { headers: authorization ? { authorization } : {} };
  return {
    switchToHttp: () => ({ getRequest: () => req }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  let prisma: { apiToken: { findUnique: jest.Mock; update: jest.Mock } };
  let trail: { record: jest.Mock };
  let reflector: Reflector;
  let guard: AuthGuard;

  let publicKeyPem: string;
  let privateKey: CryptoKey;
  let userId: string;
  let orgId: string;

  beforeAll(async () => {
    const pair = await generateKeyPair('RS256');
    privateKey = pair.privateKey;
    publicKeyPem = await exportSPKI(pair.publicKey);
    userId = newId('user');
    orgId = newId('organization');
  });

  beforeEach(() => {
    process.env.KASE_JWT_PUBLIC_KEY = publicKeyPem;
    prisma = { apiToken: { findUnique: jest.fn(), update: jest.fn().mockResolvedValue({}) } };
    trail = { record: jest.fn().mockResolvedValue(undefined) };
    reflector = new Reflector();
    guard = new AuthGuard(reflector, prisma as unknown as PrismaService, trail as unknown as AuditTrailService);
  });

  afterEach(() => {
    delete process.env.KASE_JWT_PUBLIC_KEY;
  });

  async function signSessionJwt(overrides: Record<string, unknown> = {}): Promise<string> {
    return new SignJWT({ org: orgId, ...overrides })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);
  }

  // ------------------------------------------------------------- discriminator

  it('rejects a request with no Authorization header', async () => {
    await expect(guard.canActivate(ctxWithHeader())).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a header that is not "Bearer <value>"', async () => {
    await expect(guard.canActivate(ctxWithHeader('Basic abc123'))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('lets a @Public() route through with no header at all', async () => {
    reflector.getAllAndOverride = jest.fn().mockReturnValue(true);
    await expect(guard.canActivate(ctxWithHeader())).resolves.toBe(true);
  });

  // ------------------------------------------------------------------ token

  it('accepts a valid, unexpired, unrevoked API token', async () => {
    const t = generateApiToken();
    prisma.apiToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      projectId: 'prj_1',
      role: 'operator',
      tokenHash: t.tokenHash,
      revokedAt: null,
      expiresAt: null,
    });

    const ctx = ctxWithHeader(`Bearer ${t.plaintext}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    const req = ctx.switchToHttp().getRequest() as { principal: unknown };
    expect(req.principal).toEqual({
      kind: 'token',
      tokenId: 'tok_1',
      projectId: 'prj_1',
      role: 'operator',
      rateClass: 'token',
    });
    expect(prisma.apiToken.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'tok_1' } }),
    );
  });

  it('rejects an unknown token hash', async () => {
    prisma.apiToken.findUnique.mockResolvedValue(null);
    const t = generateApiToken();
    await expect(guard.canActivate(ctxWithHeader(`Bearer ${t.plaintext}`))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
    expect(trail.record).toHaveBeenCalledWith(expect.objectContaining({ action: 'auth.denied' }));
  });

  it('rejects a revoked token', async () => {
    const t = generateApiToken();
    prisma.apiToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      projectId: 'prj_1',
      role: 'operator',
      tokenHash: t.tokenHash,
      revokedAt: new Date('2020-01-01'),
      expiresAt: null,
    });
    await expect(guard.canActivate(ctxWithHeader(`Bearer ${t.plaintext}`))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects an expired token', async () => {
    const t = generateApiToken();
    prisma.apiToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      projectId: 'prj_1',
      role: 'operator',
      tokenHash: t.tokenHash,
      revokedAt: null,
      expiresAt: new Date('2020-01-01'),
    });
    await expect(guard.canActivate(ctxWithHeader(`Bearer ${t.plaintext}`))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a token record with a corrupted role rather than guessing one', async () => {
    const t = generateApiToken();
    prisma.apiToken.findUnique.mockResolvedValue({
      id: 'tok_1',
      projectId: 'prj_1',
      role: 'superadmin', // not in ROLES
      tokenHash: t.tokenHash,
      revokedAt: null,
      expiresAt: null,
    });
    await expect(guard.canActivate(ctxWithHeader(`Bearer ${t.plaintext}`))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  // ---------------------------------------------------------- session (JWT)

  it('accepts a validly signed, unexpired session JWT', async () => {
    const jwt = await signSessionJwt();
    const ctx = ctxWithHeader(`Bearer ${jwt}`);
    await expect(guard.canActivate(ctx)).resolves.toBe(true);

    const req = ctx.switchToHttp().getRequest() as { principal: unknown };
    expect(req.principal).toEqual({
      kind: 'session',
      userId,
      organizationId: orgId,
      rateClass: 'session',
    });
  });

  it('rejects a JWT signed by a different key', async () => {
    const otherPair = await generateKeyPair('RS256');
    const jwt = await new SignJWT({ org: orgId })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(otherPair.privateKey);

    await expect(guard.canActivate(ctxWithHeader(`Bearer ${jwt}`))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects an expired JWT', async () => {
    const jwt = await new SignJWT({ org: orgId })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(userId)
      .setIssuedAt()
      // A numeric (epoch-seconds) expiry, not a relative string: jose's
      // relative-time parser does not accept a negative duration like '-1h'.
      .setExpirationTime(Math.floor(Date.now() / 1000) - 3600)
      .sign(privateKey);

    await expect(guard.canActivate(ctxWithHeader(`Bearer ${jwt}`))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects algorithm confusion: an HS256 token "signed" with the public key PEM as the HMAC secret', async () => {
    // The classic JWT vulnerability: if the verifier trusted the header's
    // declared `alg` instead of pinning it, an attacker who knows the public
    // key (public by definition) could forge a session by HMAC-signing with
    // it. algorithms:['RS256'] in the guard must refuse this outright.
    const hmacSecret = new TextEncoder().encode(publicKeyPem);
    const jwt = await new SignJWT({ org: orgId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(hmacSecret);

    await expect(guard.canActivate(ctxWithHeader(`Bearer ${jwt}`))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a JWT missing the org claim', async () => {
    const jwt = await new SignJWT({})
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject(userId)
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(guard.canActivate(ctxWithHeader(`Bearer ${jwt}`))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('rejects a JWT whose sub/org are not well-formed Kase ids', async () => {
    const jwt = await new SignJWT({ org: 'not-an-org-id' })
      .setProtectedHeader({ alg: 'RS256' })
      .setSubject('not-a-user-id')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(privateKey);

    await expect(guard.canActivate(ctxWithHeader(`Bearer ${jwt}`))).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
    });
  });

  it('throws a clear error, not a silent default, when the public key is unset', async () => {
    delete process.env.KASE_JWT_PUBLIC_KEY;
    const jwt = await signSessionJwt();
    // The guard still returns a ProblemException to the caller (it must not
    // leak the raw config error), but it should not have accepted the
    // request either.
    await expect(guard.canActivate(ctxWithHeader(`Bearer ${jwt}`))).rejects.toBeInstanceOf(
      ProblemException,
    );
  });
});
