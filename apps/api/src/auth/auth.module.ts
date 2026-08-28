import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthGuard } from './auth.guard';
import { ProjectScopeGuard } from './project-scope.guard';
import { RolesGuard } from './roles.guard';

/**
 * Registers the three guards globally, in the order every request must pass
 * through them: who is calling (AuthGuard), what project they're calling
 * about and whether they belong to it (ProjectScopeGuard), then whether
 * their role permits this specific action (RolesGuard). `APP_GUARD`
 * providers run in registration order, so this array IS the pipeline —
 * reordering it changes what "authenticated" means before authorization
 * runs.
 *
 * Global rather than per-controller: a controller that forgets to attach
 * these guards would silently serve unauthenticated requests. A controller
 * can still exempt one route with `@Public()`.
 */
@Module({
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: ProjectScopeGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
