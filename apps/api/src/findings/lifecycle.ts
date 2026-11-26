import type { Role } from '../auth/roles';

/**
 * Finding lifecycle (09-findings §6) as explicit, testable rules.
 *
 * Two kinds of transition exist and they never mix:
 *  - observation transitions, applied by the platform when an audit settles;
 *  - decision transitions, made by an authorised person with a reason.
 *
 * `not_reproduced` is not a resolution: it keeps blocking and returns to
 * `open` on reappearance. Absence alone never produces `fixed`. Only a
 * completed audit that actually ran the producing category can mark a finding
 * absent; a partial, failed or narrower audit says nothing about it.
 */

export const FINDING_STATUSES = ['new', 'open', 'not_reproduced', 'fixed', 'verified', 'regressed', 'false_positive', 'accepted_risk'] as const;
export type LifecycleStatus = (typeof FINDING_STATUSES)[number];

export type Decision = 'false_positive' | 'accepted_risk' | 'reopen' | 'confirm_fixed';

interface DecisionRule { from: readonly LifecycleStatus[]; to: LifecycleStatus; roles: readonly Role[] }

/** Who may decide what, from where. Everything not listed is refused. */
export const DECISIONS: Record<Decision, DecisionRule> = {
  false_positive: { from: ['new', 'open', 'not_reproduced', 'regressed'], to: 'false_positive', roles: ['approver', 'admin'] },
  accepted_risk: { from: ['new', 'open', 'not_reproduced', 'regressed'], to: 'accepted_risk', roles: ['approver', 'admin'] },
  // Reversing a human decision is itself a human decision, and an admin one.
  reopen: { from: ['false_positive', 'accepted_risk'], to: 'open', roles: ['admin'] },
  // A regression check that explicitly confirmed the fix (the only way into `fixed`).
  confirm_fixed: { from: ['open', 'not_reproduced', 'regressed'], to: 'fixed', roles: ['operator', 'approver', 'admin'] },
};

export type DecisionCheck =
  | { allowed: true; to: LifecycleStatus }
  | { allowed: false; reason: 'illegal_transition' | 'forbidden_role' | 'reason_required' };

export function checkDecision(from: string, decision: Decision, role: Role | undefined, reason: string | undefined): DecisionCheck {
  const rule = DECISIONS[decision];
  if (!rule || !(rule.from as readonly string[]).includes(from)) return { allowed: false, reason: 'illegal_transition' };
  if (!role || !rule.roles.includes(role)) return { allowed: false, reason: 'forbidden_role' };
  if (!reason || reason.trim().length < 3) return { allowed: false, reason: 'reason_required' };
  return { allowed: true, to: rule.to };
}

export interface ObservedIdentity {
  identityId: string;
  status: LifecycleStatus;
  /** Whether this audit produced an occurrence of the identity. */
  seen: boolean;
  /** Whether this audit ran, to completion, everything that could produce it. */
  covered: boolean;
}

/** Status after an audit settles; `undefined` means unchanged. */
export function observe(identity: ObservedIdentity, auditCompleted: boolean): LifecycleStatus | undefined {
  const { status, seen } = identity;
  // Human decisions are not overturned by observation.
  if (status === 'false_positive' || status === 'accepted_risk') return undefined;
  if (seen) {
    if (status === 'fixed' || status === 'verified') return 'regressed';
    if (status === 'not_reproduced') return 'open';
    return undefined; // new stays new for its first audit; open and regressed persist
  }
  if (!auditCompleted || !identity.covered) return undefined;
  if (status === 'new' || status === 'open' || status === 'regressed') return 'not_reproduced';
  if (status === 'fixed') return 'verified';
  return undefined;
}

/** A `new` identity seen by a later audit becomes `open`. */
export function promoteNew(status: LifecycleStatus, firstSeenAuditId: string, auditId: string): LifecycleStatus | undefined {
  return status === 'new' && firstSeenAuditId !== auditId ? 'open' : undefined;
}

/**
 * Which job categories must have succeeded for an identity's absence to mean
 * anything. Imported findings are produced outside the audit graph, so no
 * audit can observe their absence.
 */
export function producingCategories(origin: string, reproduction: unknown): string[] | null {
  if (reproduction && typeof reproduction === 'object' && 'upstreamFingerprint' in reproduction) return null;
  switch (origin) {
    case 'tool': return ['sast'];
    case 'blackbox': return ['blackbox'];
    case 'whitebox': return ['whitebox'];
    case 'correlated': return ['blackbox', 'whitebox'];
    default: return null;
  }
}
