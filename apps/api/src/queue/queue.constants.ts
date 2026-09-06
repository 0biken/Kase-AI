/**
 * Queue topology.
 *
 * One queue per AuditJob.kind (see packages/db/schema.prisma), plus a
 * top-level `audit` queue carrying the orchestrator run itself. Splitting by
 * kind rather than using a single queue is what makes the per-family limits in
 * 02 §7 expressible at all: a browser-backed blackbox job and a correlate job
 * have very different memory profiles and timeouts, and a shared queue would
 * force the strictest cap onto everything.
 */
export const QUEUE_AUDIT = 'audit';
export const QUEUE_RECON = 'recon';
export const QUEUE_BLACKBOX_AGENT = 'blackbox-agent';
export const QUEUE_WHITEBOX_AGENT = 'whitebox-agent';
export const QUEUE_TOOL = 'tool';
export const QUEUE_CORRELATE = 'correlate';
export const QUEUE_REPORT = 'report';
export const QUEUE_PROVENANCE = 'build-provenance';
export const QUEUE_SEMGREP = 'semgrep';
export const QUEUE_HTTP = 'http';
export const QUEUE_NORMALIZE_SEVERITY = 'normalize-severity';

export const JOB_QUEUES = [
  QUEUE_RECON,
  QUEUE_BLACKBOX_AGENT,
  QUEUE_WHITEBOX_AGENT,
  QUEUE_TOOL,
  QUEUE_CORRELATE,
  QUEUE_REPORT,
  QUEUE_PROVENANCE,
  QUEUE_SEMGREP,
  QUEUE_HTTP,
  QUEUE_NORMALIZE_SEVERITY,
] as const;

export const ALL_QUEUES = [QUEUE_AUDIT, ...JOB_QUEUES] as const;

export type QueueName = (typeof ALL_QUEUES)[number];

/** Maps AuditJob.kind onto the queue that serves it. */
export const QUEUE_BY_JOB_KIND: Record<string, QueueName> = {
  recon: QUEUE_RECON,
  blackbox_agent: QUEUE_BLACKBOX_AGENT,
  whitebox_agent: QUEUE_WHITEBOX_AGENT,
  tool: QUEUE_TOOL,
  correlate: QUEUE_CORRELATE,
  report: QUEUE_REPORT,
  build_provenance: QUEUE_PROVENANCE,
  semgrep: QUEUE_SEMGREP,
  http: QUEUE_HTTP,
  normalize_severity: QUEUE_NORMALIZE_SEVERITY,
};
