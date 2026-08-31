import { Module } from '@nestjs/common';
import { SecretsController } from './secrets.controller';
import { SecretsService } from './secrets.service';
import { EnvelopeCryptoService } from './envelope-crypto.service';
import { KEY_ENCRYPTION_PROVIDER, LocalKeyEncryptionProvider } from './key-encryption.provider';

@Module({
  controllers: [SecretsController],
  providers: [
    SecretsService,
    EnvelopeCryptoService,
    {
      provide: KEY_ENCRYPTION_PROVIDER,
      useFactory: () => new LocalKeyEncryptionProvider(),
    },
  ],
  exports: [SecretsService, EnvelopeCryptoService],
})
export class SecretsModule {}
