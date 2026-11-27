import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import type { GithubAppConfig } from './github-client';

/**
 * GitHub App settings come from the environment, not the database: the app's
 * private key is platform configuration shared by every project, and belongs
 * in the deployment's secret store (KASE_GITHUB_APP_PRIVATE_KEY_FILE points
 * at a mounted secret). With any required value missing, the integration is
 * off and its routes say so instead of half-working.
 */
export interface GithubIntegrationSettings {
  app: GithubAppConfig;
  slug: string;
  webhookSecret: string;
  /** Key for signing install `state`; derived so it is never the client secret itself. */
  stateKey: string;
  /** Public dashboard origin for check-run and comment links, if any. */
  dashboardUrl: string | null;
  reconcileIntervalMs: number;
}

export const GITHUB_SETTINGS = Symbol('GITHUB_SETTINGS');
export const GITHUB_API = Symbol('GITHUB_API');

export function loadGithubSettings(env: NodeJS.ProcessEnv = process.env): GithubIntegrationSettings | null {
  const privateKeyPem = env.KASE_GITHUB_APP_PRIVATE_KEY_FILE
    ? readFileSync(env.KASE_GITHUB_APP_PRIVATE_KEY_FILE, 'utf8')
    : env.KASE_GITHUB_APP_PRIVATE_KEY?.replace(/\\n/gu, '\n');
  const appId = Number.parseInt(env.KASE_GITHUB_APP_ID ?? '', 10);
  const required = [privateKeyPem, env.KASE_GITHUB_WEBHOOK_SECRET, env.KASE_GITHUB_CLIENT_ID, env.KASE_GITHUB_CLIENT_SECRET, env.KASE_GITHUB_APP_SLUG];
  if (!Number.isInteger(appId) || appId <= 0 || required.some(v => !v)) return null;
  const trim = (url: string) => url.replace(/\/+$/u, '');
  return {
    app: {
      appId, privateKeyPem: privateKeyPem!, clientId: env.KASE_GITHUB_CLIENT_ID!, clientSecret: env.KASE_GITHUB_CLIENT_SECRET!,
      apiUrl: trim(env.KASE_GITHUB_API_URL ?? 'https://api.github.com'), webUrl: trim(env.KASE_GITHUB_WEB_URL ?? 'https://github.com'),
    },
    slug: env.KASE_GITHUB_APP_SLUG!,
    webhookSecret: env.KASE_GITHUB_WEBHOOK_SECRET!,
    stateKey: createHmac('sha256', env.KASE_GITHUB_CLIENT_SECRET!).update('kase-github-install-state').digest('hex'),
    dashboardUrl: env.KASE_WEB_URL ? trim(env.KASE_WEB_URL) : null,
    reconcileIntervalMs: Math.max(1_000, Number.parseInt(env.KASE_GITHUB_RECONCILE_MS ?? '', 10) || 15_000),
  };
}
