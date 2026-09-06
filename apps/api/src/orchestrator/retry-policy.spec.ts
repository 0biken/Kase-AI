import { JobTimeoutError } from '../queue/job-timeout.util';
import {
  CancelledJobError,
  classifyJobError,
  PermanentJobError,
  retryDecision,
} from './retry-policy';

describe('orchestrator retry policy', () => {
  it('means two retries are exactly three total transient attempts at 1s/2s', () => {
    expect(retryDecision('transient', 1, 2, 100)).toMatchObject({ retry: true, delayMs: 1_000 });
    expect(retryDecision('transient', 2, 2, 100)).toMatchObject({ retry: true, delayMs: 2_000 });
    expect(retryDecision('transient', 3, 2, 100)).toMatchObject({ retry: false, terminalStatus: 'failed' });
  });

  it('allows one timeout retry at 1.5x and then terminally times out', () => {
    expect(retryDecision('timeout', 1, 2, 10_000)).toEqual({ retry: true, delayMs: 1_000, timeoutMs: 15_000 });
    expect(retryDecision('timeout', 2, 2, 15_000)).toMatchObject({ retry: false, terminalStatus: 'timed_out' });
  });

  it('never retries permanent or cancelled work and classifies typed errors', () => {
    expect(classifyJobError(new PermanentJobError('bad rule'))).toBe('permanent');
    expect(classifyJobError(new JobTimeoutError('job', 10))).toBe('timeout');
    expect(classifyJobError(new CancelledJobError())).toBe('cancelled');
    expect(classifyJobError(Object.assign(new Error('cancelled'), { name: 'ProcessCancelledError' }))).toBe('cancelled');
    expect(classifyJobError(Object.assign(new Error('spawn semgrep ENOENT'), { code: 'ENOENT' }))).toBe('permanent');
    expect(retryDecision('permanent', 1, 2, 100).retry).toBe(false);
  });
});
