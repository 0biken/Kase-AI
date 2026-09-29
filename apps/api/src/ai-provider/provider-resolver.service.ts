import { Injectable } from '@nestjs/common';
import OpenAI from 'openai';
import Anthropic from '@anthropic-ai/sdk';
import { HttpsProxyAgent } from 'https-proxy-agent';
import type { AIProvider } from './ai-provider.interface';
import { AnthropicAdapter } from './anthropic.adapter';
import { OpenAIAdapter } from './openai.adapter';
import { PrismaService } from '../prisma/prisma.service';
import { SecretsService } from '../secrets/secrets.service';
@Injectable()
export class ProviderResolver {
  constructor(private readonly prisma: PrismaService, private readonly secrets: SecretsService) {}
  async forAudit(auditId: string): Promise<AIProvider> {
    const snapshot = await this.prisma.auditAiSnapshot.findUniqueOrThrow({ where: { auditId }, include: { audit: true } });
    const provider = snapshot.provider;
    if (provider !== 'anthropic' && provider !== 'openai') throw new Error('Unsupported provider');
    let apiKey: string;
    if (snapshot.credentialMode === 'project_secret') {
      if (!snapshot.credentialSecretId || !snapshot.credentialSecretVersion) throw new Error('Frozen credential missing');
      const secret = await this.prisma.secret.findFirst({ where: { id: snapshot.credentialSecretId, projectId: snapshot.audit.projectId, kind: provider + '_api_key', revokedAt: null } });
      if (!secret) throw new Error('Provider credential revoked or invalid');
      apiKey = await this.secrets.resolveForWorker(snapshot.audit.projectId, secret.id, snapshot.credentialSecretVersion);
    } else if (snapshot.credentialMode === 'platform' && (process.env.KASE_PLATFORM_AI_PROVIDERS ?? '').split(',').includes(provider)) {
      const value = process.env[provider === 'openai' ? 'OPENAI_API_KEY' : 'ANTHROPIC_API_KEY'];
      if (!value) throw new Error('Platform provider credential unavailable');
      apiKey = value;
    } else throw new Error('Unsupported credential mode');
    const baseURL = process.env[provider === 'openai' ? 'KASE_OPENAI_BASE_URL' : 'KASE_ANTHROPIC_BASE_URL'] ?? process.env.AGENT_ROUTER_URL;
    if (!baseURL) throw new Error('Agent Router endpoint must be configured explicitly');
    const url = new URL(baseURL);
    const hosts = (process.env.KASE_AGENT_ROUTER_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !hosts.includes(url.hostname.toLowerCase())) throw new Error('Agent Router endpoint is not allowed');
    const proxy = process.env.KASE_AGENT_EGRESS_PROXY;
    if (process.env.NODE_ENV === 'production' && !proxy) throw new Error('Agent egress proxy is required');
    const options = { apiKey, baseURL, maxRetries: 0, timeout: 60000, ...(proxy ? { httpAgent: new HttpsProxyAgent(proxy) } : {}) };
    return provider === 'openai' ? new OpenAIAdapter(new OpenAI(options)) : new AnthropicAdapter(new Anthropic(options));
  }
}

