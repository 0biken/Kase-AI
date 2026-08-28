import { providerVerifiedEmail } from './email-verification';

describe('providerVerifiedEmail', () => {
  describe('google', () => {
    it('accepts a true boolean', () => {
      expect(providerVerifiedEmail('google', { email_verified: true })).toBe(true);
    });
    it('rejects false', () => {
      expect(providerVerifiedEmail('google', { email_verified: false })).toBe(false);
    });
    it('rejects a missing claim', () => {
      expect(providerVerifiedEmail('google', {})).toBe(false);
    });
  });

  describe('apple', () => {
    it('accepts the string "true" — Apple sends strings, not booleans', () => {
      expect(providerVerifiedEmail('apple', { email_verified: 'true' })).toBe(true);
    });

    it('rejects the string "false"', () => {
      // The bug this function exists to prevent: a plain truthiness check
      // treats the non-empty string "false" as verified.
      expect(providerVerifiedEmail('apple', { email_verified: 'false' })).toBe(false);
    });

    it('accepts a real boolean too', () => {
      expect(providerVerifiedEmail('apple', { email_verified: true })).toBe(true);
    });
  });

  describe('github', () => {
    it('is verified — the provider only returns primary verified addresses', () => {
      expect(providerVerifiedEmail('github', {})).toBe(true);
    });
  });

  it('fails closed for a provider added later without updating this function', () => {
    expect(providerVerifiedEmail('facebook', { email_verified: true })).toBe(false);
  });

  it('tolerates a null or undefined profile', () => {
    expect(providerVerifiedEmail('google', null)).toBe(false);
    expect(providerVerifiedEmail('google', undefined)).toBe(false);
  });
});
