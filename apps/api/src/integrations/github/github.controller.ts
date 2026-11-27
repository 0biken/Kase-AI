import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Inject, Optional, Param, Post, Put, Query, Req, Res, type RawBodyRequest } from '@nestjs/common';
import { IsBoolean, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import type { Request, Response } from 'express';
import { CurrentActor } from '../../auth/current-actor.decorator';
import { ProjectScope } from '../../auth/project-scope.decorator';
import { Public } from '../../auth/public.decorator';
import { Roles } from '../../auth/roles.decorator';
import { isId } from '../../common/ids';
import { ProblemException } from '../../common/problem-details';
import type { Actor } from '../../projects/projects.service';
import { GITHUB_SETTINGS, type GithubIntegrationSettings } from './github-config';
import { checkRunEventSchema, pullRequestEventSchema, verifyWebhookSignature } from './github-security';
import { GithubIntegrationService, type WebhookResult } from './github.service';

export class GithubConfigDto {
  @IsIn(['security', 'full'])
  mode!: 'security' | 'full';

  @IsOptional() @IsString() @MinLength(1)
  targetId?: string;

  @IsOptional() @IsBoolean()
  partialIsFailure?: boolean;

  @IsOptional() @IsBoolean()
  auditForks?: boolean;
}

function projectId(id: string): string {
  if (!isId('project', id)) throw new ProblemException('NOT_FOUND', `"${id}" is not a valid project id`);
  return id;
}

/** Project-side GitHub settings (14-api §"GitHub App installation"). Changing them is admin-only. */
@Controller('projects/:id/integrations/github')
@ProjectScope('id')
export class GithubProjectController {
  constructor(private readonly github: GithubIntegrationService) {}

  @Get()
  @Roles('viewer', 'operator', 'approver', 'admin')
  status(@Param('id') id: string) {
    return this.github.status(projectId(id));
  }

  @Get('install-url')
  @Roles('admin')
  installUrl(@Param('id') id: string, @CurrentActor() actor: Actor) {
    return this.github.installUrl(projectId(id), actor);
  }

  @Put()
  @Roles('admin')
  configure(@Param('id') id: string, @Body() dto: GithubConfigDto, @CurrentActor() actor: Actor) {
    return this.github.configure(projectId(id), dto, actor);
  }
}

/**
 * GitHub-facing routes. Both are `@Public()` because GitHub, not a Kase
 * user, calls them: the callback is authenticated by its signed `state` plus
 * the installing user's OAuth code, and the webhook by its HMAC signature
 * over the raw body, checked before the body is parsed.
 */
@Controller('integrations/github')
export class GithubWebhookController {
  constructor(
    private readonly github: GithubIntegrationService,
    @Optional() @Inject(GITHUB_SETTINGS) private readonly settings: GithubIntegrationSettings | null,
  ) {}

  @Get('callback')
  @Public()
  async callback(@Query() query: Record<string, string | undefined>, @Res({ passthrough: true }) res: Response) {
    const result = await this.github.completeInstall({
      installationId: query.installation_id, code: query.code, state: query.state, setupAction: query.setup_action,
    });
    if ('redirect' in result && result.redirect) {
      res.redirect(HttpStatus.FOUND, result.redirect);
      return undefined;
    }
    return result;
  }

  @Post('webhook')
  @Public()
  @HttpCode(HttpStatus.ACCEPTED)
  async webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-github-event') event: string | undefined,
    @Headers('x-hub-signature-256') signature: string | undefined): Promise<WebhookResult> {
    if (!this.settings || !this.github.enabled) throw new ProblemException('NOT_FOUND', 'The GitHub App is not configured on this Kase deployment');
    if (!verifyWebhookSignature(this.settings.webhookSecret, req.rawBody, signature)) {
      throw new ProblemException('UNAUTHENTICATED', 'Webhook signature does not match');
    }
    let payload: unknown;
    try { payload = JSON.parse(req.rawBody!.toString('utf8')); } catch { throw new ProblemException('VALIDATION_FAILED', 'Webhook body is not JSON'); }
    if (event === 'ping') return { status: 'pong' };
    if (event === 'pull_request') {
      const parsed = pullRequestEventSchema.safeParse(payload);
      if (!parsed.success) return { status: 'ignored', reason: 'unrecognised pull_request payload' };
      return this.github.handlePullRequest(parsed.data);
    }
    if (event === 'check_run') {
      const parsed = checkRunEventSchema.safeParse(payload);
      if (!parsed.success) return { status: 'ignored', reason: 'unrecognised check_run payload' };
      return this.github.handleCheckRun(parsed.data);
    }
    return { status: 'ignored', reason: `event ${event ?? 'unknown'}` };
  }
}
