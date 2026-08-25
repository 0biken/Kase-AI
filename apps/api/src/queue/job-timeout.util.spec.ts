import { withJobTimeout, JobTimeoutError } from './job-timeout.util';

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<string>((resolve, reject) => {
    const t = setTimeout(() => resolve('finished'), ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new Error('aborted'));
    });
  });

describe('withJobTimeout', () => {
  it('returns the result when work finishes inside the budget', async () => {
    await expect(withJobTimeout('fast', 1000, () => sleep(5))).resolves.toBe('finished');
  });

  it('rejects with JobTimeoutError when the budget is exceeded', async () => {
    await expect(withJobTimeout('slow', 20, (s) => sleep(5000, s))).rejects.toBeInstanceOf(
      JobTimeoutError,
    );
  });

  it('reports the budget it enforced', async () => {
    // The orchestrator marks the category not_executed with a reason, so the
    // error has to carry enough to explain itself.
    await expect(withJobTimeout('slow', 20, (s) => sleep(5000, s))).rejects.toMatchObject({
      timeoutMs: 20,
      name: 'JobTimeoutError',
    });
  });

  it('aborts the signal so in-flight work actually stops', async () => {
    let aborted = false;
    await expect(
      withJobTimeout('abortable', 20, (signal) => {
        signal.addEventListener('abort', () => {
          aborted = true;
        });
        return sleep(5000, signal);
      }),
    ).rejects.toBeInstanceOf(JobTimeoutError);
    // Without this, a hung tool keeps running orphaned after the job fails.
    expect(aborted).toBe(true);
  });

  it('does not abort work that completed in time', async () => {
    let aborted = false;
    await withJobTimeout('fine', 1000, (signal) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      return sleep(5);
    });
    await new Promise((r) => setTimeout(r, 30));
    expect(aborted).toBe(false);
  });

  it('propagates the original error rather than masking it as a timeout', async () => {
    const boom = new Error('adapter exploded');
    await expect(withJobTimeout('failing', 1000, () => Promise.reject(boom))).rejects.toBe(boom);
  });

  it('rejects a nonsensical budget', async () => {
    await expect(withJobTimeout('bad', 0, (s) => sleep(1, s))).rejects.toThrow(/must be positive/);
    await expect(withJobTimeout('bad', -5, (s) => sleep(1, s))).rejects.toThrow(/must be positive/);
  });
});
