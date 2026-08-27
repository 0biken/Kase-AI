import { SetMetadata } from '@nestjs/common';

export const SCOPE_KEY = 'kase:scope';

export type ScopeMeta = { mode: 'project'; param: string } | { mode: 'org' };

/**
 * Marks a route (or a whole controller) as scoped to the project named by
 * `param` in the route path — e.g. `@ProjectScope('id')` for
 * `/projects/:id/...`. ProjectScopeGuard resolves the project directly from
 * this param, so the check never has to load a row to discover which
 * project a request touches.
 *
 * A method-level decorator overrides a class-level one; see
 * ProjectScopeGuard for the precedence.
 */
export const ProjectScope = (param: string) =>
  SetMetadata<string, ScopeMeta>(SCOPE_KEY, { mode: 'project', param });

/**
 * Marks a route as intentionally organization-level rather than
 * project-level — `POST /projects` and `GET /projects` are the only two in
 * this codebase, because a project cannot be project-scoped before it
 * exists. Deliberately explicit rather than "no decorator means org-level",
 * because ProjectScopeGuard denies by default: an unmarked route is a bug,
 * not an org-level route.
 *
 * Only a session principal can call an org-scoped route. An API token is
 * always scoped to one project (14 §2) and carries no organizationId, so
 * "list every project in the org" or "create a project" are not requests a
 * token can make on any reading of the spec.
 */
export const OrgScope = () => SetMetadata<string, ScopeMeta>(SCOPE_KEY, { mode: 'org' });
