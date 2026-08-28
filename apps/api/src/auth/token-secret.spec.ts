import { generateApiToken, hashApiToken, looksLikeApiToken } from './token-secret';

describe('generateApiToken', () => {
  it('starts with the kase_ prefix', () => {
    expect(generateApiToken().plaintext).toMatch(/^kase_/);
  });

  it('is high-entropy — two calls never collide', () => {
    const a = generateApiToken();
    const b = generateApiToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });

  it('the display prefix is a true prefix of the plaintext', () => {
    const t = generateApiToken();
    expect(t.plaintext.startsWith(t.displayPrefix)).toBe(true);
  });

  it('the display prefix does not reveal the whole secret', () => {
    const t = generateApiToken();
    expect(t.displayPrefix.length).toBeLessThan(t.plaintext.length);
  });

  it('the hash is deterministic for the same plaintext', () => {
    const t = generateApiToken();
    expect(hashApiToken(t.plaintext)).toBe(t.tokenHash);
  });

  it('the hash is not the plaintext or a substring of it', () => {
    const t = generateApiToken();
    // The whole point of hashing at rest: the persisted value must not let
    // anyone with DB access reconstruct or recognise the live token.
    expect(t.tokenHash).not.toBe(t.plaintext);
    expect(t.plaintext).not.toContain(t.tokenHash);
  });
});

describe('looksLikeApiToken — the AuthGuard discriminator', () => {
  it('recognises a generated token', () => {
    expect(looksLikeApiToken(generateApiToken().plaintext)).toBe(true);
  });

  it('does not mistake a JWT for an API token', () => {
    expect(looksLikeApiToken('eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1c3JfMSJ9.sig')).toBe(false);
  });

  it('is case-sensitive on the prefix', () => {
    expect(looksLikeApiToken('KASE_abc')).toBe(false);
  });
});
