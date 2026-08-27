import {
  validateHostPattern,
  validateAllowedHosts,
  hostMatchesPattern,
  isHostAllowed,
} from './host-pattern';

const ok = (h: string) => expect(validateHostPattern(h).valid).toBe(true);
const rejects = (h: string, reason: string) => {
  const r = validateHostPattern(h);
  expect(r.valid).toBe(false);
  expect(r.reason).toBe(reason);
};

describe('validateHostPattern — 17-security §3', () => {
  describe('accepts', () => {
    it.each([
      'staging.acme.com',
      'acme.com',
      'api.v2.staging.acme.com',
      '*.staging.acme.com',
      '*.acme.com',
      'localhost',
      'my-app.acme.com',
      'a1.acme.com',
    ])('%s', ok);
  });

  describe('rejects the cases the doc names explicitly', () => {
    it('bare "*" — would allow the whole internet', () => {
      rejects('*', 'wildcard_alone');
    });

    it.each(['com', 'org', 'io', 'localhost2'])('bare TLD: %s', (h) =>
      rejects(h, 'bare_tld'),
    );

    it.each(['*.com', '*.io', '*.dev'])('wildcard on a TLD: %s', (h) =>
      rejects(h, 'bare_tld'),
    );
  });

  describe('rejects wildcards spanning a public suffix', () => {
    // Three labels, so a naive label-count check would accept these while they
    // match every registrant under the suffix.
    it.each(['*.co.uk', '*.com.au', '*.github.io', '*.vercel.app'])('%s', (h) =>
      rejects(h, 'wildcard_on_public_suffix'),
    );

    it('still accepts a real domain under a multi-part suffix', () => {
      ok('*.acme.co.uk');
      ok('acme.co.uk');
    });
  });

  describe('rejects malformed patterns', () => {
    it.each([
      ['https://acme.com', 'contains_scheme'],
      ['acme.com/path', 'contains_path'],
      ['acme.com:8443', 'contains_port'],
      ['user@acme.com', 'contains_credentials'],
      ['ACME.com', 'not_lowercase'],
      ['', 'empty'],
      ['   ', 'empty'],
      ['*.*.acme.com', 'multiple_wildcards'],
      ['api.*.acme.com', 'wildcard_not_leftmost'],
      ['acme.*', 'wildcard_not_leftmost'],
      ['-acme.com', 'invalid_label'],
      ['acme-.com', 'invalid_label'],
      ['ac me.com', 'invalid_label'],
      ['acme..com', 'invalid_label'],
      ['192.168.1.1', 'ip_address'],
      ['10.0.0.1', 'ip_address'],
    ])('%s -> %s', (host, reason) => rejects(host, reason));

    it('rejects a partial wildcard inside a label', () => {
      // "*api.acme.com" is not a single-label wildcard.
      expect(validateHostPattern('*api.acme.com').valid).toBe(false);
    });
  });
});

describe('validateAllowedHosts', () => {
  it('accepts a well-formed policy', () => {
    const r = validateAllowedHosts(['staging.acme.com', '*.staging.acme.com']);
    expect(r).toEqual({ valid: true, errors: [] });
  });

  it('rejects an empty policy', () => {
    // An empty allowlist is not "allow nothing" by accident — it is a policy
    // that can never permit a request, which is a configuration error.
    expect(validateAllowedHosts([]).valid).toBe(false);
  });

  it('reports every failure, not just the first', () => {
    const r = validateAllowedHosts(['*', '*.com', 'staging.acme.com']);
    expect(r.valid).toBe(false);
    expect(r.errors).toHaveLength(2);
  });

  it('flags duplicates', () => {
    const r = validateAllowedHosts(['acme.com', 'acme.com']);
    expect(r.valid).toBe(false);
    expect(r.errors.some((e) => /Duplicate/.test(e))).toBe(true);
  });
});

describe('hostMatchesPattern', () => {
  it('matches an exact host', () => {
    expect(hostMatchesPattern('acme.com', 'acme.com')).toBe(true);
    expect(hostMatchesPattern('api.acme.com', 'acme.com')).toBe(false);
  });

  it('matches exactly one label under a wildcard', () => {
    expect(hostMatchesPattern('api.acme.com', '*.acme.com')).toBe(true);
    expect(hostMatchesPattern('staging.acme.com', '*.acme.com')).toBe(true);
  });

  it('does NOT match multiple labels under a wildcard', () => {
    // Single-label wildcard per §3. If this ever returns true, a policy for
    // "*.acme.com" silently covers "evil.attacker.acme.com" style nesting.
    expect(hostMatchesPattern('a.b.acme.com', '*.acme.com')).toBe(false);
  });

  it('does NOT match the apex', () => {
    expect(hostMatchesPattern('acme.com', '*.acme.com')).toBe(false);
  });

  it('does not match a suffix that merely ends similarly', () => {
    // "notacme.com" must not match "*.acme.com".
    expect(hostMatchesPattern('notacme.com', '*.acme.com')).toBe(false);
    expect(hostMatchesPattern('evil-acme.com', '*.acme.com')).toBe(false);
  });

  it('is case-insensitive on input', () => {
    expect(hostMatchesPattern('API.Acme.com', '*.acme.com')).toBe(true);
  });
});

describe('isHostAllowed', () => {
  const policy = ['acme.com', '*.staging.acme.com'];

  it('allows a listed apex and a wildcard child', () => {
    expect(isHostAllowed('acme.com', policy)).toBe(true);
    expect(isHostAllowed('api.staging.acme.com', policy)).toBe(true);
  });

  it('denies anything else', () => {
    expect(isHostAllowed('prod.acme.com', policy)).toBe(false);
    expect(isHostAllowed('attacker.com', policy)).toBe(false);
    expect(isHostAllowed('a.b.staging.acme.com', policy)).toBe(false);
  });

  it('denies against an empty policy', () => {
    expect(isHostAllowed('acme.com', [])).toBe(false);
  });
});
