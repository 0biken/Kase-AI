import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'kase:isPublic';

/**
 * Marks a route as not requiring authentication at all. Rare — the health
 * check is the only route in this app that should ever carry it. Not the
 * same as `@OrgScope()`, which still requires a signed-in session; this
 * skips AuthGuard entirely.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
