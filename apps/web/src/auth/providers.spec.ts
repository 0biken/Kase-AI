describe('provider assembly', () => {
  const ORIGINAL = process.env;

  const load = () => {
    let mod: typeof import('./providers');
    jest.isolateModules(() => {
      mod = require('./providers');
    });
    return mod!;
  };

  beforeEach(() => {
    process.env = { ...ORIGINAL };
    for (const k of Object.keys(process.env)) {
      if (k.startsWith('KASE_GITHUB') || k.startsWith('KASE_GOOGLE') || k.startsWith('KASE_APPLE')) {
        delete process.env[k];
      }
    }
  });

  afterAll(() => {
    process.env = ORIGINAL;
  });

  it('reports nothing configured when no credentials are set', () => {
    const { providerStatuses } = load();
    expect(providerStatuses().every((s) => !s.configured)).toBe(true);
  });

  it('builds no providers rather than throwing when nothing is configured', () => {
    const { buildProviders } = load();
    expect(buildProviders()).toHaveLength(0);
  });

  it('enables only the providers that have BOTH id and secret', () => {
    process.env.KASE_GITHUB_CLIENT_ID = 'gh-id';
    process.env.KASE_GITHUB_CLIENT_SECRET = 'gh-secret';
    process.env.KASE_GOOGLE_CLIENT_ID = 'goog-id'; // secret deliberately missing

    const { providerStatuses } = load();
    const byId = Object.fromEntries(providerStatuses().map((s) => [s.id, s.configured]));

    expect(byId.github).toBe(true);
    expect(byId.google).toBe(false);
    expect(byId.apple).toBe(false);
  });

  it('a missing Apple key degrades to the other providers instead of failing boot', () => {
    // Apple has hard external prerequisites the others do not — a paid
    // developer account and a .p8 key. Coupling startup to it would make a
    // billing problem look like an outage.
    process.env.KASE_GITHUB_CLIENT_ID = 'gh-id';
    process.env.KASE_GITHUB_CLIENT_SECRET = 'gh-secret';
    process.env.KASE_GOOGLE_CLIENT_ID = 'goog-id';
    process.env.KASE_GOOGLE_CLIENT_SECRET = 'goog-secret';

    const { buildProviders, providerStatuses } = load();

    expect(buildProviders()).toHaveLength(2);
    expect(providerStatuses().find((s) => s.id === 'apple')?.reason).toMatch(/KASE_APPLE/);
  });

  it('treats a blank string as unset', () => {
    process.env.KASE_GITHUB_CLIENT_ID = '   ';
    process.env.KASE_GITHUB_CLIENT_SECRET = 'gh-secret';

    const { providerStatuses } = load();
    expect(providerStatuses().find((s) => s.id === 'github')?.configured).toBe(false);
  });

  it('requests only login scopes for GitHub, never repo access', () => {
    process.env.KASE_GITHUB_CLIENT_ID = 'gh-id';
    process.env.KASE_GITHUB_CLIENT_SECRET = 'gh-secret';

    const { buildProviders } = load();
    const gh = buildProviders()[0] as { authorization?: { params?: { scope?: string } } };

    // Repo access is a separate credential (Repository.credentialId).
    // Bundling it into sign-in would grant read access to every private repo
    // of everyone who logs in.
    expect(gh.authorization?.params?.scope).toBe('read:user user:email');
    expect(gh.authorization?.params?.scope).not.toContain('repo');
  });
});
