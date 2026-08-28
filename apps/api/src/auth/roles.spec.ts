import { isRole, ROLES } from './roles';

describe('isRole', () => {
  it.each(ROLES)('accepts %s', (r) => expect(isRole(r)).toBe(true));

  it('rejects an unknown string', () => expect(isRole('superadmin')).toBe(false));
  it('rejects non-strings', () => {
    expect(isRole(null)).toBe(false);
    expect(isRole(undefined)).toBe(false);
    expect(isRole(42)).toBe(false);
  });

  it('approver and operator are peers, not a hierarchy', () => {
    // 14-api §2: kept separate so require_separate_approver is enforceable.
    // The only invariant worth pinning here is that both are members of the
    // same flat set — nothing in this module ranks one above the other.
    expect(ROLES).toContain('approver');
    expect(ROLES).toContain('operator');
  });
});
