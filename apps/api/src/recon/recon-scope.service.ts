import { Injectable } from '@nestjs/common';
import { isHostAllowed } from '../common/host-pattern';

export type ScopeDenialReason = 'invalid_url' | 'credentials_forbidden' | 'scheme_not_allowed' |
  'host_not_allowed' | 'port_not_allowed' | 'path_denied';

export interface ReconScopePolicy {
  allowedHosts: readonly string[];
  deniedPaths: readonly string[];
  targetBaseUrl: string;
}

export interface ScopeDecision {
  allowed: boolean;
  url?: string;
  reason?: ScopeDenialReason;
  host?: string;
  path?: string;
}

@Injectable()
export class ReconScopeService {
  check(raw: string, policy: ReconScopePolicy): ScopeDecision {
    let url: URL;
    let target: URL;
    try {
      url = new URL(raw);
      target = new URL(policy.targetBaseUrl);
    } catch {
      return { allowed: false, reason: 'invalid_url' };
    }
    if (url.username || url.password) return denied(url, 'credentials_forbidden');
    if (!['http:', 'https:'].includes(url.protocol)) return denied(url, 'scheme_not_allowed');
    const host = url.hostname.toLowerCase();
    if (!isHostAllowed(host, [...policy.allowedHosts])) return denied(url, 'host_not_allowed');
    if (effectivePort(url) !== effectivePort(target)) return denied(url, 'port_not_allowed');
    if (policy.deniedPaths.some((pattern) => matchesDeniedPath(url.pathname, pattern))) return denied(url, 'path_denied');
    url.username = '';
    url.password = '';
    url.hash = '';
    return { allowed: true, url: url.toString(), host, path: url.pathname };
  }

  katanaScope(policy: ReconScopePolicy): { crawlScope: string; crawlOutScope: string[] } {
    const target = new URL(policy.targetBaseUrl);
    const origin = escapeRegex(`${target.protocol}//${target.host}`);
    return {
      crawlScope: `^${origin}(/|$)`,
      crawlOutScope: policy.deniedPaths.map((path) => `${origin}${globToRegex(path)}($|[/?#])`),
    };
  }

  canonicalDeniedUrl(raw: string): string | null {
    try {
      const url = new URL(raw);
      return `${url.protocol}//${url.host}${url.pathname}`;
    } catch { return null; }
  }
}

function denied(url: URL, reason: ScopeDenialReason): ScopeDecision {
  return { allowed: false, reason, host: url.hostname.toLowerCase(), path: url.pathname };
}

function effectivePort(url: URL): string {
  return url.port || (url.protocol === 'https:' ? '443' : '80');
}

function matchesDeniedPath(path: string, pattern: string): boolean {
  const normalized = pattern.startsWith('/') ? pattern : `/${pattern}`;
  const regex = new RegExp(`^${globToRegex(normalized)}(?:$|/)`, 'u');
  return regex.test(path);
}

function globToRegex(value: string): string {
  return escapeRegex(value).replace(/\\\*/gu, '.*');
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
