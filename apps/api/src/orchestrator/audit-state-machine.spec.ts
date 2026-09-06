import {
  assertAuditTransition,
  completionStatus,
  InvalidAuditTransitionError,
  isTerminalAuditStatus,
} from './audit-state-machine';

describe('orchestrator audit state machine', () => {
  it.each([
    ['queued', 'running'],
    ['queued', 'failed'],
    ['queued', 'cancelled'],
    ['running', 'completed'],
    ['running', 'partial'],
    ['running', 'failed'],
    ['running', 'cancelled'],
  ] as const)('permits %s -> %s', (from, to) => {
    expect(() => assertAuditTransition(from, to)).not.toThrow();
  });

  it.each(['completed', 'partial', 'failed', 'cancelled'] as const)(
    'keeps terminal state %s immutable',
    (from) => {
      expect(isTerminalAuditStatus(from)).toBe(true);
      expect(() => assertAuditTransition(from, 'running')).toThrow(
        InvalidAuditTransitionError,
      );
      expect(() => assertAuditTransition(from, from)).not.toThrow();
    },
  );

  it('derives completed, partial, failed, and cancelled centrally', () => {
    const base = {
      setupFailed: false,
      cancellationRequested: false,
      hasUsableResults: true,
      requiredJobsFailed: false,
      degradationReasons: [],
    };
    expect(completionStatus(base)).toBe('completed');
    expect(completionStatus({ ...base, requiredJobsFailed: true })).toBe('partial');
    expect(completionStatus({ ...base, degradationReasons: ['job_timeout'] })).toBe('partial');
    expect(completionStatus({ ...base, hasUsableResults: false })).toBe('failed');
    expect(completionStatus({ ...base, cancellationRequested: true })).toBe('cancelled');
  });
});
