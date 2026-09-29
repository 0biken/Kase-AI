import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { MODULE_METADATA } from '@nestjs/common/constants';
import { AgentRuntimeModule } from './agent-runtime.module';
import { AgentWorkerModule } from './agent-worker.module';
import { WorkerModule } from '../worker/worker.module';
import { SastWorkerModule } from '../worker/sast-worker.module';
import { ProviderResolver } from '../ai-provider/provider-resolver.service';
import { PrismaService } from '../prisma/prisma.service';
import { AiConfigurationService } from './ai-configuration.service';
import { graphTemplate } from '../orchestrator/job-graph';

function providerTokens(root: any, seen = new Set<any>()): Set<any> {
  const cls = root.module ?? root;
  if (seen.has(cls)) return new Set();
  seen.add(cls);
  const tokens = new Set((Reflect.getMetadata(MODULE_METADATA.PROVIDERS, cls) ?? []).map((p: any) => p.provide ?? p));
  for (const imported of Reflect.getMetadata(MODULE_METADATA.IMPORTS, cls) ?? []) {
    if (imported instanceof Promise) continue;
    for (const token of providerTokens(imported, seen)) tokens.add(token);
  }
  return tokens;
}

describe('deterministic audit provider isolation', () => {
  it('compiles the agent HTTP API dependency graph without provider keys or clients', async () => {
    const original = { openai: process.env.OPENAI_API_KEY, anthropic: process.env.ANTHROPIC_API_KEY };
    delete process.env.OPENAI_API_KEY; delete process.env.ANTHROPIC_API_KEY;
    try {
      const module = await Test.createTestingModule({ imports: [AgentRuntimeModule] }).overrideProvider(PrismaService).useValue({}).compile();
      expect(module.get(AiConfigurationService)).toBeInstanceOf(AiConfigurationService);
      expect(() => module.get(ProviderResolver)).toThrow();
      await module.close();
    } finally {
      for (const [name, value] of [['OPENAI_API_KEY', original.openai], ['ANTHROPIC_API_KEY', original.anthropic]]) {
        if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
      }
    }
  });
  it('keeps model providers out of deterministic workers with the agent graph as a positive control', () => {
    expect(providerTokens(WorkerModule).has(ProviderResolver)).toBe(false);
    expect(providerTokens(SastWorkerModule).has(ProviderResolver)).toBe(false);
    expect(providerTokens(AgentWorkerModule).has(ProviderResolver)).toBe(true);
    for (const mode of ['smoke', 'security', 'full'] as const)
      expect(graphTemplate(mode).some(job => job.kind.endsWith('_agent'))).toBe(false);
    expect(graphTemplate('full', ['blackbox']).some(job => job.kind === 'blackbox_agent')).toBe(true);
  });
});
