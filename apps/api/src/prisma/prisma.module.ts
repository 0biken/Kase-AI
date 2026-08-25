import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

// @Global() matching QueueModule and StorageModule: the client is a
// process-wide singleton and every feature module needs it, so re-importing it
// everywhere would be noise.
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
