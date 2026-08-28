import { Role } from './roles';

/**
 * The authenticated caller, as established by AuthGuard and refined by
 * ProjectScopeGuard. Two shapes because there are two credential types
 * (02-stack §5) — a single `AuthGuard` produces one or the other, never a
 * third thing, so callers can switch on `kind` exhaustively.
 */
export type Principal = SessionPrincipal | TokenPrincipal;

export interface SessionPrincipal {
  kind: 'session';
  userId: string;
  organizationId: string;
  /**
   * The caller's role on the project the current route resolves to.
   * Unset until ProjectScopeGuard resolves a `ProjectMember` row — a route
   * with no project in scope (list/create) never sets this.
   */
  role?: Role;
  /** 14 §11: session callers are rate-limited at 300 req/min. */
  rateClass: 'session';
}

export interface TokenPrincipal {
  kind: 'token';
  tokenId: string;
  /** An API token is scoped to exactly one project, always (14 §2). */
  projectId: string;
  role: Role;
  /** 14 §11: token callers are rate-limited at 600 req/min. */
  rateClass: 'token';
}

declare module 'express' {
  interface Request {
    principal?: Principal;
  }
}
