import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { getQueueToken } from '@nestjs/bullmq';
import { Worker } from 'bullmq';
import { AgentWorkerModule } from './agent-worker.module';
import { AgentWorkerService } from './agent-worker.service';
import { AgentLoopService } from './agent-loop.service';
import { ProviderResolver } from '../ai-provider/provider-resolver.service';
import { PrismaService } from '../prisma/prisma.service';
import { CancellationBusService } from '../queue/cancellation-bus.service';
import { ALL_QUEUES, QUEUE_BLACKBOX_AGENT, QUEUE_WHITEBOX_AGENT } from '../queue/queue.constants';

// Replace network transports only. Nest still resolves the production modules,
// constructors, lifecycle services, provider resolver and worker startup hooks.
jest.mock('bullmq', () => ({
  ...jest.requireActual('bullmq'),
  Worker: jest.fn().mockImplementation(() => ({ on: jest.fn(), close: jest.fn().mockResolvedValue(undefined) })),
}));

describe('agent worker Nest boot with isolated infrastructure transports', () => {
  it('boots both consumers without provider keys and closes their transports', async () => {
    const saved = [process.env.OPENAI_API_KEY, process.env.ANTHROPIC_API_KEY];
    const savedKek = process.env.KASE_LOCAL_KEK;
    process.env.KASE_LOCAL_KEK = Buffer.alloc(32, 7).toString('base64');
    delete process.env.OPENAI_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    const unsubscribe = jest.fn();
    let module: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>['compile']>> | undefined;
    try {
      const builder = Test.createTestingModule({ imports: [AgentWorkerModule] })
        .overrideProvider(PrismaService).useValue({})
        .overrideProvider(CancellationBusService).useValue({ onCancellation: jest.fn(() => unsubscribe) });
      for (const queue of ALL_QUEUES)
        builder.overrideProvider(getQueueToken(queue)).useValue({ name: queue, close: jest.fn() });
      module = await builder.compile();
      await module.init();
      expect(module.get(AgentWorkerService)).toBeInstanceOf(AgentWorkerService);
      expect(module.get(AgentLoopService)).toBeInstanceOf(AgentLoopService);
      expect(module.get(ProviderResolver)).toBeInstanceOf(ProviderResolver);
      const calls = (Worker as unknown as jest.Mock).mock.calls;
      for (const queue of [QUEUE_BLACKBOX_AGENT, QUEUE_WHITEBOX_AGENT])
        expect(calls).toContainEqual([queue, expect.any(Function), expect.objectContaining({ concurrency: 1 })]);
      await module.close();
      module = undefined;
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      for (const result of (Worker as unknown as jest.Mock).mock.results)
        expect(result.value.close).toHaveBeenCalledTimes(1);
    } finally {
      await module?.close();
      if (savedKek === undefined) delete process.env.KASE_LOCAL_KEK;
      else process.env.KASE_LOCAL_KEK = savedKek;
      for (const [index, key] of ['OPENAI_API_KEY', 'ANTHROPIC_API_KEY'].entries()) {
        if (saved[index] === undefined) delete process.env[key];
        else process.env[key] = saved[index];
      }
    }
  });
});
