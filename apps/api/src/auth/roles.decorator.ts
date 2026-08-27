import { SetMetadata } from '@nestjs/common';
import { Role } from './roles';

export const ROLES_KEY = 'kase:roles';

/**
 * Restricts a route to callers whose role is one of `roles` — set
 * membership, never a rank comparison (see roles.ts). Omitting this
 * decorator on a project-scoped route means "any project member may call
 * this", which is the correct default for reads: 14 §2 gives `viewer` read
 * access and ProjectScopeGuard already proved membership before RolesGuard
 * runs.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
