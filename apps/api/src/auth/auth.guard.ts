import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { importSPKI, jwtVerify, JWTPayload, KeyLike } from 'jose';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { ProblemException } from '../common/problem-details';
import { isId } from '../common/ids';
import { resolveJwtPublicKey } from './jwt-keys';
import { hashApiToken, looksLikeApiToken } from './token-secret';
import { isRole } from './roles';
import { Principal } from './principal';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * The single AuthGuard, per 02-stack §5: "NestJS holds a single AuthGuard
 * supporting both credential types ... Auth.js never runs server-side inside
 * Nest." Both credential types arrive the same way — `Authorization: Bearer
 * <value>` — so this is the one place that decides which kind of caller is
 * on the other end, and everything downstream (ProjectScopeGuard, RolesGuard,
 * @CurrentActor) reads req.principal rather than re-deriving identity.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);
  private publicKey?: Promise<KeyLike>;

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly trail: AuditTrailService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const credential = extractBearer(req);

    if (!credential) {
      throw new ProblemException('UNAUTHENTICATED', 'Missing or malformed Authorization header');
    }

    const principal = looksLikeApiToken(credential)
      ? await this.authenticateToken(credential, req)
      : await this.authenticateSession(credential, req);

    req.principal = principal;
    return true;
  }

  // ------------------------------------------------------------- API token

  private async authenticateToken(plaintext: string, req: Request): Promise<Principal> {
    const tokenHash = hashApiToken(plaintext);
    const record = await this.prisma.apiToken.findUnique({ where: { tokenHash } });

    if (!record || record.revokedAt || (record.expiresAt && record.expiresAt < new Date())) {
      await this.denyAuth(req, 'api_token', record?.id);
      throw new ProblemException('UNAUTHENTICATED', 'API token is invalid, revoked, or expired');
    }
    if (!isRole(record.role)) {
      // Data corruption, not a caller mistake — but the safe response to an
      // unrecognised role is still to deny, never to guess a default.
      this.logger.error(`ApiToken ${record.id} has unrecognised role "${record.role}"`);
      throw new ProblemException('UNAUTHENTICATED', 'API token is invalid, revoked, or expired');
    }

    // Best-effort: a failed write here must not fail an otherwise-valid request.
    this.prisma.apiToken
      .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
      .catch((err: unknown) => this.logger.warn(`Failed to update lastUsedAt: ${String(err)}`));

    return {
      kind: 'token',
      tokenId: record.id,
      projectId: record.projectId,
      role: record.role,
      rateClass: 'token',
    };
  }

  // --------------------------------------------------------- session (JWT)

  private async authenticateSession(jwt: string, req: Request): Promise<Principal> {
    try {
      const key = await this.getPublicKey();
      const { payload } = await jwtVerify(jwt, key, {
        // Pinned explicitly. Accepting whatever `alg` the token claims is
        // the classic JWT vulnerability: a caller could present an HS256
        // token "signed" with this very public key used as an HMAC secret,
        // and a verifier that trusts the header would accept it.
        algorithms: ['RS256'],
        requiredClaims: ['sub', 'org', 'exp'],
      });
      return this.principalFromClaims(payload);
    } catch (err) {
      await this.denyAuth(req, 'session_jwt');
      this.logger.debug(`JWT verification failed: ${String(err)}`);
      throw new ProblemException('UNAUTHENTICATED', 'Session token is invalid or expired');
    }
  }

  private principalFromClaims(payload: JWTPayload): Principal {
    const userId = payload.sub;
    const organizationId = (payload as { org?: unknown }).org;
    if (!isId('user', userId) || !isId('organization', organizationId)) {
      throw new Error('JWT claims sub/org are not well-formed Kase ids');
    }
    return { kind: 'session', userId, organizationId, rateClass: 'session' };
  }

  private getPublicKey(): Promise<KeyLike> {
    // Imported once per process, not per request: importSPKI parses and
    // validates the PEM, which is wasted work on every single call.
    this.publicKey ??= importSPKI(resolveJwtPublicKey(), 'RS256');
    return this.publicKey;
  }

  private async denyAuth(req: Request, method: 'api_token' | 'session_jwt', tokenId?: string) {
    await this.trail.record({
      actorType: method === 'api_token' ? 'token' : 'user',
      actorId: tokenId ?? null,
      action: 'auth.denied',
      metadata: { method, path: req.originalUrl },
      outcome: 'denied',
    });
  }
}

function extractBearer(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) return null;
  const value = header.slice('Bearer '.length).trim();
  return value.length > 0 ? value : null;
}
