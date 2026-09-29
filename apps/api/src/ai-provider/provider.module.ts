import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { SecretsModule } from '../secrets/secrets.module';
import { ProviderResolver } from './provider-resolver.service';
@Module({ imports: [PrismaModule, SecretsModule], providers: [ProviderResolver], exports: [ProviderResolver] })
export class ProviderModule {}

