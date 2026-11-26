import { gateCategoriesFor } from './gate-categories';
import { DEFAULT_GATE_POLICY } from '../assurance/policy/policy-schema';
import { evaluateGate } from '../assurance/gate/gate-engine';

const row = (agentRole: string, category: string, outcome = 'passed') => ({ agentRole, category, outcome });

describe('gateCategoriesFor', () => {
  it('maps succeeded deterministic jobs and keeps the original names', () => {
    expect(gateCategoriesFor(['sast'], ['sast'], []).sort()).toEqual(['sast', 'static_security']);
  });

  it('counts authz only when an executed agent recorded authz coverage', () => {
    expect(gateCategoriesFor(['sast', 'whitebox'], ['whitebox'], [])).not.toContain('authz');
    expect(gateCategoriesFor(['sast', 'whitebox'], ['whitebox'], [row('whitebox', 'injection')])).not.toContain('authz');
    expect(gateCategoriesFor(['sast', 'whitebox'], ['whitebox'], [row('whitebox', 'authz', 'blocked')])).not.toContain('authz');
    expect(gateCategoriesFor(['sast', 'whitebox'], ['whitebox'], [row('whitebox', 'authorization', 'finding')])).toContain('authz');
    expect(gateCategoriesFor(['http', 'blackbox'], ['blackbox'], [row('blackbox', 'Authentication & Authorization Logic')])).toContain('authz');
    // Coverage from an agent whose job did not succeed does not count.
    expect(gateCategoriesFor(['sast'], ['whitebox'], [row('whitebox', 'authz')])).not.toContain('authz');
  });

  it('marks security executed only when requested and the whitebox agent recorded coverage', () => {
    expect(gateCategoriesFor(['sast', 'whitebox'], ['whitebox', 'security'], [row('whitebox', 'injection')])).toContain('security');
    expect(gateCategoriesFor(['sast', 'whitebox'], ['whitebox', 'security'], [])).not.toContain('security');
    expect(gateCategoriesFor(['sast', 'whitebox'], ['whitebox'], [row('whitebox', 'injection')])).not.toContain('security');
  });

  it('ignores coverage written by imports', () => {
    const imported = [row('security_audit_import', 'security', 'finding'), row('security_audit_import', 'authz')];
    const gate = gateCategoriesFor(['sast', 'whitebox'], ['whitebox', 'security'], imported);
    expect(gate).not.toContain('security');
    expect(gate).not.toContain('authz');
  });

  it('never fabricates dependencies', () => {
    expect(gateCategoriesFor(['sast', 'whitebox', 'blackbox', 'http'], ['security'], [row('whitebox', 'dependencies')])).not.toContain('dependencies');
  });

  it('lets a covered sast+whitebox+security audit pass the default policy coverage check', () => {
    const executedCategories = gateCategoriesFor(['sast', 'whitebox'], ['whitebox', 'security'], [row('whitebox', 'authorization')]);
    const decision = evaluateGate({ audit: { status: 'completed', degraded: false, executedCategories },
      policy: DEFAULT_GATE_POLICY, findings: [], waivers: [], suppressions: [], now: new Date() } as any);
    expect(decision.notExecutedCategories).toEqual([]);
    expect(decision.outcome).toBe('pass');
  });
});
