import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Actor } from '../projects/projects.service';

/**
 * Replaces the `actorFor()` placeholder projects.controller.ts carried
 * before this guard existed. Maps the Principal AuthGuard/ProjectScopeGuard
 * attached to the request onto the `Actor` shape the service layer already
 * expects for audit-trail attribution — nothing downstream of the
 * controller changes.
 */
export const CurrentActor = createParamDecorator((_: unknown, ctx: ExecutionContext): Actor => {
  const req = ctx.switchToHttp().getRequest<Request>();
  const principal = req.principal;

  if (!principal) {
    // Every route reaches here only after AuthGuard, except @Public() ones,
    // which have no legitimate reason to read an actor.
    throw new Error('CurrentActor used on a route with no principal — is it missing auth?');
  }

  if (principal.kind === 'session') {
    return { type: 'user', id: principal.userId, organizationId: principal.organizationId };
  }
  return { type: 'token', id: principal.tokenId };
});
