/**
 * Roles, per 14-api §2.
 *
 * Deliberately a flat set, not a ladder. `approver` is a peer of `operator`,
 * not beneath `admin` in some hierarchy — 14-api §2 is explicit that the two
 * are kept separate precisely so `require_separate_approver` on waivers is
 * enforceable. A rank comparison (`role >= 'operator'`) would quietly let a
 * higher rank stand in for `approver`, defeating the reason it exists.
 * Authorization here is always set membership: "is this role one of the
 * roles this route allows", never "is this role at least as senior as X".
 */
export const ROLES = ['viewer', 'operator', 'approver', 'admin'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: unknown): value is Role {
  return typeof value === 'string' && (ROLES as readonly string[]).includes(value);
}
