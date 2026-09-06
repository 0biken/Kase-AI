import 'reflect-metadata';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AppModule } from '../app.module';
import { SchedulerModule } from '../orchestrator/scheduler.module';
import { WorkerModule } from './worker.module';
import { SastWorkerModule } from './sast-worker.module';
import { RetentionWorkerModule } from '../retention/retention-worker.module';
import { SchedulerWorkerService } from '../orchestrator/scheduler-worker.service';
import { ReconWorkerService } from './recon-worker.service';
import { HttpJobConsumerService } from './http-job-consumer.service';
import { SastJobConsumerService } from './sast-job-consumer.service';
import { RetentionRunnerService } from '../retention/retention-runner.service';

function metadata<T>(module: object, key: string): T[] {
  return Reflect.getMetadata(key, module) ?? [];
}

describe('runtime composition roots', () => {
  it('keeps every background consumer out of the API runtime', () => {
    const imports = metadata(AppModule, MODULE_METADATA.IMPORTS);
    expect(imports).not.toEqual(expect.arrayContaining([SchedulerModule, WorkerModule, SastWorkerModule, RetentionWorkerModule]));
  });

  it('starts only scheduler advancement and recovery in the scheduler runtime', () => {
    expect(metadata(SchedulerModule, MODULE_METADATA.PROVIDERS)).toContain(SchedulerWorkerService);
    expect(metadata(SchedulerModule, MODULE_METADATA.PROVIDERS)).not.toEqual(expect.arrayContaining([ReconWorkerService, SastJobConsumerService, RetentionRunnerService]));
  });

  it('assigns recon/http, SAST, and retention consumers to distinct roots', () => {
    expect(metadata(WorkerModule, MODULE_METADATA.PROVIDERS)).toEqual(expect.arrayContaining([ReconWorkerService, HttpJobConsumerService]));
    expect(metadata(SastWorkerModule, MODULE_METADATA.PROVIDERS)).toContain(SastJobConsumerService);
    expect(metadata(RetentionWorkerModule, MODULE_METADATA.PROVIDERS)).toContain(RetentionRunnerService);
  });
});
