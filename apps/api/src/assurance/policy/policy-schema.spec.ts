import { parsePolicy, safeParsePolicy, DEFAULT_GATE_POLICY } from './policy-schema';

const minimal = {
  version: 1,
  name: 't',
  waivers: { max_duration_days: 30, require_separate_approver: true, warn_before_expiry_days: 7 },
};

describe('M6 gate policy schema', () => {
  it('parses the shipped default policy', () => {
    expect(DEFAULT_GATE_POLICY.name).toBe('default');
    expect(DEFAULT_GATE_POLICY.mode).toBe('observe');
    expect(DEFAULT_GATE_POLICY.block_on.length).toBeGreaterThan(0);
  });

  it('defaults mode to observe and block_on/warn_on to empty arrays', () => {
    const p = parsePolicy(minimal);
    expect(p.mode).toBe('observe');
    expect(p.block_on).toEqual([]);
    expect(p.warn_on).toEqual([]);
    expect(p.fail_closed.audit_status).toEqual(['failed', 'partial']);
  });

  it('rejects an unknown top-level key (fail closed)', () => {
    expect(() => parsePolicy({ ...minimal, blockOn: [] })).toThrow();
  });

  it('rejects an unknown key inside a block_on clause', () => {
    expect(() => parsePolicy({ ...minimal, block_on: [{ severity: ['critical'], typo: true }] })).toThrow();
  });

  it('rejects a block_on clause that carries no matching condition', () => {
    expect(() => parsePolicy({ ...minimal, block_on: [{ requires_replayable_evidence: true }] })).toThrow();
  });

  it('rejects an empty severity array', () => {
    expect(() => parsePolicy({ ...minimal, block_on: [{ severity: [] }] })).toThrow();
  });

  it('rejects an invalid severity enum value', () => {
    expect(() => parsePolicy({ ...minimal, block_on: [{ severity: ['catastrophic'] }] })).toThrow();
  });

  it('rejects a policy with no waivers block', () => {
    expect(() => parsePolicy({ version: 1, name: 't' })).toThrow();
  });

  it('accepts provenance_verified only with the exact documented literal', () => {
    expect(() => parsePolicy({ ...minimal, fail_closed: { provenance_verified: 'false_blocks_correlated_findings_only' } })).not.toThrow();
    expect(() => parsePolicy({ ...minimal, fail_closed: { provenance_verified: 'sometimes' } })).toThrow();
  });

  it('safeParsePolicy reports invalidity instead of throwing (the fail-closed branch)', () => {
    expect(safeParsePolicy({ ...minimal, mode: 'yolo' }).success).toBe(false);
    expect(safeParsePolicy(minimal).success).toBe(true);
  });
});
