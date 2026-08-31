import { EnvelopeCryptoService } from './envelope-crypto.service';
import { LocalKeyEncryptionProvider } from './key-encryption.provider';

describe('EnvelopeCryptoService', () => {
  const encodedKek = Buffer.alloc(32, 7).toString('base64url');
  const service = new EnvelopeCryptoService(new LocalKeyEncryptionProvider(encodedKek));

  it('round-trips plaintext without storing it in the envelope', async () => {
    const value = 'never-log-this-value';
    const envelope = await service.encrypt(value, 'kase:secret:sec_1:v1');
    expect(JSON.stringify(envelope)).not.toContain(value);
    await expect(service.decrypt(envelope, 'kase:secret:sec_1:v1')).resolves.toBe(value);
  });

  it('uses fresh data keys and nonces for every encryption', async () => {
    const first = await service.encrypt('same value', 'kase:secret:sec_1:v1');
    const second = await service.encrypt('same value', 'kase:secret:sec_1:v1');
    expect(first.ciphertext.equals(second.ciphertext)).toBe(false);
    expect(first.wrappedDataKey.equals(second.wrappedDataKey)).toBe(false);
    expect(first.iv.equals(second.iv)).toBe(false);
  });

  it('binds ciphertext to its secret/version context', async () => {
    const envelope = await service.encrypt('value', 'kase:secret:sec_1:v1');
    await expect(service.decrypt(envelope, 'kase:secret:sec_1:v2')).rejects.toThrow();
  });

  it('rejects a missing or incorrectly sized local KEK', () => {
    expect(() => new LocalKeyEncryptionProvider('')).toThrow(/required/);
    expect(() => new LocalKeyEncryptionProvider(Buffer.alloc(16).toString('base64'))).toThrow(
      /32 bytes/,
    );
  });
});
