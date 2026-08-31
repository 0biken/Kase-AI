import { Inject, Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import {
  KEY_ENCRYPTION_PROVIDER,
  type KeyEncryptionProvider,
  type WrappedKey,
} from './key-encryption.provider';

export interface EncryptedEnvelope {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDataKey: Buffer;
  wrappedDataKeyIv: Buffer;
  wrappedDataKeyTag: Buffer;
  keyProvider: string;
  keyId: string;
}

@Injectable()
export class EnvelopeCryptoService {
  constructor(
    @Inject(KEY_ENCRYPTION_PROVIDER)
    private readonly keys: KeyEncryptionProvider,
  ) {}

  async encrypt(plaintext: string, context: string): Promise<EncryptedEnvelope> {
    const dataKey = randomBytes(32);
    try {
      const iv = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', dataKey, iv);
      cipher.setAAD(Buffer.from(context));
      const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
      const wrapped = await this.keys.wrapKey(dataKey, context);
      return {
        ciphertext,
        iv,
        authTag: cipher.getAuthTag(),
        wrappedDataKey: wrapped.ciphertext,
        wrappedDataKeyIv: wrapped.iv,
        wrappedDataKeyTag: wrapped.authTag,
        keyProvider: wrapped.provider,
        keyId: wrapped.keyId,
      };
    } finally {
      dataKey.fill(0);
    }
  }

  async decrypt(envelope: EncryptedEnvelope, context: string): Promise<string> {
    const wrapped: WrappedKey = {
      ciphertext: Buffer.from(envelope.wrappedDataKey),
      iv: Buffer.from(envelope.wrappedDataKeyIv),
      authTag: Buffer.from(envelope.wrappedDataKeyTag),
      provider: envelope.keyProvider,
      keyId: envelope.keyId,
    };
    const dataKey = await this.keys.unwrapKey(wrapped, context);
    try {
      const decipher = createDecipheriv('aes-256-gcm', dataKey, envelope.iv);
      decipher.setAAD(Buffer.from(context));
      decipher.setAuthTag(envelope.authTag);
      return Buffer.concat([decipher.update(envelope.ciphertext), decipher.final()]).toString('utf8');
    } finally {
      dataKey.fill(0);
    }
  }
}
