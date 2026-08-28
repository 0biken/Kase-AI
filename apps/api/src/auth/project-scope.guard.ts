import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { AuditTrailService } from '../audit-trail/audit-trail.service';
import { ProblemException } from '../common/problem-details';
import { isId } from '../common/ids';
import { isRole } from './roles';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SCOPE_KEY, ScopeMeta } from './project-scope.decorator';

/**
 * Enforces T6 in the threat model (17 §2, cross-project data leakage): "no
 * unscoped queries." Every route runs through here after AuthGuard.
 *
 * The critical property is what happens when a route carries no
 * `@ProjectScope`/`@OrgScope` decorator: this guard DENIES, it does not
 * pass through. A naive implementation that reads `req.params.id` when
 * present and otherwise lets the request continue fails open on every route
 * that doesn't happen to have an `:id` param scoped the way the guard
 * assumes — exactly the kind of gap that produces cross-tenant reads. Every
 * route in this codebase has to opt in to a scope explicitly.
 */
@Injectable()
export class ProjectScopeGuard implements CanActivate {
  private readonly logger = new Logger(ProjectScopeGuard.name);

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
    const principal = req.principal;
    if (!principal) {
      // AuthGuard runs first in every real request path; reaching here
      // without a principal means the guard order was changed.
      throw new ProblemException('UNAUTHENTICATED', 'No authenticated principal');
    }

    // Method-level decorator wins over class-level, so one route on an
    // otherwise project-scoped controller (e.g. POST /projects) can opt out.
    const meta = this.reflector.getAllAndOverride<ScopeMeta | undefined>(SCOPE_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);

    if (!meta) {
      this.logger.error(
        `Route ${req.method} ${req.route?.path ?? req.originalUrl} has no @ProjectScope/@OrgScope decorator`,
      );
      throw new ProblemException(
        'PROJECT_SCOPE_DENIED',
        'This route is not configured for access control',
      );
    }

    if (meta.mode === 'org') {
      return this.checkOrgScope(principal, req);
    }
    return this.checkProjectScope(meta.param, principal, req);
  }

  private checkOrgScope(principal: Request['principal'], req: Request): boolean {
    // An API token is always scoped to one project and carries no
    // organizationId (14 §2) — it cannot make an org-level request on any
    // reading of the spec.
    if (principal!.kind !== 'session') {
      void this.denyScope(req, null, 'org-scope requires a session principal');
      throw new ProblemException(
        'PROJECT_SCOPE_DENIED',
        'This operation requires a signed-in session, not an API token',
      );
    }
    return true;
  }

  private async checkProjectScope(
    param: string,
    principal: NonNullable<Request['principal']>,
    req: Request,
  ): Promise<boolean> {
    const projectId = req.params[param];
    if (!isId('project', projectId)) {
      throw new ProblemException('NOT_FOUND', `"${String(projectId)}" is not a valid project id`);
    }

    if (principal.kind === 'token') {
      if (principal.projectId !== projectId) {
        await this.denyScope(req, projectId, 'token is scoped to a different project');
        throw new ProblemException('PROJECT_SCOPE_DENIED', 'Credential is not scoped to this project');
      }
      return true;
    }

    // Session principal: membership must exist and carries the role
    // RolesGuard checks next. Re-fetched per request rather than cached on
    // the JWT — a revoked membership must take effect immediately, not wait
    // for the token to expire.
    const membership = await this.prisma.projectMember.findUnique({
      where: { userId_projectId: { userId: principal.userId, projectId } },
    });
    if (!membership || !isRole(membership.role)) {
      await this.denyScope(req, projectId, 'no project membership');
      throw new ProblemException('PROJECT_SCOPE_DENIED', 'You are not a member of this project');
    }

    principal.role = membership.role;
    return true;
  }

  private async denyScope(req: Request, projectId: string | null, reason: string): Promise<void> {
    await this.trail.record({
      projectId,
      actorType: req.principal?.kind === 'token' ? 'token' : 'user',
      actorId:
        req.principal?.kind === 'token' ? req.principal.tokenId : (req.principal?.userId ?? null),
      action: 'scope.denied',
      metadata: { reason, path: req.originalUrl },
      outcome: 'denied',
    });
  }
}
