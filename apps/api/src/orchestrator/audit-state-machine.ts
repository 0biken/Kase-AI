export const AUDIT_STATUSES = [
  'queued',
  'running',
  'completed',
  'partial',
  'failed',
  'cancelled',
] as const;

export type AuditStatus = (typeof AUDIT_STATUSES)[number];
export type TerminalAuditStatus = Extract<
  AuditStatus,
  'completed' | 'partial' | 'failed' | 'cancelled'
>;

export const TERMINAL_AUDIT_STATUSES: readonly TerminalAuditStatus[] = [
  'completed',
  'partial',
  'failed',
  'cancelled',
];

const TRANSITIONS: Readonly<Record<AuditStatus, readonly AuditStatus[]>> = {
  queued: ['running', 'failed', 'cancelled'],
  running: ['completed', 'partial', 'failed', 'cancelled'],
  completed: [],
  partial: [],
  failed: [],
  cancelled: [],
};

export class InvalidAuditTransitionError extends Error {
  constructor(
    readonly from: AuditStatus,
    readonly to: AuditStatus,
  ) {
    super(`Illegal audit status transition: ${from} -> ${to}`);
    this.name = 'InvalidAuditTransitionError';
  }
}

export function isTerminalAuditStatus(
  status: string,
): status is TerminalAuditStatus {
  return (TERMINAL_AUDIT_STATUSES as readonly string[]).includes(status);
}

/**
 * Enforces terminal immutability. Re-applying the same state is allowed so
 * recovery and cancellation can be safely retried.
 */
export function assertAuditTransition(from: AuditStatus, to: AuditStatus): void {
  if (from === to) return;
  if (!TRANSITIONS[from].includes(to)) {
    throw new InvalidAuditTransitionError(from, to);
  }
}

export interface AuditCompletionInput {
  setupFailed: boolean;
  cancellationRequested: boolean;
  hasUsableResults: boolean;
  requiredJobsFailed: boolean;
  degradationReasons: readonly string[];
}

/** Central terminal-state policy used by the scheduler after the graph settles. */
export function completionStatus(input: AuditCompletionInput): TerminalAuditStatus {
  if (input.cancellationRequested) return 'cancelled';
  if (input.setupFailed || !input.hasUsableResults) return 'failed';
  if (input.requiredJobsFailed || input.degradationReasons.length > 0) return 'partial';
  return 'completed';
}
