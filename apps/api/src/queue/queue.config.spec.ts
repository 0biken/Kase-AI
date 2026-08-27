import { QUEUE_AUDIT, QUEUE_BLACKBOX_AGENT, QUEUE_TOOL, QUEUE_CORRELATE, ALL_QUEUES } from './queue.constants';

describe('queue config — docs/02-stack §7 resource defaults', () => {
  // The config module reads env at import time, so each assertion about env
  // handling needs a fresh module registry.
  const loadFresh = () => {
    let mod: typeof import('./queue.config');
    jest.isolateModules(() => {
      mod = require('./queue.config');
    });
    return mod!;
  };

  const ORIGINAL_ENV = process.env;
  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    delete process.env.KASE_MAX_CONCURRENT_AUDITS;
    delete process.env.MAX_CONCURRENT_AUDITS;
    delete process.env.KASE_JOB_TIMEOUT_MS;
  });
  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('matches the documented defaults', () => {
    const c = loadFresh();
    expect(c.MAX_CONCURRENT_AUDITS).toBe(2);
    expect(c.MAX_JOBS_PER_AUDIT).toBe(4);
    expect(c.DEFAULT_JOB_TIMEOUT_MS).toBe(10 * 60_000);
    expect(c.LOAD_TEST_JOB_TIMEOUT_MS).toBe(30 * 60_000);
    expect(c.MAX_JOB_ATTEMPTS).toBe(2);
  });

  it('derives the instance ceiling as audits x jobs-per-audit', () => {
    const c = loadFresh();
    expect(c.GLOBAL_JOB_CONCURRENCY).toBe(8);
  });

  it('caps the audit queue at the concurrent-audit limit, not the ceiling', () => {
    const c = loadFresh();
    // Regression guard: the audit queue must never inherit GLOBAL_JOB_CONCURRENCY.
    // If it did, one instance would run 8 audits at once against a 2-audit cap.
    expect(c.limitsFor(QUEUE_AUDIT).concurrency).toBe(2);
    expect(c.limitsFor(QUEUE_AUDIT).concurrency).toBeLessThan(c.GLOBAL_JOB_CONCURRENCY);
  });

  it('throttles browser-backed blackbox work below the ceiling', () => {
    const c = loadFresh();
    expect(c.limitsFor(QUEUE_BLACKBOX_AGENT).concurrency).toBe(2);
  });

  it('gives tool jobs the 30-minute load-test budget', () => {
    const c = loadFresh();
    expect(c.limitsFor(QUEUE_TOOL).timeoutMs).toBe(30 * 60_000);
  });

  it('falls back to the default timeout for queues without an override', () => {
    const c = loadFresh();
    expect(c.limitsFor(QUEUE_CORRELATE).timeoutMs).toBe(10 * 60_000);
    expect(c.limitsFor(QUEUE_CORRELATE).concurrency).toBe(8);
  });

  it('assigns limits to every queue in the topology', () => {
    const c = loadFresh();
    for (const q of ALL_QUEUES) {
      const l = c.limitsFor(q);
      expect(l.concurrency).toBeGreaterThan(0);
      expect(l.timeoutMs).toBeGreaterThan(0);
    }
  });

  it('holds the job lock longer than the job may run', () => {
    const c = loadFresh();
    // If lockDuration <= timeout, BullMQ reclaims a still-running job as
    // stalled and executes it twice — duplicate evidence for one audit.
    for (const q of ALL_QUEUES) {
      expect(c.workerOptionsFor(q).lockDuration).toBeGreaterThan(c.limitsFor(q).timeoutMs);
    }
  });

  it('honours a KASE_-prefixed override', () => {
    process.env.KASE_MAX_CONCURRENT_AUDITS = '5';
    const c = loadFresh();
    expect(c.MAX_CONCURRENT_AUDITS).toBe(5);
    expect(c.GLOBAL_JOB_CONCURRENCY).toBe(20);
  });

  it('accepts the unprefixed name as a fallback', () => {
    process.env.MAX_CONCURRENT_AUDITS = '3';
    const c = loadFresh();
    expect(c.MAX_CONCURRENT_AUDITS).toBe(3);
  });

  it('refuses a malformed cap rather than silently defaulting', () => {
    process.env.KASE_MAX_CONCURRENT_AUDITS = 'unlimited';
    // Silently falling back would run an unbounded instance while the operator
    // believes they set a limit.
    expect(() => loadFresh()).toThrow(/positive number/);
  });

  it('refuses a zero or negative cap', () => {
    process.env.KASE_MAX_CONCURRENT_AUDITS = '0';
    expect(() => loadFresh()).toThrow(/positive number/);
  });
});
