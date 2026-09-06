import { JobTimeoutError } from '../queue/job-timeout.util';

export type JobErrorClass = 'transient' | 'timeout' | 'permanent' | 'cancelled';

export interface RetryDecision {
  retry: boolean;
  delayMs: number | null;
  timeoutMs: number;
  terminalStatus?: 'failed' | 'timed_out' | 'cancelled';
}

export class PermanentJobError extends Error {
  constructor(message: string, readonly code = 'validation') {
    super(message);
    this.name = 'PermanentJobError';
  }
}

export class CancelledJobError extends Error {
  constructor(message = 'Audit job cancelled') {
    super(message);
    this.name = 'CancelledJobError';
  }
}

export function classifyJobError(error: unknown): JobErrorClass {
  if (error instanceof CancelledJobError || (error instanceof Error && ['AbortError', 'ProcessCancelledError'].includes(error.name))) {
    return 'cancelled';
  }
  if (error instanceof JobTimeoutError) return 'timeout';
  if (error instanceof PermanentJobError) return 'permanent';
  if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return 'permanent';
  return 'transient';
}

/**
 * attempts is the number already started, including the failed attempt.
 * maxRetries=2 therefore allows attempts 1,2,3 and no fourth attempt.
 * A timeout is deliberately stricter: one retry at 1.5x the captured timeout.
 */
export function retryDecision(
  errorClass: JobErrorClass,
  attempts: number,
  maxRetries: number,
  timeoutMs: number,
): RetryDecision {
  if (errorClass === 'cancelled') {
    return { retry: false, delayMs: null, timeoutMs, terminalStatus: 'cancelled' };
  }
  if (errorClass === 'permanent') {
    return { retry: false, delayMs: null, timeoutMs, terminalStatus: 'failed' };
  }
  if (errorClass === 'timeout') {
    return attempts === 1
      ? { retry: true, delayMs: 1_000, timeoutMs: Math.ceil(timeoutMs * 1.5) }
      : { retry: false, delayMs: null, timeoutMs, terminalStatus: 'timed_out' };
  }
  const retry = attempts <= maxRetries;
  return retry
    ? { retry: true, delayMs: 1_000 * 2 ** (attempts - 1), timeoutMs }
    : { retry: false, delayMs: null, timeoutMs, terminalStatus: 'failed' };
}
