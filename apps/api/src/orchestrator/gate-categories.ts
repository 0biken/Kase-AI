/**
 * Maps what an audit actually executed onto the gate-policy category names
 * (12-policy-gate §4). Jobs are named after tools (`sast`, `whitebox`), policies
 * after what was assured (`static_security`, `authz`), so without this mapping
 * a required category could never be satisfied. Original job categories are
 * kept alongside the mapped names.
 *
 * Deterministic jobs count once they succeed. Agent-derived categories count
 * only when the agent itself recorded coverage (`passed` or `finding`) for
 * them: a job can succeed while its agent never examined, or was blocked on,
 * a category. Rows from other roles (such as imports) never count.
 *
 * `dependencies` has no producer until the M7 deps adapter, so it is deliberately absent here.
 */
export interface CoverageRow { agentRole: string; category: string; outcome: string }

const AGENT_ROLES = new Set(['whitebox', 'blackbox']);
const COVERED = new Set(['passed', 'finding']);

export function gateCategoriesFor(jobCategories: readonly string[], requestedCategories: readonly string[],
  coverage: readonly CoverageRow[]): string[] {
  const executed = new Set(jobCategories);
  const gate = new Set(executed);
  if (executed.has('sast')) gate.add('static_security');
  const covered = coverage.filter(row => AGENT_ROLES.has(row.agentRole) && executed.has(row.agentRole) && COVERED.has(row.outcome));
  if (covered.some(row => isAuthzCategory(row.category))) gate.add('authz');
  // `security` means the security-audit methodology ran and the whitebox agent recorded coverage, not merely that it was requested.
  if (requestedCategories.includes('security') && covered.some(row => row.agentRole === 'whitebox')) gate.add('security');
  return [...gate];
}

/** Agent categories are free-form (`authorization`, `authz_logic`, `Authentication & Authorization Logic`, `idor`). */
function isAuthzCategory(category: string): boolean {
  const c = category.toLowerCase();
  return c.includes('auth') || c.includes('idor') || c.includes('access_control') || c.includes('access control');
}
