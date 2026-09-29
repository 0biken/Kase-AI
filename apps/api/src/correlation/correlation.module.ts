import { Module } from '@nestjs/common';
import { CorrelationEngine } from './correlation-engine.service';

@Module({
  imports: [],
  controllers: [],
  providers: [CorrelationEngine],
  exports: [CorrelationEngine],
})
export class CorrelationModule {}
