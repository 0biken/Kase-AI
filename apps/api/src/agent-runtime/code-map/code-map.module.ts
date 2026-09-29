import { Module } from '@nestjs/common';
import { CodeMapService } from './code-map.service';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [CodeMapService],
  exports: [CodeMapService],
})
export class CodeMapModule {}
