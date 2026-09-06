import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module';
import { SchedulerModule } from '../orchestrator/scheduler.module';
import { WorkerModule } from './worker.module';
import { SastWorkerModule } from './sast-worker.module';
import { RetentionWorkerModule } from '../retention/retention-worker.module';

describe('runtime dependency graphs', () => {
  const previousKek = process.env.KASE_LOCAL_KEK;

  beforeAll(() => { process.env.KASE_LOCAL_KEK = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='; });
  afterAll(() => {
    if (previousKek === undefined) delete process.env.KASE_LOCAL_KEK;
    else process.env.KASE_LOCAL_KEK = previousKek;
  });

  it.each([
    ['api', AppModule],
    ['scheduler', SchedulerModule],
    ['recon', WorkerModule],
    ['sast', SastWorkerModule],
    ['retention', RetentionWorkerModule],
  ])('compiles the %s runtime with every required provider', async (_name, runtime) => {
    const module = await Test.createTestingModule({ imports: [runtime] }).compile();
    await module.close();
  });
});
