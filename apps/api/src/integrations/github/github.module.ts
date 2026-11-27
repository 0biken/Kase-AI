import { Module } from '@nestjs/common';
import { AssuranceModule } from '../../assurance/assurance.module';
import { OrchestratorModule } from '../../orchestrator/orchestrator.module';
import { FetchGithubApi } from './github-client';
import { GITHUB_API, GITHUB_SETTINGS, loadGithubSettings, type GithubIntegrationSettings } from './github-config';
import { GithubProjectController, GithubWebhookController } from './github.controller';
import { GithubIntegrationService } from './github.service';

/**
 * M6 G7 — GitHub App: PR audits, the `Kase gate` check run, and the single
 * PR comment. Off unless KASE_GITHUB_* is configured (see github-config.ts).
 */
@Module({
  imports: [AssuranceModule, OrchestratorModule],
  controllers: [GithubProjectController, GithubWebhookController],
  providers: [
    { provide: GITHUB_SETTINGS, useFactory: () => loadGithubSettings() },
    { provide: GITHUB_API, inject: [GITHUB_SETTINGS], useFactory: (s: GithubIntegrationSettings | null) => (s ? new FetchGithubApi(s.app) : null) },
    GithubIntegrationService,
  ],
  exports: [GithubIntegrationService],
})
export class GithubModule {}
