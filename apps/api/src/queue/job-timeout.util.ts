/**
 * Per-job wall-clock enforcement.
 *
 * BullMQ removed the `timeout` job option in v4; there is no queue-level
 * setting that bounds how long a processor may run. Left alone, a hung tool
 * adapter holds its concurrency slot until the lock expires, at which point
 * BullMQ treats the job as *stalled* and re-runs it elsewhere — duplicate
 * execution, which for an audit means duplicate evidence and skewed findings.
 *
 * So the bound is enforced here, inside the processor, where it fails the job
 * cleanly instead of leaking into stall detection.
 */
export class JobTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`Job "${label}" exceeded its ${timeoutMs}ms budget and was aborted`);
    this.name = 'JobTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Runs `work` under a wall-clock budget.
 *
 * `work` receives an AbortSignal: cooperative tasks (fetch, spawned tools)
 * should honour it so the underlying operation actually stops rather than
 * continuing orphaned after the race is lost. The signal is the only way to
 * stop work already in flight — rejecting the outer promise does not.
 */
export async function withJobTimeout<T>(
  label: string,
  timeoutMs: number,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`withJobTimeout: timeoutMs must be positive, got ${timeoutMs}`);
  }

  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      // Reject BEFORE aborting. abort() fires listeners synchronously, and a
      // cooperative task that rejects on abort would otherwise settle the race
      // first — surfacing its own "aborted" error and losing the fact that this
      // was a timeout. Settling here makes JobTimeoutError the observed
      // outcome; the abort below still stops the in-flight work.
      reject(new JobTimeoutError(label, timeoutMs));
      controller.abort();
    }, timeoutMs);
    // Do not hold the event loop open purely for this timer.
    timer.unref?.();
  });

  try {
    return await Promise.race([work(controller.signal), timeout]);
  } finally {
    // Always clear: on the success path the timer would otherwise sit pending
    // and, without unref, keep the process alive past the job.
    if (timer) clearTimeout(timer);
  }
}
