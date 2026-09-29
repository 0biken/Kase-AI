/**
 * Provider-neutral retry strategy (ADR-017).
 *
 * Retries timeouts, 429s, and 5xx up to 3 times after the initial attempt
 * using 1s / 2s / 4s exponential backoff bounded by Retry-After.
 *
 * Does NOT retry authentication, model-not-found, malformed request,
 * or policy errors.
 */

import type { ProviderRetryableError, ProviderPermanentError } from './ai-provider.interface';

export type ErrorClassification =
  | 'retryable'
  | 'auth'
  | 'model_not_found'
  | 'malformed_request'
  | 'policy'
  | 'permanent';

export const MAX_RETRIES = 3;
const BACKOFF_MS = [1_000, 2_000, 4_000] as const;
const MAX_RETRY_AFTER_MS = 60_000;

export function classifyError(error: ProviderRetryableError | ProviderPermanentError): ErrorClassification {
  if (error.type === 'retryable_error') return 'retryable';
  const code = error.code.toLowerCase();
  if (code.includes('auth') || code === '401' || code === 'authentication_error') return 'auth';
  if (code.includes('not_found') || code === '404' || code === 'model_not_found_error') return 'model_not_found';
  if (code.includes('invalid') || code === '400' || code === 'invalid_request_error') return 'malformed_request';
  if (code.includes('policy') || code.includes('permission') || code === '403') return 'policy';
  return 'permanent';
}

export function shouldRetry(classification: ErrorClassification): boolean {
  return classification === 'retryable';
}

export function backoffMs(attempt: number, retryAfterMs?: number): number {
  const base = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  if (retryAfterMs !== undefined && retryAfterMs > 0) {
    return Math.min(retryAfterMs, MAX_RETRY_AFTER_MS);
  }
  return base;
}

export async function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(signal.reason);
    }, { once: true });
  });
}
