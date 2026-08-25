import { Controller, Get } from '@nestjs/common';

/**
 * Build-info endpoint. This is the target-side half of build provenance
 * (ADR-003): it lets Kase confirm the deployment it is probing was built
 * from the commit it is about to read source from.
 *
 * Without this (or a CI-supplied SHA), correlation is `verified: false`
 * and must not be allowed to block a release.
 */
@Controller('healthz')
export class HealthController {
  @Get()
  health() {
    return {
      status: 'ok',
      commit: process.env.FIXTURE_COMMIT_SHA ?? null,
    };
  }
}
