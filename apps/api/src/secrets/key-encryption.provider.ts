import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

export const KEY_ENCRYPTION_PROVIDER = Symbol('KEY_ENCRYPTION_PROVIDER');

export interface WrappedKey {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyId: string;
  provider: string;
}

export interface KeyEncryptionProvider {
  wrapKey(dataKey: Buffer, context: string): Promise<WrappedKey>;
  unwrapKey(wrapped: WrappedKey, context: string): Promise<Buffer>;
}

/**
 * Development-only KEK provider. Production providers implement the same
 * interface with KMS Encrypt/Decrypt and never expose the master key to Kase.
 */
export class LocalKeyEncryptionProvider implements KeyEncryptionProvider {
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(encodedKey = process.env.KASE_LOCAL_KEK) {
    if (!encodedKey) {
      throw new Error('KASE_LOCAL_KEK is required and must encode exactly 32 bytes');
    }
    this.key = decodeKey(encodedKey);
    if (this.key.length !== 32) {
      throw new Error('KASE_LOCAL_KEK must encode exactly 32 bytes');
    }
    this.keyId = `local:${createHash('sha256').update(this.key).digest('hex').slice(0, 16)}`;
  }

  async wrapKey(dataKey: Buffer, context: string): Promise<WrappedKey> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context));
    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return {
      ciphertext,
      iv,
      authTag: cipher.getAuthTag(),
      keyId: this.keyId,
      provider: 'local',
    };
  }

  async unwrapKey(wrapped: WrappedKey, context: string): Promise<Buffer> {
    if (wrapped.provider !== 'local' || wrapped.keyId !== this.keyId) {
      throw new Error('Wrapped key was not produced by the configured local KEK');
    }
    const decipher = createDecipheriv('aes-256-gcm', this.key, wrapped.iv);
    decipher.setAAD(Buffer.from(context));
    decipher.setAuthTag(wrapped.authTag);
    return Buffer.concat([decipher.update(wrapped.ciphertext), decipher.final()]);
  }
}

function decodeKey(value: string): Buffer {
  const normalised = value.replace(/-/g, '+').replace(/_/g, '/');
  return Buffer.from(normalised, 'base64');
}
