import {
  ALL_QUEUES,
  QUEUE_AUDIT,
  QUEUE_BLACKBOX_AGENT,
  QUEUE_TOOL,
  QueueName,
} from './queue.constants';

/**
 * Resource defaults from docs/02-stack §7. Every value is env-overridable so an
 * operator can tune a deployment without a rebuild, but the defaults ARE the
 * documented contract — changing one here means changing the doc.
 *
 * Env vars use the locked KASE_ prefix (02 §6). The unprefixed names are read
 * as a fallback so existing local setups keep working.
 */
function envInt(name: string, fallback: number): number {
  const raw = process.env[`KASE_${name}`] ?? process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(
      `Invalid ${name}: expected a positive number, got "${raw}". ` +
        `Concurrency and timeout caps must never silently fall back to a default.`,
    );
  }
  return Math.floor(parsed);
}

const MINUTE = 60_000;

/** 02 §7: "Concurrent audits per instance | 2 | Browser workers are memory-hungry" */
export const MAX_CONCURRENT_AUDITS = envInt('MAX_CONCURRENT_AUDITS', 2);

/** 02 §7: "Concurrent jobs per audit | 4" */
export const MAX_JOBS_PER_AUDIT = envInt('MAX_JOBS_PER_AUDIT', 4);

/** 02 §7: "Job timeout (default) | 10 min | Per-adapter override" */
export const DEFAULT_JOB_TIMEOUT_MS = envInt('JOB_TIMEOUT_MS', 10 * MINUTE);

/** 02 §7: "Job timeout (load test) | 30 min" */
export const LOAD_TEST_JOB_TIMEOUT_MS = envInt('LOAD_TEST_JOB_TIMEOUT_MS', 30 * MINUTE);

/** 02 §7: "Max retries | 2 | Then `failed`, audit continues" */
export const MAX_JOB_ATTEMPTS = envInt('MAX_JOB_ATTEMPTS', 2);

/**
 * Ceiling on job workers for one API instance.
 *
 * BullMQ concurrency is per-worker and global to that worker; it has no native
 * notion of "at most N in flight per audit". So the process-wide ceiling is the
 * product of the two documented caps, and the per-audit fairness limit
 * (MAX_JOBS_PER_AUDIT) is enforced by the orchestrator's scheduler when it
 * decides which ready jobs to enqueue — see docs/04-orchestrator §job graph.
 *
 * Stated plainly because it is easy to misread this number as the per-audit
 * cap: it is not. It is the whole-instance ceiling.
 */
export const GLOBAL_JOB_CONCURRENCY = MAX_CONCURRENT_AUDITS * MAX_JOBS_PER_AUDIT;

export interface QueueLimits {
  /** Worker concurrency for this queue. */
  concurrency: number;
  /** Wall-clock budget for a single job on this queue. */
  timeoutMs: number;
}

/**
 * Per-queue overrides. Anything absent inherits the global ceiling and the
 * default timeout — the "per-adapter override" escape hatch 02 §7 calls for.
 */
const OVERRIDES: Partial<Record<QueueName, Partial<QueueLimits>>> = {
  // One orchestrator run per audit, so this concurrency IS the audit cap.
  [QUEUE_AUDIT]: {
    concurrency: MAX_CONCURRENT_AUDITS,
    // An audit outlives any single job it dispatches.
    timeoutMs: LOAD_TEST_JOB_TIMEOUT_MS,
  },
  // Browser-backed and 2 GB apiece (02 §7); do not let these saturate the box.
  [QUEUE_BLACKBOX_AGENT]: {
    concurrency: MAX_CONCURRENT_AUDITS,
  },
  // Load tests are the documented 30-minute case.
  [QUEUE_TOOL]: {
    timeoutMs: LOAD_TEST_JOB_TIMEOUT_MS,
  },
};

export function limitsFor(queue: QueueName): QueueLimits {
  const override = OVERRIDES[queue] ?? {};
  return {
    concurrency: override.concurrency ?? GLOBAL_JOB_CONCURRENCY,
    timeoutMs: override.timeoutMs ?? DEFAULT_JOB_TIMEOUT_MS,
  };
}

export function redisConnection() {
  return {
    host: process.env.KASE_REDIS_HOST ?? process.env.REDIS_HOST ?? 'localhost',
    port: envInt('REDIS_PORT', 6379),
  };
}

/**
 * lockDuration must exceed the longest job a queue will run, otherwise BullMQ
 * decides a still-working job has stalled and hands it to another worker —
 * producing duplicate execution rather than the timeout we actually want.
 * The +1 min is renewal headroom.
 */
export function workerOptionsFor(queue: QueueName) {
  const { concurrency, timeoutMs } = limitsFor(queue);
  return {
    connection: redisConnection(),
    concurrency,
    lockDuration: timeoutMs + MINUTE,
    maxStalledCount: 1,
  };
}

export const QUEUE_LIMITS: Record<QueueName, QueueLimits> = Object.fromEntries(
  ALL_QUEUES.map((q) => [q, limitsFor(q)]),
) as Record<QueueName, QueueLimits>;
