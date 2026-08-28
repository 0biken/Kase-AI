import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { ProblemException } from '../common/problem-details';
import { Role } from './roles';
import { ROLES_KEY } from './roles.decorator';

/**
 * Runs after ProjectScopeGuard, which is what makes this cheap: by the time
 * this guard sees the request, `req.principal.role` is already the caller's
 * role on the resolved project (for a token, known since AuthGuard; for a
 * session, resolved from ProjectMember). This guard only compares it against
 * the route's `@Roles(...)` allowlist — a set-membership check, never a rank
 * comparison (roles.ts explains why).
 *
 * No `@Roles()` on a route means "any project member" — ProjectScopeGuard
 * already proved membership, so an unmarked GET is intentionally permissive
 * to any of the four roles, matching 14 §2's "viewer: read audits, findings,
 * reports."
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const role = req.principal?.role;

    if (!role || !required.includes(role)) {
      throw new ProblemException(
        'FORBIDDEN',
        `This action requires one of: ${required.join(', ')}`,
      );
    }
    return true;
  }
}
