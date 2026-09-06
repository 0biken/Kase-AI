import { ProvenanceMismatchError, ProvenanceResolver } from './provenance-resolver';

const full = (value: string) => value.padEnd(40, value).slice(0, 40);
const repo = { url: 'https://example.test/repo.git', defaultBranch: 'main' };

describe('four-source provenance', () => {
  const git = { resolveCommit: jest.fn(async (_repo, ref: string) => ref === 'main' ? full('d') : full(ref[0])) };

  beforeEach(() => git.resolveCommit.mockClear());

  it.each([
    [{ callerCommitSha: 'a1' }, 'ci_supplied', 'a'],
    [{ target: { buildInfoUrl: 'https://build' } }, 'build_info_endpoint', 'b'],
    [{ responseHeaders: { 'X-Build-SHA': 'c3' } }, 'response_header', 'c'],
    [{}, 'assumed', 'd'],
  ])('resolves precedence source %#', async (extra, source, prefix) => {
    const buildInfo = { read: jest.fn(async () => ({ commitSha: 'b2', branch: 'release', buildId: '42' })) };
    const result = await new ProvenanceResolver(git, buildInfo).resolve({ repository: repo, ...extra });
    expect(result.source).toBe(source);
    expect(result.commitSha).toBe(full(prefix));
    expect(result.targetFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(result.verified).toBe(source !== 'assumed');
  });

  it('refuses disagreement after resolving abbreviated claims', async () => {
    const buildInfo = { read: jest.fn(async () => ({ commitSha: 'b2' })) };
    await expect(new ProvenanceResolver(git, buildInfo).resolve({
      repository: repo,
      target: { buildInfoUrl: 'https://build' },
      callerCommitSha: 'a1',
      responseHeaders: { 'x-build-sha': 'a9' },
    })).rejects.toBeInstanceOf(ProvenanceMismatchError);
  });

  it('accepts multiple claims resolving to the same full commit', async () => {
    const sameGit = { resolveCommit: jest.fn(async () => full('e')) };
    const result = await new ProvenanceResolver(sameGit, { read: async () => ({ commitSha: 'eeee' }) }).resolve({
      repository: repo,
      target: { buildInfoUrl: 'https://build' },
      callerCommitSha: 'ee',
      responseHeaders: { 'X-Build-SHA': 'eee' },
    });
    expect(result.commitSha).toBe(full('e'));
    expect(result.source).toBe('ci_supplied');
  });
});
